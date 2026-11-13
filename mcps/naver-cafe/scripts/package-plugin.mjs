import {spawnSync} from 'node:child_process';
import {copyFile, mkdtemp, rename, rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const pluginMcp = fileURLToPath(new URL('../../../plugins/jetcar/mcps/naver-cafe/', import.meta.url));
const staging = await mkdtemp(join(tmpdir(), 'jetcar-naver-cafe-package-'));
const archive = join(pluginMcp, 'runtime.tar.gz');
const pendingArchive = join(pluginMcp, `.runtime-${randomUUID()}.tmp`);

function run(command, args, cwd) {
    const result = spawnSync(command, args, {cwd, stdio: 'inherit', windowsHide: true});
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

try {
    const npm = process.env.npm_execpath;
    if (!npm) throw new Error('Run npm run package:plugin.');
    for (const file of ['package.json', 'package-lock.json']) {
        await copyFile(join(project, file), join(staging, file));
    }
    run(process.execPath, [npm, 'run', 'build', '--', '--outDir', join(staging, 'dist')], project);
    run(process.execPath, [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], staging);
    run('tar', ['-czf', pendingArchive, '--exclude=node_modules/.bin', '--exclude=node_modules/.package-lock.json',
        'package.json', 'node_modules', 'dist/server.js',
        'dist/auth', 'dist/boards', 'dist/drafts', 'dist/shared'], staging);
    await rename(pendingArchive, archive);
    console.log(archive);
} finally {
    await rm(staging, {recursive: true, force: true});
    await rm(pendingArchive, {force: true});
}
