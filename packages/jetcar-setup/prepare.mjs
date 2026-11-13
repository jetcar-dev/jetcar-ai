import {cp, mkdir, readFile, rm} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = new URL('../../', import.meta.url);
const payload = new URL('./payload/', import.meta.url);
const packageDirectory = dirname(fileURLToPath(import.meta.url));
const manifestPath = '.agents/plugins/marketplace.json';
const pluginPath = 'plugins/jetcar/';
const readJson = async (url) => JSON.parse(await readFile(url, 'utf8'));

const packageInfo = await readJson(new URL('./package.json', import.meta.url));
const plugin = await readJson(new URL(`${pluginPath}plugin.json`, repo));
if (plugin.version !== packageInfo.version) {
    throw new Error('Set the installer and plugin to the same version before packaging.');
}

await rm(join(packageDirectory, 'payload'), {recursive: true, force: true});
await mkdir(new URL('.agents/plugins/', payload), {recursive: true});
await cp(new URL(manifestPath, repo), new URL(manifestPath, payload));
await cp(new URL(pluginPath, repo), new URL(pluginPath, payload), {recursive: true});
