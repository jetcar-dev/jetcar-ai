import type {McpServer} from '@modelcontextprotocol/server';
import {z} from 'zod';
import {browsers} from '../auth/browser-connection.js';
import {resolveCafeSelection} from '../boards/cafe-selection.js';
import {cafeBoardUrl} from '../boards/target.js';
import {cafeHeaders} from '../shared/naver-request.js';
import {toolResult} from '../shared/tool-result.js';
import {draftId} from './smart-editor.js';

const dateField = z.union([z.number(), z.string()]).nullish();
const draftList = z.object({
    temporaryArticles: z.array(z.object({
        temporaryArticleId: draftId,
        subject: z.string().nullish(),
        menuId: draftId.nullish(),
        menu: z.object({menuId: draftId.nullish(), menuName: z.string().nullish(), name: z.string().nullish()}).nullish(),
        modifiedAt: dateField,
        writeDate: dateField,
    })),
});

function toIsoDate(value: string | number | null | undefined) {
    if (!value) return;
    const date = typeof value === 'number' || /^\d{10,13}$/.test(value)
        ? new Date(Number(value) < 1e12 ? Number(value) * 1000 : Number(value))
        : new Date(value);
    if (Number.isFinite(date.getTime())) return date.toISOString();
}

export function registerListDrafts(server: McpServer) {
    server.registerTool('list_cafe_drafts', {
        title: '네이버 카페 임시저장 글 목록',
        description: '지정한 카페에서 현재 네이버 계정의 임시저장 글 제목, ID, 게시판, 저장 시간을 조회합니다. 게시판 링크를 주어도 카페 전체 임시글을 조회합니다. 기존 글 수정 시 반환된 temporaryArticleId와 boardUrl을 사용하세요.',
        inputSchema: z.object({
            cafeUrl: z.string().trim().min(1).max(4_096).optional().describe('카페 홈 또는 게시판 링크. 생략하면 기본 카페나 연결된 카페 탭을 사용합니다.'),
            browser: z.enum(browsers).optional().describe('사용자가 선택한 브라우저. 선택을 모르면 생략합니다.'),
        }),
        annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true},
    }, async ({cafeUrl, browser}, {mcpReq: {signal}}) => {
        const target = await resolveCafeSelection(cafeUrl, browser, signal);
        if (!('request' in target) || !target.request) return toolResult(target);
        const {cafeId, request} = target;
        const response = await request(`https://apis.cafe.naver.com/editor/v1/cafes/${cafeId}/temporary-articles`, {headers: cafeHeaders});
        const data = await response.json().catch(() => null);
        if (response.status === 401 || String(data?.error?.errorCode) === '10004') {
            const message = '연결된 브라우저 프로필에서 네이버에 로그인한 뒤 다시 조회하세요.';
            return toolResult({status: 'needs_naver_login', browser: target.browser, message}, message);
        }
        if (!response.ok) throw new Error(`임시저장 글 목록을 조회하지 못했습니다 (HTTP ${response.status}).`);
        const parsed = draftList.safeParse(data?.result ?? data);
        if (!parsed.success) throw new Error('네이버의 임시저장 글 목록 형식을 확인할 수 없습니다.');
        const drafts = parsed.data.temporaryArticles.map((draft) => {
            const menuId = draft.menu?.menuId ?? draft.menuId;
            return {
                temporaryArticleId: String(draft.temporaryArticleId),
                title: draft.subject?.trim() || '(제목 없음)',
                ...(menuId && {menuId: String(menuId), boardUrl: cafeBoardUrl({cafeId, menuId: String(menuId)})}),
                boardName: draft.menu?.menuName ?? draft.menu?.name ?? undefined,
                savedAt: toIsoDate(draft.modifiedAt) ?? toIsoDate(draft.writeDate),
            };
        });
        const lines = drafts.map(({title, temporaryArticleId, boardName, menuId, savedAt}) => {
            const board = boardName ?? (menuId ? `${menuId}번 게시판` : undefined);
            return [`- ${title} (임시글 ID ${temporaryArticleId})`, board, savedAt].filter(Boolean).join(' · ');
        });
        return toolResult({status: 'listed', cafeId, browser: target.browser, drafts},
            lines.join('\n') || '이 카페에 저장된 임시글이 없습니다.');
    });
}
