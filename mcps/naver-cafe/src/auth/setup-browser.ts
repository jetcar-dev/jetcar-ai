import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {browsers, extensionProfiles, saveBrowserConnection} from './browser-connection.js';
import '../shared/config.js';

const browserLabels = {chrome: 'Chrome', edge: 'Edge'};

async function main() {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error('PowerShell 또는 터미널에서 브라우저 연결 명령을 실행하세요.');
    }
    const options = (await Promise.all(browsers.map(async (browser) =>
        (await extensionProfiles(browser)).map((profile) => ({browser, profile}))))).flat();
    if (!options.length) throw new Error('Chrome 또는 Edge에 Playwright Extension을 설치한 뒤 다시 실행하세요.');
    let hideInput = false;
    const output = new Writable({
        write(chunk, encoding, done) {
            if (hideInput) done();
            else process.stdout.write(chunk, encoding, done);
        },
    });
    const terminal = createInterface({input: process.stdin, output, terminal: true, historySize: 0});
    const abort = new AbortController();
    terminal.on('SIGINT', () => abort.abort());
    terminal.on('close', () => abort.abort());
    try {
        for (const [index, {browser, profile}] of options.entries()) {
            console.log(`${index + 1}. ${browserLabels[browser]} (${profile})`);
        }
        const selection = options.length === 1 ? 1 : Number(await terminal.question('연결할 브라우저 번호: ', {signal: abort.signal}));
        const selected = Number.isInteger(selection) ? options[selection - 1] : undefined;
        if (!selected) throw new Error('목록에 표시된 브라우저 번호를 입력하세요.');
        console.log('선택한 브라우저 프로필에서 Playwright Extension 아이콘을 누르고, 열린 화면의 토큰 옆 복사 버튼을 누르세요.');
        process.stdout.write('토큰 붙여넣기 (입력은 화면에 표시되지 않음): ');
        hideInput = true;
        const input = await terminal.question('', {signal: abort.signal});
        process.stdout.write('\n');
        const token = input.trim().replace(/^PLAYWRIGHT_MCP_EXTENSION_TOKEN\s*=\s*/, '').trim();
        await saveBrowserConnection(selected.browser, {profile: selected.profile, token});
        console.log(`${browserLabels[selected.browser]} 연결 정보를 이 컴퓨터의 사용자 설정에 저장했습니다.`);
    } finally {
        terminal.close();
    }
}

main().catch((error: Error) => {
    console.error(error.name === 'AbortError' ? '브라우저 연결 설정을 취소했습니다.' : error.message);
    process.exitCode = 1;
});
