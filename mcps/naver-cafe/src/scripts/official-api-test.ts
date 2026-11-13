import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {parseArgs} from 'node:util';
import {z} from 'zod';
import '../shared/config.js';
import {cafeBoardUrl, resolveCafeTarget, type CafeTarget} from '../boards/target.js';

function receiveAuthorizationCode(callback: URL, authorize: URL, state: string) {
    return new Promise<string>((resolve, reject) => {
        const server = createServer((req, res) => {
            const reply = (status: number, message: string) => {
                res.writeHead(status, {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Cache-Control': 'no-store',
                    'Referrer-Policy': 'no-referrer',
                }).end(message);
            };
            const url = URL.parse(req.url ?? '/', callback);
            if (req.method !== 'GET' || req.headers.host !== callback.host || url?.origin !== callback.origin) {
                reply(404, '잘못된 요청입니다.');
                return;
            }
            if (url.pathname === '/oauth/naver/start') {
                res.writeHead(302, {Location: authorize.href, 'Cache-Control': 'no-store'}).end();
                return;
            }
            if (url.pathname !== callback.pathname || url.searchParams.get('state') !== state) {
                reply(400, '인증 요청이 일치하지 않습니다.');
                return;
            }
            const code = url.searchParams.get('code');
            if (code && !url.searchParams.has('error')) {
                reply(200, '네이버 인증 응답을 받았습니다. 터미널에서 결과를 확인하세요.');
                resolve(code);
            } else {
                reply(400, '네이버 로그인이 취소되었거나 거절됐습니다.');
                reject(new Error('네이버 로그인이 완료되지 않았습니다.'));
            }
            clearTimeout(timer);
            server.close();
        });
        const timer = setTimeout(() => {
            server.close();
            reject(new Error('네이버 로그인 대기 시간이 끝났습니다.'));
        }, 5 * 60_000);
        server.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        server.listen(Number(callback.port), callback.hostname, () => {
            console.log(`브라우저에서 네이버 로그인 열기\n${new URL('/oauth/naver/start', callback).href}`);
        });
    });
}

async function signIn() {
    const clientId = process.env.NAVER_CLIENT_ID?.trim();
    const clientSecret = process.env.NAVER_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) throw new Error('.env에 NAVER_CLIENT_ID와 NAVER_CLIENT_SECRET을 설정하세요.');
    const port = Number(process.env.NAVER_CALLBACK_PORT ?? '43127');
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('NAVER_CALLBACK_PORT를 확인하세요.');
    const callback = new URL(`http://127.0.0.1:${port}/oauth/naver/callback`);
    const state = randomBytes(32).toString('hex');
    const authorize = new URL('https://nid.naver.com/oauth2.0/authorize');
    authorize.search = new URLSearchParams({
        response_type: 'code', client_id: clientId, redirect_uri: callback.href, state,
    }).toString();
    const code = await receiveAuthorizationCode(callback, authorize, state);
    const response = await fetch('https://nid.naver.com/oauth2.0/token', {
        method: 'POST',
        body: new URLSearchParams({grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, code, state}),
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json().catch(() => null);
    const token = z.string().min(1).safeParse(data?.access_token);
    if (!response.ok || !token.success) {
        const code = typeof data?.error === 'string' && /^[a-z_]+$/.test(data.error) ? `, ${data.error}` : '';
        throw new Error(`네이버 토큰 발급에 실패했습니다 (HTTP ${response.status}${code}). 앱과 Callback URL 설정을 확인하세요.`);
    }
    console.log('네이버 공식 OAuth 토큰 발급을 확인했습니다.');
    return token.data;
}

async function publishTestArticle(target: CafeTarget, subject: string, content: string, token: string) {
    const response = await fetch(`https://openapi.naver.com/v1/cafe/${target.cafeId}/menu/${target.menuId}/articles`, {
        method: 'POST',
        headers: {Authorization: `Bearer ${token}`},
        body: new URLSearchParams({
            subject, content, openyn: 'false', searchopen: 'false', scrapyn: 'false', metoo: 'false',
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
    }).catch(() => undefined);
    const data = await response?.json().catch(() => null);
    const article = data?.message?.result;
    const url = typeof article?.articleUrl === 'string' ? URL.parse(article.articleUrl) : null;
    if (response?.ok && Number(data?.message?.status) === 200 && Number.isSafeInteger(Number(article?.articleId)) &&
        Number(article.articleId) > 0 && url?.hostname === 'cafe.naver.com' && !url.port && !url.username && !url.password) {
        url.protocol = 'https:';
        console.log(`게시 완료\n${url.href}`);
        return;
    }
    if (response && response.status >= 400 && response.status < 500 && response.status !== 408) {
        const code = data?.message?.error?.code ?? data?.errorCode;
        const detail = typeof code === 'string' && /^[a-z\d]{1,12}$/i.test(code) ? `, ${code}` : '';
        throw new Error(`네이버가 게시 요청을 거절했습니다 (HTTP ${response.status}${detail}).`);
    }
    throw new Error('게시 결과를 확인할 수 없습니다. 중복 게시를 피하려면 다시 요청하기 전에 게시판을 확인하세요.');
}

async function main() {
    const {values} = parseArgs({options: {
        'login-only': {type: 'boolean'},
        publish: {type: 'boolean'},
        'board-url': {type: 'string'},
    }});
    if (values['login-only'] && values.publish) throw new Error('--login-only와 --publish는 따로 사용하세요.');
    if (values['login-only']) {
        await signIn();
        return;
    }
    const template = await readFile(new URL('../../examples/official-api-test.html', import.meta.url), 'utf8');
    if (!values.publish) {
        console.log(template);
        return;
    }
    const target = values['board-url'] && resolveCafeTarget(values['board-url']);
    if (!target) throw new Error('게시할 카페 게시판 링크를 --board-url로 입력하세요.');
    const subject = /<title>([^<]+)<\/title>/i.exec(template)?.[1].trim();
    const content = /<body>([\s\S]*?)<\/body>/i.exec(template)?.[1].trim();
    if (!subject || !content) throw new Error('HTML 템플릿에 제목과 본문이 필요합니다.');
    console.log(`멤버 공개 테스트 게시물\n${subject}\n${cafeBoardUrl(target)}`);
    await publishTestArticle(target, subject, content, await signIn());
}

main().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
});
