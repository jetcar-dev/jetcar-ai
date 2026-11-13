import type {McpServer} from '@modelcontextprotocol/server';
import {z} from 'zod';
import {browsers} from '../auth/browser-connection.js';
import {toolResult} from '../shared/tool-result.js';
import {listCafeBoards} from './boards.js';
import {resolveCafeSelection} from './cafe-selection.js';

export function registerListBoards(server: McpServer) {
    server.registerTool('list_cafe_boards', {
        title: '네이버 카페 게시판 목록 조회',
        description: '게시판 이름, 번호, 그룹, 링크를 조회합니다. 사용자에게 보여줄 때 하위 게시판의 들여쓰기를 유지하세요.',
        inputSchema: z.object({
            cafeUrl: z.string().trim().min(1).max(4_096).optional().describe('네이버 카페 홈 또는 게시판 링크. 생략하면 기본 카페나 연결된 카페 탭을 사용합니다.'),
            browser: z.enum(browsers).optional().describe('사용자가 선택한 브라우저. 선택을 모르면 생략합니다.'),
        }),
        annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true},
    }, async ({cafeUrl, browser}, {mcpReq: {signal}}) => {
        const target = await resolveCafeSelection(cafeUrl, browser, signal);
        if (!('request' in target) || !target.request) return toolResult(target);
        const {cafeId, request} = target;
        const {boards, menuTree} = await listCafeBoards(cafeId, request);
        const label = ({name, menuId}: {name: string; menuId: string}) => `${name} (${menuId}번)`;
        const lines = menuTree.flatMap((entry) => 'boards' in entry
            ? [`- ${entry.name}`, ...entry.boards.map((board) => `  - ${label(board)}`)]
            : [`- ${label(entry)}`]);
        return toolResult({status: 'listed', cafeId, browser: target.browser, boards, menuTree},
            lines.join('\n') || '조회할 수 있는 게시판이 없습니다.');
    });
}
