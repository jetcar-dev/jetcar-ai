import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {cp, mkdir, mkdtemp, rename, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const project = fileURLToPath(new URL('../', import.meta.url));
const plugin = fileURLToPath(new URL('../../../plugins/jetcar/mcps/jetcar-site/', import.meta.url));
const staging = await mkdtemp(join(tmpdir(), 'jetcar-site-package-'));
const pending = join(plugin, `.runtime-${randomUUID()}.tmp`);
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

try {
    await build({entryPoints: [join(project, 'dist', 'server.js')], outfile: join(staging, 'server.cjs'),
        bundle: true, platform: 'node', format: 'cjs', target: 'node22', minify: true, legalComments: 'eof',
        external: ['playwright-core']});
    await mkdir(join(staging, 'node_modules'), {recursive: true});
    await cp(join(project, 'node_modules', 'playwright-core'), join(staging, 'node_modules', 'playwright-core'), {recursive: true});
    const result = spawnSync(tar, ['-czf', pending, '-C', staging, 'server.cjs', 'node_modules'], {stdio: 'inherit', windowsHide: true});
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`tar failed with exit code ${result.status}`);
    await rename(pending, join(plugin, 'runtime.tar.gz'));
} finally {
    await rm(staging, {recursive: true, force: true});
    await rm(pending, {force: true});
}
