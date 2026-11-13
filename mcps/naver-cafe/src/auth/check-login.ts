import {z} from 'zod';
import {cafeHeaders, createCafeReadRequest} from '../shared/naver-request.js';
import {toolResult} from '../shared/tool-result.js';
import {browsers} from './browser-connection.js';
import {readExtensionSession} from './playwright-extension.js';
import type {McpServer} from '@modelcontextprotocol/server';

const identifierUrl = 'https://apis.naver.com/cafe-home-web/cafe-home/v1/member/identifier';

export function registerCheckLogin(server: McpServer) {
    server.registerTool('check_cafe_login', {
        title: '네이버 카페 로그인 상태 확인',
        description: '연결된 Chrome 또는 Edge 프로필의 로그인 상태가 네이버에서 아직 유효한지 확인합니다.',
        inputSchema: z.object({
            browser: z.enum(browsers).optional().describe('사용자가 선택한 브라우저. 선택을 모르면 생략합니다.'),
        }),
        annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true},
    }, async ({browser}, {mcpReq: {signal}}) => {
        const session = await readExtensionSession(browser, false, signal);
        if (!('loginHeaderFor' in session) || !session.loginHeaderFor) return toolResult(session);
        let loggedIn = false;
        if (session.loginHeaderFor('apis.naver.com')) {
            const request = createCafeReadRequest(session.loginHeaderFor, signal);
            const response = await request(identifierUrl, {headers: cafeHeaders});
            const data = await response.json().catch(() => null);
            if (response.status !== 401 && String(data?.error?.errorCode) !== '10004') {
                if (!response.ok || typeof data?.message?.result?.loggedIn !== 'boolean') {
                    throw new Error(`네이버 로그인 상태를 확인하지 못했습니다 (HTTP ${response.status}).`);
                }
                loggedIn = data.message.result.loggedIn;
            }
        }
        const status = loggedIn ? 'logged_in' : 'needs_naver_login';
        const message = loggedIn ? '네이버 로그인 상태가 유효합니다.' : '연결된 브라우저 프로필에서 네이버에 로그인하세요.';
        return toolResult({status, loggedIn, browser: session.name, message}, message);
    });
}
