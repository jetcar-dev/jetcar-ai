import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {createInterface} from 'node:readline';
import {Readable} from 'node:stream';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {resolveCafeTarget, type CafeTarget} from '../boards/target.js';
import {browserExecutable, browsers, customUserDataDirectory, extensionProfiles, lastUsedProfile, loadBrowserConnection,
    type BrowserName} from './browser-connection.js';

const playwrightCli = join(dirname(createRequire(import.meta.url).resolve('@playwright/mcp/package.json')), 'cli.js');
const cookieNames = ['NID_AUT', 'NID_SES'] as const;
const cookieDomains = new Set(['naver.com', 'cafe.naver.com', 'apis.cafe.naver.com', 'article.cafe.naver.com']);
const approvalTimeoutMs = 120_000;
const browserRequestTimeoutMs = 20_000;
type ExtensionTool = (name: string, args: Record<string, unknown>) => Promise<string>;
type RelayStage = 'launch' | 'waiting_for_browser' | 'browser_connected' | 'ready';
type Connection = {key: string; profile: string; client: Client; ready: Promise<void>; pending: Promise<void>;
    used: boolean; stage: RelayStage; onRelayReady?: () => void;
    command?: {name: string; id: string; replied: boolean}; failureReason?: string};
const connections = new Map<BrowserName, Connection>();
const rejectedTokens = new Map<BrowserName, string>();
const reconnectRequired = new Set<BrowserName>();
const relayMessages: Record<RelayStage, string> = {
    launch: 'Playwright 연결 프로그램을 시작하지 못했습니다.',
    waiting_for_browser: 'Playwright가 브라우저 확장 프로그램과 연결하지 못했습니다.',
    browser_connected: '확장 프로그램이 연결됐지만 브라우저와 초기 연결을 마치지 못했습니다.',
    ready: '브라우저에 연결된 뒤 네이버 로그인 상태를 읽지 못했습니다.',
};
function bridgeFailure(text: string) {
    if (/No attached tab|No tab with (?:id|given)|Target closed|detached while handling/i.test(text)) return 'tab_unavailable';
    if (/another debugger|already attached|already connected to another client/i.test(text)) return 'tab_in_use';
    if (/Cannot access a chrome|Cannot attach to this target|Cannot access contents|Cannot access target/i.test(text)) return 'tab_access_denied';
    if (/wasn't found|Method not found|Unknown method/i.test(text)) return 'browser_command_unsupported';
    if (/Request timed out|Timeout .* exceeded/i.test(text)) return 'timed_out';
}

async function disconnect(name: BrowserName, connection: Connection, requireReconnect = false) {
    if (connections.get(name) !== connection) return;
    connections.delete(name);
    if (requireReconnect) reconnectRequired.add(name);
    await connection.client.close().catch(() => {});
}

export async function closeExtensionConnections() {
    await Promise.all([...connections].map(([name, connection]) => disconnect(name, connection)));
}

function getConnection(name: BrowserName, profile: string, token?: string) {
    const customDataDirectory = customUserDataDirectory(name);
    const key = JSON.stringify([profile, token, customDataDirectory]);
    const current = connections.get(name);
    if (current?.key === key) return current;

    const env: Record<string, string> = {DEBUG: 'pw:mcp:relay,pw:mcp:error'};
    for (const key of ['LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'XDG_CONFIG_HOME']) {
        const value = process.env[key];
        if (value) env[key] = value;
    }
    if (token) env.PLAYWRIGHT_MCP_EXTENSION_TOKEN = token;
    const client = new Client({name: 'naver-cafe', version: '0.1.0'});
    const closing = current && disconnect(name, current);
    const ready = Promise.resolve(closing).then(async () => {
        const executable = await browserExecutable(name);
        if (connections.get(name)?.client !== client) throw new Error('Playwright connection was replaced');
        // Playwright binds its local extension relay to localhost. Prefer an IPv4 loopback address on Windows.
        const nodeArgs = process.platform === 'win32' ? ['--dns-result-order=ipv4first'] : [];
        const args = [...nodeArgs, playwrightCli, '--extension', '--caps=storage', '--no-tab-group', '--codegen=none',
            '--browser', name === 'chrome' ? 'chrome' : 'msedge', '--profile-dir-name', profile];
        if (executable) args.push('--executable-path', executable);
        if (customDataDirectory) args.push('--user-data-dir', customDataDirectory);
        const transport = new StdioClientTransport({command: process.execPath, args, env, stderr: 'pipe'});
        if (transport.stderr instanceof Readable) {
            createInterface({input: transport.stderr}).on('line', (line) => {
                if (line.includes('pw:mcp:error')) connection.failureReason ??= bridgeFailure(line);
                if (!line.includes('pw:mcp:relay')) return;
                // Keep only the stage. The browser process can include URLs or session data in errors.
                if (line.includes('Waiting for incoming extension connection') && connection.stage === 'launch') connection.stage = 'waiting_for_browser';
                if (line.includes('New connection to /extension/') && connection.stage !== 'ready') connection.stage = 'browser_connected';
                if (line.includes('Extension connection established')) {
                    connection.stage = 'ready';
                    connection.onRelayReady?.();
                }
                const command = /← Playwright:\s+([A-Za-z]+\.[A-Za-z]+) \(id=(\d+)\)/.exec(line);
                if (command) connection.command = {name: command[1], id: command[2], replied: false};
                const replyId = /→ Playwright:\s+response\(id=(\d+)\)/.exec(line)?.[1];
                if (connection.command && replyId === connection.command.id) connection.command.replied = true;
            });
        }
        return client.connect(transport);
    });
    const connection: Connection = {key, profile, client, ready, pending: Promise.resolve(), used: false, stage: 'launch'};
    connections.set(name, connection);
    client.onclose = () => {
        if (connections.get(name) !== connection) return;
        connections.delete(name);
        if (!token) reconnectRequired.add(name);
    };
    return connection;
}

async function selectBrowser(choice: BrowserName | undefined) {
    const names = choice ? [choice] : browsers;
    const legacyProfile = process.env.PLAYWRIGHT_MCP_PROFILE_DIR_NAME?.trim();
    const legacyToken = process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN?.trim();
    const available = (await Promise.all(names.map(async (name) => {
        const [saved, profiles] = await Promise.all([
            loadBrowserConnection(name).catch(() => undefined), extensionProfiles(name),
        ]);
        if (saved && profiles.includes(saved.profile)) return {name, ...saved};
        if (legacyProfile && profiles.includes(legacyProfile)) return {name, profile: legacyProfile, token: legacyToken};
        const connectedProfile = connections.get(name)?.profile;
        const profile = connectedProfile && profiles.includes(connectedProfile) ? connectedProfile
            : profiles.length ? await lastUsedProfile(name, profiles) : undefined;
        if (profile) return {name, profile, token: profiles.length === 1 ? legacyToken : undefined};
    }))).filter((option) => option !== undefined);
    const connected = available.filter(({name}) => connections.get(name)?.used);
    if (connected.length === 1) return connected[0];
    if (available.length > 1) return {
        status: 'needs_browser_choice', choices: available.map(({name}) => name),
        question: 'Chrome과 Edge 중 어느 브라우저의 네이버 계정을 사용할까요?',
    };
    if (available.length === 1) return available[0];
    return {
        status: 'needs_playwright_extension',
        message: '네이버에 로그인한 Chrome 또는 Edge에 Playwright Extension을 설치한 뒤 다시 시도하세요.',
    };
}

async function withPlaywrightExtension<T>(choice: BrowserName | undefined,
    use: (call: ExtensionTool, browser: BrowserName) => Promise<T>,
    signal?: AbortSignal,
    reconnect = false,
) {
    signal?.throwIfAborted();
    const selected = await selectBrowser(choice);
    signal?.throwIfAborted();
    if (!('name' in selected) || !selected.name) return selected;
    const {name, profile} = selected;
    const token = selected.token === rejectedTokens.get(name) ? undefined : selected.token;
    const failure = {
        status: 'extension_connection_failed', browser: name,
        message: 'Playwright 연결이 끊겼거나 완료되지 않았습니다. 다시 연결하려면 Codex에서 제트카에 브라우저를 다시 연결해 달라고 요청하세요.',
    };
    if (reconnectRequired.has(name) && !reconnect) return failure;
    reconnectRequired.delete(name);

    const connection = getConnection(name, profile, token);
    const read = connection.pending.then(async () => {
        const browserTimeout = new AbortController();
        let browserTimer: ReturnType<typeof setTimeout> | undefined;
        try {
            await connection.ready;
            signal?.throwIfAborted();
            if (connections.get(name) !== connection) throw new Error('Playwright connection was replaced');
            connection.failureReason = undefined;
            connection.command = undefined;
            if (connection.stage !== 'ready') connection.onRelayReady = () => {
                browserTimer = setTimeout(() => browserTimeout.abort(new Error('Request timed out after browser approval')),
                    browserRequestTimeoutMs);
            };
            const requestSignal = signal ? AbortSignal.any([signal, browserTimeout.signal]) : browserTimeout.signal;
            const value = await use(async (tool, parameters) => {
                const result = await connection.client.callTool({name: tool, arguments: {...parameters, _meta: {raw: true}}},
                    {timeout: connection.stage === 'ready' || token ? browserRequestTimeoutMs : approvalTimeoutMs, signal: requestSignal});
                const response = result.content.flatMap((item) => item.type === 'text' ? [item.text] : []).join('\n');
                if (result.isError) {
                    connection.failureReason ??= bridgeFailure(response);
                    throw new Error('Playwright extension tool failed');
                }
                return response;
            }, name);
            connection.used = true;
            connection.stage = 'ready';
            return value;
        } catch (error) {
            if (signal?.aborted) {
                if (!connection.used) await disconnect(name, connection, true);
                signal.throwIfAborted();
            }
            if (token && !connection.used && connections.get(name) === connection) rejectedTokens.set(name, token);
            await disconnect(name, connection, true);
            const reason = connection.failureReason ?? (error instanceof Error ? bridgeFailure(error.message) : undefined);
            return {...failure, stage: connection.stage, reason, browserCommand: connection.command?.name,
                browserReplied: connection.command?.replied,
                message: `${relayMessages[connection.stage]} ${failure.message}`};
        } finally {
            clearTimeout(browserTimer);
            connection.onRelayReady = undefined;
        }
    });
    connection.pending = read.then(() => {}, () => {});
    return read;
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

export function readExtensionSession(choice: BrowserName | undefined, findCafeInTabs = false, signal?: AbortSignal,
    reconnect = false,
) {
    return withPlaywrightExtension(choice, async (call, name) => {
        const urls = findCafeInTabs ? await cafeTabUrls(call) : [];
        return {name, urls, loginHeaderFor: await readNaverCookies(call)};
    }, signal, reconnect);
}
