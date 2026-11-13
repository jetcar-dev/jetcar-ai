import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir, readFile, readdir, rename, rm, stat, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {z} from 'zod';

export const browsers = ['chrome', 'edge'] as const;
export type BrowserName = typeof browsers[number];
const extensionId = 'mmlmfjhmonkocbjadbfplnigmagldckm';
const runFile = promisify(execFile);
const connectionSchema = z.object({
    profile: z.string().min(1).regex(/^[^/\\\x00-\x1f]+$/).refine((value) => value !== '.' && value !== '..'),
    token: z.string().regex(/^[A-Za-z0-9_-]{20,200}$/),
});
type BrowserConnection = z.infer<typeof connectionSchema>;

export function customUserDataDirectory(browser: BrowserName) {
    return (browser === 'chrome' ? process.env.NAVER_CHROME_USER_DATA_DIR : process.env.NAVER_EDGE_USER_DATA_DIR)?.trim();
}

function userDataDirectory(browser: BrowserName) {
    const override = customUserDataDirectory(browser);
    if (override) return override;
    const home = homedir();
    if (process.platform === 'win32') {
        const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
        return join(local, ...(browser === 'chrome' ? ['Google', 'Chrome'] : ['Microsoft', 'Edge']), 'User Data');
    }
    if (process.platform === 'darwin') {
        return join(home, 'Library', 'Application Support', ...(browser === 'chrome' ? ['Google', 'Chrome'] : ['Microsoft Edge']));
    }
    return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), browser === 'chrome' ? 'google-chrome' : 'microsoft-edge');
}

function connectionDirectory() {
    const home = homedir();
    if (process.platform === 'win32') {
        return join(process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'Jetcar', 'NaverCafeMcp');
    }
    const local = process.platform === 'darwin' ? join(home, 'Library', 'Application Support') :
        process.env.XDG_CONFIG_HOME ?? join(home, '.config');
    return join(local, 'jetcar', 'naver-cafe-mcp');
}

export async function extensionProfiles(browser: BrowserName) {
    const directory = userDataDirectory(browser);
    const entries = await readdir(directory, {withFileTypes: true}).catch(() => []);
    const profiles = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async ({name}) => {
        const extension = await stat(join(directory, name, 'Extensions', extensionId)).catch(() => undefined);
        return extension?.isDirectory() ? name : undefined;
    }));
    return profiles.filter((name) => name !== undefined).sort();
}

export async function lastUsedProfile(browser: BrowserName, profiles: string[]) {
    if (profiles.length === 1) return profiles[0];
    const state = await readFile(join(userDataDirectory(browser), 'Local State'), 'utf8')
        .then((raw) => JSON.parse(raw)).catch(() => undefined);
    const lastUsed = state?.profile?.last_used;
    return profiles.includes(lastUsed) ? lastUsed as string : profiles[0];
}

export async function browserExecutable(browser: BrowserName) {
    const override = process.env.NAVER_PLAYWRIGHT_EXECUTABLE_PATH?.trim();
    if (override || process.platform !== 'win32') return override;
    const reg = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe');
    const executable = browser === 'chrome' ? 'chrome.exe' : 'msedge.exe';
    for (const hive of ['HKCU', 'HKLM']) {
        const key = `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executable}`;
        const result = await runFile(reg, ['query', key, '/ve'], {windowsHide: true}).catch(() => undefined);
        const file = /\bREG_SZ\s+([^\r\n]+)/.exec(result?.stdout ?? '')?.[1].trim().replace(/^"|"$/g, '');
        if (file && (await stat(file).catch(() => undefined))?.isFile()) return file;
    }
}

export async function loadBrowserConnection(browser: BrowserName) {
    try {
        const raw = await readFile(join(connectionDirectory(), `playwright-${browser}.json`), 'utf8');
        return connectionSchema.parse(JSON.parse(raw));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw new Error('저장된 브라우저 연결을 읽을 수 없습니다. npm run setup:browser로 다시 연결하세요.');
    }
}

export async function saveBrowserConnection(browser: BrowserName, connection: BrowserConnection) {
    const parsed = connectionSchema.safeParse(connection);
    if (!parsed.success) throw new Error('Playwright 확장 프로그램에서 복사한 토큰을 확인하세요.');
    const directory = connectionDirectory();
    await mkdir(directory, {recursive: true, mode: 0o700});
    const file = join(directory, `playwright-${browser}.json`);
    const temp = join(directory, `.${randomUUID()}.tmp`);
    try {
        await writeFile(temp, JSON.stringify(parsed.data), {mode: 0o600, flag: 'wx'});
        await rename(temp, file);
    } finally {
        await rm(temp, {force: true});
    }
}
