import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {Client, SdkError, SdkErrorCode} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {resolveCafeTarget, type CafeTarget} from '../boards/target.js';
import {browsers, customUserDataDirectory, extensionProfiles, loadBrowserConnection, type BrowserName} from './browser-connection.js';

const playwrightCli = join(dirname(createRequire(import.meta.url).resolve('@playwright/mcp/package.json')), 'cli.js');
const cookieNames = ['NID_AUT', 'NID_SES'] as const;
const cookieDomains = new Set(['naver.com', 'cafe.naver.com', 'apis.cafe.naver.com']);
const setupCommand = process.env.JETCAR_NAVER_CAFE_SETUP_COMMAND ?? 'npm run setup:browser';
type ExtensionTool = (name: string, args: Record<string, unknown>) => Promise<string>;
type Connection = {key: string; client: Client; ready: Promise<void>; pending: Promise<void>; used: boolean};
const connections = new Map<BrowserName, Connection>();

async function disconnect(name: BrowserName, connection: Connection) {
    if (connections.get(name) !== connection) return;
    connections.delete(name);
    await connection.client.close().catch(() => {});
}

export async function closeExtensionConnections() {
    await Promise.all([...connections].map(([name, connection]) => disconnect(name, connection)));
}

function getConnection(name: BrowserName, profile: string, token: string) {
    const executable = process.env.NAVER_PLAYWRIGHT_EXECUTABLE_PATH?.trim();
    const customDataDirectory = customUserDataDirectory(name);
    const key = JSON.stringify([profile, token, executable, customDataDirectory]);
    const current = connections.get(name);
    if (current?.key === key) return current;

    const env: Record<string, string> = {};
    for (const key of ['LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'XDG_CONFIG_HOME']) {
        const value = process.env[key];
        if (value) env[key] = value;
    }
    env.PLAYWRIGHT_MCP_EXTENSION_TOKEN = token;
    const args = [playwrightCli, '--extension', '--caps=storage', '--no-tab-group', '--codegen=none',
        '--browser', name === 'chrome' ? 'chrome' : 'msedge', '--profile-dir-name', profile];
    if (executable) args.push('--executable-path', executable);
    if (customDataDirectory) args.push('--user-data-dir', customDataDirectory);
    const transport = new StdioClientTransport({command: process.execPath, args, env, stderr: 'ignore'});
    const client = new Client({name: 'naver-cafe', version: '0.1.0'});
    const closing = current && disconnect(name, current);
    const ready = Promise.resolve(closing).then(() => {
        if (connections.get(name)?.client !== client) throw new Error('Playwright connection was replaced');
        return client.connect(transport);
    });
    const connection = {key, client, ready, pending: Promise.resolve(), used: false};
    connections.set(name, connection);
    client.onclose = () => {
        if (connections.get(name) === connection) connections.delete(name);
    };
    return connection;
}

async function selectBrowser(choice: BrowserName | undefined) {
    const names = choice ? [choice] : browsers;
    const setupMessage = `터미널에서 ${setupCommand} 명령을 실행해 사용할 브라우저 프로필을 한 번 연결하세요.`;
    const saved = await Promise.all(names.map(async (name) => {
        const config = await loadBrowserConnection(name).catch(() => null);
        return {name, config};
    }));
    const configured = saved.flatMap(({name, config}) => config ? [{name, ...config}] : []);
    const ask = (names: BrowserName[]) => ({
        status: 'needs_browser_choice', choices: names,
        question: 'Chrome과 Edge 중 어느 브라우저의 네이버 계정을 사용할까요?',
    });
    if (configured.length > 1) return ask(configured.map(({name}) => name));
    if (configured.length === 1) return configured[0];

    const legacyProfile = process.env.PLAYWRIGHT_MCP_PROFILE_DIR_NAME?.trim();
    const installed = (await Promise.all(names.map(async (name) => ({name, profiles: await extensionProfiles(name)}))))
        .filter(({profiles}) => legacyProfile ? profiles.includes(legacyProfile) : profiles.length > 0);
    if (installed.length > 1) return ask(installed.map(({name}) => name));
    const [selected] = installed;
    const token = process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN?.trim();
    const profile = legacyProfile ?? (selected?.profiles.length === 1 ? selected.profiles[0] : undefined);
    if (selected && token && profile) return {name: selected.name, profile, token};
    const browser = selected?.name ?? saved.find(({config}) => config === null)?.name;
    if (browser) return {status: 'needs_browser_setup', browser, message: setupMessage};
    return {
        status: 'needs_playwright_extension',
        message: '네이버에 로그인한 Chrome 또는 Edge에 Playwright Extension을 설치한 뒤 다시 시도하세요.',
    };
}

async function withPlaywrightExtension<T>(choice: BrowserName | undefined,
    use: (call: ExtensionTool, browser: BrowserName) => Promise<T>,
    signal?: AbortSignal,
) {
    signal?.throwIfAborted();
    const selected = await selectBrowser(choice);
    signal?.throwIfAborted();
    if (!('token' in selected)) return selected;
    const {name, profile, token} = selected;
    const run = (connection: Connection) => {
        const read = connection.pending.then(async () => {
            await connection.ready;
            signal?.throwIfAborted();
            if (connections.get(name) !== connection) throw new Error('Playwright connection was replaced');
            const value = await use(async (tool, parameters) => {
                const result = await connection.client.callTool({name: tool, arguments: {...parameters, _meta: {raw: true}}},
                    {timeout: 30_000, signal});
                if (result.isError) throw new Error('Playwright extension tool failed');
                return result.content.flatMap((item) => item.type === 'text' ? [item.text] : []).join('\n');
            }, name);
            connection.used = true;
            return value;
        });
        connection.pending = read.then(() => {}, () => {});
        return read;
    };
    let connection = getConnection(name, profile, token);
    try {
        return await run(connection);
    } catch (error) {
        signal?.throwIfAborted();
        await disconnect(name, connection);
        const replacement = connections.get(name);
        if (connection.used && (!replacement || replacement.key === connection.key) &&
            !(error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout)) {
            signal?.throwIfAborted();
            connection = getConnection(name, profile, token);
            try {
                return await run(connection);
            } catch {
                signal?.throwIfAborted();
                await disconnect(name, connection);
            }
        }
        return {
            status: 'extension_connection_failed', browser: name,
            message: `Playwright 확장 연결을 완료하지 못했습니다. 연결 토큰을 바꿨다면 ${setupCommand} 명령으로 다시 연결하세요.`,
        };
    }
}

async function cafeTabUrls(call: ExtensionTool) {
    const text = await call('browser_tabs', {action: 'list'});
    return Array.from(text.matchAll(/^\s*- \d+:[^\n]*\]\((https:\/\/cafe\.naver\.com\/[^\s)]+)\)/gm), (match) => match[1]);
}

async function readNaverCookies(call: ExtensionTool) {
    const text = await call('browser_cookie_list', {domain: 'naver.com', path: '/'});
    const cookies = Array.from(text.matchAll(/^(NID_AUT|NID_SES)=([\x21-\x7e]+) \(domain: ([^,\r\n]+), path: \/\)\r?$/gm))
        .flatMap(([, name, value, domain]) => !value.includes(';') && cookieDomains.has(domain.replace(/^\./, ''))
            ? [{name, field: `${name}=${value}`, domain}]
            : [])
        .sort((a, b) => b.domain.replace(/^\./, '').length - a.domain.replace(/^\./, '').length);
    return (hostname: string) => {
        const fields = cookieNames.map((name) => cookies.find((cookie) => cookie.name === name &&
            (hostname === cookie.domain.replace(/^\./, '') || (cookie.domain.startsWith('.') && hostname.endsWith(cookie.domain))))?.field);
        if (fields.every((field) => field !== undefined)) return fields.join('; ');
    };
}

export function readExtensionLogin(choice: BrowserName | undefined, target: CafeTarget | undefined, signal?: AbortSignal) {
    return withPlaywrightExtension(choice, async (call, name) => {
        const boards = new Map<string, CafeTarget>();
        if (!target) {
            for (const url of await cafeTabUrls(call)) {
                const board = resolveCafeTarget(url);
                if (board) boards.set(`${board.cafeId}/${board.menuId}`, board);
            }
        }
        const board = target ?? (boards.size === 1 ? boards.values().next().value : undefined);
        if (!board) return {
            status: 'needs_board_url', question: '임시저장할 네이버 카페 게시판 링크를 보내주세요.',
        };
        const loginHeader = (await readNaverCookies(call))('apis.cafe.naver.com');
        if (!loginHeader) return {
            status: 'needs_naver_login', browser: name,
            message: '확장 프로그램이 설치된 브라우저 프로필에서 네이버에 로그인한 뒤 다시 시도하세요.',
        };
        return {board, name, loginHeader};
    }, signal);
}

export function readExtensionSession(choice: BrowserName | undefined, findCafeInTabs = false, signal?: AbortSignal) {
    return withPlaywrightExtension(choice, async (call, name) => {
        const urls = findCafeInTabs ? await cafeTabUrls(call) : [];
        return {name, urls, loginHeaderFor: await readNaverCookies(call)};
    }, signal);
}
