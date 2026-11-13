import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {access, mkdir, mkdtemp, rename, rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const archive = fileURLToPath(new URL('./runtime.tar.gz', import.meta.url));
const userDirectory = process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Jetcar', 'NaverCafeMcp')
    : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support', 'jetcar', 'naver-cafe-mcp')
        : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'jetcar', 'naver-cafe-mcp');

async function exists(file) {
    return access(file).then(() => true, () => false);
}

async function prepareRuntime() {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(archive)) hash.update(chunk);
    const cache = join(userDirectory, 'runtime');
    const directory = join(cache, hash.digest('hex'));
    const server = join(directory, 'dist', 'server.js');
    if (await exists(server)) return directory;

    await mkdir(cache, {recursive: true});
    const staging = await mkdtemp(join(cache, '.extract-'));
    try {
        const result = spawnSync('tar', ['-xzf', archive, '-C', staging], {windowsHide: true, encoding: 'utf8'});
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(result.stderr?.trim() || '네이버 카페 실행 파일을 풀지 못했습니다.');
        await rename(staging, directory).catch(async (error) => {
            if (!await exists(server)) throw error;
        });
    } finally {
        await rm(staging, {recursive: true, force: true});
    }
    return directory;
}

try {
    if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 이상을 설치하세요.');
    const directory = await prepareRuntime();
    if (!process.env.NAVER_IMAGE_DIR?.trim()) {
        const photos = join(userDirectory, 'photos');
        await mkdir(photos, {recursive: true});
        process.env.NAVER_IMAGE_DIR = photos;
    }
    process.env.JETCAR_NAVER_CAFE_SETUP_COMMAND = `node "${fileURLToPath(import.meta.url)}" --setup-browser`;
    const entry = process.argv.includes('--setup-browser') ? join('auth', 'setup-browser.js') : 'server.js';
    await import(pathToFileURL(join(directory, 'dist', entry)).href);
} catch (error) {
    console.error(`제트카 네이버 카페 MCP: ${error.message}`);
    process.exitCode = 1;
}
