import {z} from 'zod';
import {cafeHeaders, createCafeReadRequest, type CafeRequest} from '../shared/naver-request.js';
import {toolResult} from '../shared/tool-result.js';
import {browsers, type BrowserName} from './browser-connection.js';
import {readExtensionSession} from './playwright-extension.js';
import type {McpServer} from '@modelcontextprotocol/server';

const identifierUrl = 'https://apis.naver.com/cafe-home-web/cafe-home/v1/member/identifier';

export function needsNaverLogin(browser: BrowserName) {
    return {status: 'needs_naver_login', loggedIn: false, browser,
        message: '연결한 Chrome 또는 Edge에서 네이버에 로그인한 뒤 다시 요청하세요.'};
}

export async function isNaverLoggedIn(request: CafeRequest) {
    const response = await request(identifierUrl, {headers: cafeHeaders});
    const data = await response.json().catch(() => null);
    if (response.status === 401 || String(data?.error?.errorCode) === '10004') return false;
    const loggedIn = data?.message?.result?.loggedIn;
    if (!response.ok || typeof loggedIn !== 'boolean') {
        throw new Error(`네이버 로그인 상태를 확인하지 못했습니다 (HTTP ${response.status}).`);
    }
    return loggedIn;
}

export function registerCheckLogin(server: McpServer) {
    server.registerTool('check_cafe_login', {
        title: '네이버 카페 로그인 상태 확인',
        description: '연결된 Chrome 또는 Edge 프로필의 로그인 상태가 네이버에서 아직 유효한지 확인합니다.',
        inputSchema: z.object({
            browser: z.enum(browsers).optional().describe('사용자가 선택한 브라우저. 선택을 모르면 생략합니다.'),
            reconnect: z.boolean().optional().describe('사용자가 브라우저 재연결을 요청했을 때만 true를 전달합니다.'),
        }),
        annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true},
    }, async ({browser, reconnect}, {mcpReq: {signal}}) => {
        const session = await readExtensionSession(browser, false, signal, reconnect);
        if (!('loginHeaderFor' in session) || !session.loginHeaderFor) return toolResult(session);
        const request = createCafeReadRequest(session.loginHeaderFor, signal);
        const loggedIn = !!session.loginHeaderFor('apis.naver.com') && await isNaverLoggedIn(request);
        const result = loggedIn
            ? {status: 'logged_in', loggedIn, browser: session.name, message: '네이버 로그인 상태가 유효합니다.'}
            : needsNaverLogin(session.name);
        return toolResult(result, result.message);
    });
}
