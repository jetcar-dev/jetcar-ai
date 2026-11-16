import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {access, mkdir, mkdtemp, readFile, rename, rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const archive = fileURLToPath(new URL('./runtime.tar.gz', import.meta.url));
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
const cache = process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Jetcar', 'SiteMcp', 'runtime')
    : join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'jetcar', 'site-mcp');

async function exists(file) {
    return access(file).then(() => true, () => false);
}

async function prepareServer() {
    const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
    const destination = join(cache, digest);
    const server = join(destination, 'server.cjs');
    if (await exists(server)) return server;

    await mkdir(cache, {recursive: true});
    const staging = await mkdtemp(join(cache, '.extract-'));
    try {
        const result = spawnSync(tar, ['-xzf', archive, '-C', staging], {windowsHide: true, encoding: 'utf8'});
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(result.stderr?.trim() || '제트카 사이트 실행 파일을 풀지 못했습니다.');
        await rename(staging, destination).catch(async (error) => {
            if (!await exists(server)) throw error;
        });
    } finally {
        await rm(staging, {recursive: true, force: true});
    }
    return server;
}

try {
    if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 이상을 설치하세요.');
    await import(pathToFileURL(await prepareServer()).href);
} catch (error) {
    console.error(`제트카 사이트 MCP: ${error.message}`);
    process.exitCode = 1;
}
