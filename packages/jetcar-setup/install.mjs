#!/usr/bin/env node
import {execFile} from 'node:child_process';
import {randomUUID, scryptSync, timingSafeEqual} from 'node:crypto';
import {cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile} from 'node:fs/promises';
import {dirname, join, relative, resolve} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {promisify} from 'node:util';

const runFile = promisify(execFile);
const manifestPath = join('.agents', 'plugins', 'marketplace.json');
const pluginSource = new URL('./payload/plugins/jetcar/', import.meta.url);
const marketSource = new URL('./payload/.agents/plugins/marketplace.json', import.meta.url);
const officialRepo = 'https://github.com/jetcar-dev/jetcar-ai.git';
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

async function verifyPassword() {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error('PowerShell이나 Windows 터미널에서 설치 명령을 실행해 주세요.');
    }
    const silent = new Writable({write(_chunk, _encoding, done) { done(); }});
    const terminal = createInterface({input: process.stdin, output: silent, terminal: true, historySize: 0});
    const controller = new AbortController();
    terminal.once('SIGINT', () => controller.abort());
    terminal.once('close', () => controller.abort());
    let password;
    process.stdout.write('제트카 설치 비밀번호 (입력은 표시되지 않음): ');
    try {
        password = await terminal.question('', {signal: controller.signal});
    } finally {
        terminal.close();
        process.stdout.write('\n');
    }
    const actual = scryptSync(password, 'ba974df5f0e2988bb4b96f99c89464ae', 32);
    const expected = Buffer.from('15029c8f38f14c8ff44f5a9b9d023db5a81cdab2af1f049d9fa2babea8bed3ff', 'hex');
    if (!timingSafeEqual(actual, expected)) throw new Error('설치 비밀번호가 일치하지 않습니다.');
}

async function codexExecutable(localData) {
    const bin = join(localData, 'OpenAI', 'Codex', 'bin');
    const entries = await readdir(bin, {withFileTypes: true}).catch(() => []);
    const candidates = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async ({name}) => {
        const file = join(bin, name, 'codex.exe');
        const info = await stat(file).catch(() => undefined);
        if (info?.isFile()) return {file, modifiedAt: info.mtimeMs};
    }));
    const desktop = candidates.filter(Boolean).sort((a, b) => b.modifiedAt - a.modifiedAt)[0];
    if (desktop) return desktop.file;

    const installed = join(localData, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe');
    if ((await stat(installed).catch(() => undefined))?.isFile()) return installed;
    throw new Error('ChatGPT 데스크톱 앱에서 Codex를 한 번 연 뒤 설치 명령을 다시 실행해 주세요.');
}

async function publishPlugin(plugins, version) {
    const name = `jetcar-${version}`;
    const target = join(plugins, name);
    const published = () => stat(join(target, 'plugin.json')).then((file) => file.isFile(), () => false);
    if (await published()) return name;

    const staging = await mkdtemp(join(plugins, '.jetcar-'));
    try {
        await cp(pluginSource, staging, {recursive: true});
        await rename(staging, target).catch(async (error) => {
            if (!await published()) throw error;
        });
    } finally {
        if (dirname(resolve(staging)) !== resolve(plugins)) throw new Error('Invalid staging directory');
        await rm(staging, {recursive: true, force: true});
    }
    return name;
}

async function writeMarketplace(file, contents) {
    const temp = join(dirname(file), `.jetcar-${randomUUID()}.tmp`);
    try {
        await writeFile(temp, contents, {flag: 'wx'});
        await rename(temp, file);
    } finally {
        await rm(temp, {force: true});
    }
}

async function installPlugin() {
    const localData = process.env.LOCALAPPDATA;
    if (process.platform !== 'win32' || !localData) throw new Error('Windows에서 설치 명령을 실행해 주세요.');
    const executable = await codexExecutable(localData);
    const market = await readJson(marketSource);
    const {name, version} = await readJson(new URL('plugin.json', pluginSource));
    const plugin = market.plugins.find((entry) => entry.name === name);
    const root = join(localData, 'Jetcar', 'CodexMarketplace');
    const file = join(root, manifestPath);
    const plugins = join(root, 'plugins');
    const codex = async (...args) => {
        try {
            const result = await runFile(executable, [...args, '--json'], {windowsHide: true, cwd: root});
            return JSON.parse(result.stdout);
        } catch (error) {
            throw new Error(error.stderr?.trim() || error.message);
        }
    };

    await mkdir(dirname(file), {recursive: true});
    await mkdir(plugins, {recursive: true});
    const {marketplaces} = await codex('plugin', 'marketplace', 'list');
    const existing = marketplaces.find((entry) => entry.name === market.name);
    const sameRoot = existing && relative(existing.root, root) === '';
    const oldSource = existing && !sameRoot ? existing.marketplaceSource : undefined;
    if (existing && !sameRoot && (oldSource?.sourceType !== 'git' || oldSource.source !== officialRepo)) {
        throw new Error('Codex에 같은 이름의 다른 마켓플레이스가 등록되어 있습니다. 기존 제트카 도구 설정을 확인해 주세요.');
    }

    const previous = await readFile(file, 'utf8').catch((error) => {
        if (error.code !== 'ENOENT') throw error;
    });
    plugin.source.path = `./plugins/${await publishPlugin(plugins, version)}`;
    await writeMarketplace(file, JSON.stringify(market, null, 2) + '\n');

    let removed = false;
    let added = false;
    try {
        if (oldSource) {
            await codex('plugin', 'marketplace', 'remove', market.name);
            removed = true;
        }
        if (!sameRoot) {
            await codex('plugin', 'marketplace', 'add', root);
            added = true;
        }
        await codex('plugin', 'add', `${name}@${market.name}`);
    } catch (error) {
        try {
            if (added) await codex('plugin', 'marketplace', 'remove', market.name);
            if (removed) {
                const args = ['plugin', 'marketplace', 'add', oldSource.source];
                if (oldSource.ref) args.push('--ref', oldSource.ref);
                for (const path of oldSource.sparsePaths ?? []) args.push('--sparse', path);
                await codex(...args);
            }
            if (previous !== undefined) await writeMarketplace(file, previous);
            else await rm(file, {force: true});
        } catch (restoreError) {
            throw new Error(`${error.message}\n기존 마켓플레이스 복구 중 오류: ${restoreError.message}`);
        }
        throw error;
    }
    console.log(`제트카 ${version} 설치 완료. Codex를 다시 열고 제트카를 선택하세요.`);
}

try {
    await verifyPassword();
    await installPlugin();
} catch (error) {
    console.error(error.name === 'AbortError' ? '설치를 취소했습니다.' : `제트카 설치 오류: ${error.message}`);
    process.exitCode = 1;
}
