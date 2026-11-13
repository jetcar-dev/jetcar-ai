import type {McpServer} from '@modelcontextprotocol/server';
import {z} from 'zod';
import {browsers, type BrowserName} from '../auth/browser-connection.js';
import {isNaverLoggedIn, needsNaverLogin} from '../auth/check-login.js';
import {readExtensionSession} from '../auth/playwright-extension.js';
import {cafeBoardUrl, resolveCafeTarget} from '../boards/target.js';
import {createCafeReadRequest} from '../shared/naver-request.js';
import {toolResult} from '../shared/tool-result.js';
import {readArticleBodies, readArticlePage} from './articles.js';

async function articleSession(browser: BrowserName | undefined, signal: AbortSignal) {
    const session = await readExtensionSession(browser, false, signal);
    if (!('loginHeaderFor' in session) || !session.loginHeaderFor) return session;
    if (!session.loginHeaderFor('apis.naver.com')) return needsNaverLogin(session.name);
    return {browser: session.name, request: createCafeReadRequest(session.loginHeaderFor, signal)};
}

export function registerListArticles(server: McpServer) {
    server.registerTool('list_cafe_articles', {
        title: '네이버 카페 게시글 목록 및 본문 조회',
        description: '지정한 게시판의 게시글을 최신순으로 조회합니다. 전체 본문이 필요하면 bodyMode=full, 글 앞부분만 필요하면 preview, 제목·날짜 등 목록만 필요하면 none을 사용하세요. 공개 게시글은 브라우저 연결 없이 조회합니다.',
        inputSchema: z.object({
            boardUrl: z.string().trim().min(1).max(4_096).optional().describe('조회할 네이버 카페 게시판 링크. 생략하면 설정된 기본 게시판을 사용합니다.'),
            page: z.number().int().positive().default(1).describe('조회할 페이지. 다음 조회에는 응답의 nextPage를 사용합니다.'),
            pageSize: z.number().int().min(1).max(50).default(20).describe('한 페이지당 글 수. 이어서 조회할 때 같은 값을 유지합니다.'),
            bodyMode: z.enum(['none', 'preview', 'full']).default('full').describe('none: 목록만, preview: 네이버가 제공하는 본문 앞부분, full: 전체 본문 텍스트.'),
            useLogin: z.boolean().optional().describe('회원 전용 등 로그인한 계정으로 조회해야 할 때 true. 공개 게시판은 생략합니다.'),
            browser: z.enum(browsers).optional().describe('로그인 조회에 사용할 Chrome 또는 Edge. 사용자가 지정한 경우만 전달합니다.'),
        }),
        annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true},
    }, async ({boardUrl, page, pageSize, bodyMode, useLogin, browser}, {mcpReq: {signal}}) => {
        const board = resolveCafeTarget(boardUrl);
        if (!board) return toolResult({status: 'needs_board_url', question: '조회할 네이버 카페 게시판 링크를 보내주세요.'});

        let request = createCafeReadRequest(() => undefined, signal);
        let connectedBrowser: BrowserName | undefined;
        let login: ReturnType<typeof articleSession> | undefined;
        const connect = () => login ??= articleSession(browser, signal);
        if (useLogin || browser) {
            const session = await connect();
            if (!('request' in session) || !session.request) return toolResult(session);
            ({request, browser: connectedBrowser} = session);
        }

        let result = await readArticlePage(board, page, pageSize, request);
        if (result.status === 'access_denied' && !connectedBrowser) {
            const session = await connect();
            if (!('request' in session) || !session.request) return toolResult(session);
            ({request, browser: connectedBrowser} = session);
            result = await readArticlePage(board, page, pageSize, request);
        }
        if (result.status === 'access_denied') {
            if (connectedBrowser && !await isNaverLoggedIn(request)) return toolResult(needsNaverLogin(connectedBrowser));
            return toolResult({status: 'board_access_denied', ...board, message: '현재 네이버 계정으로 이 게시판을 읽을 권한이 없습니다.'});
        }

        const ids = result.articles.map(({articleId}) => articleId);
        const bodies = bodyMode === 'full' ? await readArticleBodies(board, ids, request, signal) : undefined;
        let loginAction;
        if (bodies && !connectedBrowser) {
            const denied = ids.filter((id) => bodies.get(id)?.bodyStatus === 'access_denied');
            if (denied.length) {
                const session = await connect();
                if ('request' in session && session.request) {
                    connectedBrowser = session.browser;
                    const retried = await readArticleBodies(board, denied, session.request, signal);
                    for (const [id, body] of retried) bodies.set(id, body);
                } else {
                    loginAction = session;
                }
            }
        }

        const articles = result.articles.map(({preview, ...article}) => bodyMode === 'preview'
            ? {...article, preview} : {...article, ...bodies?.get(article.articleId)});
        const bodiesLoaded = bodies && [...bodies.values()].filter(({bodyStatus}) => bodyStatus === 'loaded').length;
        const message = articles.length
            ? `게시글 ${articles.length}개를 조회했습니다.${bodiesLoaded === undefined ? '' : ` 본문 ${bodiesLoaded}개를 가져왔습니다.`}`
            : '이 페이지에 조회할 수 있는 게시글이 없습니다.';
        return toolResult({status: 'listed', ...board, boardUrl: boardUrl ?? cafeBoardUrl(board), browser: connectedBrowser,
            page, pageSize, nextPage: result.nextPage, bodyMode, articles, bodiesLoaded, loginAction}, message);
    });
}
