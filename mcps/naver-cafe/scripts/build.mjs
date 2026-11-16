import {spawnSync} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const [flag, directory] = process.argv.slice(2);
if (flag && (flag !== '--outDir' || !directory)) throw new Error('Usage: npm run build -- [--outDir directory]');
const output = resolve(project, directory ?? 'dist');
const require = createRequire(import.meta.url);
const compilerManifest = require.resolve('typescript/package.json');
const compiler = resolve(dirname(compilerManifest), require(compilerManifest).bin.tsc);
const result = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.json', '--outDir', output], {cwd: project, stdio: 'inherit', windowsHide: true});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

await mkdir(join(output, 'auth'), {recursive: true});
await Promise.all([
    writeFile(join(output, 'server.js'), "import './naver-cafe/src/server.js';\n"),
    writeFile(join(output, 'auth', 'setup-browser.js'), "import '../naver-cafe/src/auth/setup-browser.js';\n"),
]);
