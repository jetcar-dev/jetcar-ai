import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {oauthConfig} from './config.js';
import {completeLogin} from './oauth.js';

async function login() {
    const config = oauthConfig();
    const state = randomBytes(32).toString('hex');
    const authorize = new URL('https://nid.naver.com/oauth2.0/authorize');
    authorize.search = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: config.callback.href,
        state,
    }).toString();

    await new Promise<void>((resolve, reject) => {
        let accepted = false;
        const server = createServer(async (request, response) => {
            const reply = (status: number, message: string) => {
                response.writeHead(status, {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Cache-Control': 'no-store',
                    'Referrer-Policy': 'no-referrer',
                });
                response.end(message);
            };
            const url = URL.parse(request.url ?? '/', config.callback);
            if (request.method !== 'GET' || url?.pathname !== config.callback.pathname || request.headers.host !== config.callback.host) {
                reply(404, '잘못된 요청입니다.');
                return;
            }
            if (accepted || url.searchParams.get('state') !== state) {
                reply(400, '인증 요청이 일치하지 않거나 이미 처리됐습니다.');
                return;
            }
            accepted = true;
            clearTimeout(timeout);
            try {
                const code = url.searchParams.get('code');
                if (!code || url.searchParams.has('error')) throw new Error('네이버 로그인이 취소되었거나 인증이 거절됐습니다.');
                await completeLogin(config, code, state);
                reply(200, '네이버 계정 연결이 완료되었습니다. 이 창을 닫아도 됩니다.');
                resolve();
            } catch (error) {
                reply(400, '네이버 계정을 연결하지 못했습니다. 터미널에서 오류를 확인하세요.');
                reject(error);
            } finally {
                server.close();
            }
        });
        const timeout = setTimeout(() => {
            server.close();
            reject(new Error('로그인 대기 시간이 끝났습니다. npm run login을 다시 실행하세요.'));
        }, 5 * 60_000);
        server.once('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        server.listen(Number(config.callback.port), config.callback.hostname, () => {
            console.log(`브라우저에서 이 주소를 열어 네이버에 로그인하세요.\n${authorize.href}`);
        });
    });
    console.log('네이버 계정 연결 완료');
}

login().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
});
