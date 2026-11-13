import type {McpServer} from '@modelcontextprotocol/server';
import {z} from 'zod';
import {browsers} from '../auth/browser-connection.js';
import {readExtensionLogin} from '../auth/playwright-extension.js';
import {cafeBoardUrl, resolveCafeTarget} from '../boards/target.js';
import {createEditorRequest} from '../shared/naver-request.js';
import {toolResult} from '../shared/tool-result.js';
import {loadImages, maxImages} from './images.js';
import {draftId, editorBlock, saveSmartEditorDraft} from './smart-editor.js';

export function registerSaveDraft(server: McpServer) {
    let pendingSave = Promise.resolve();

    server.registerTool('save_cafe_draft', {
        title: '네이버 카페 글 임시저장',
        description: 'Chrome 또는 Edge의 Playwright 확장 프로그램에서 네이버 로그인 세션을 받아 본문과 사진을 임시저장합니다. 반환된 question이 있으면 사용자에게 물어보고 답을 반영해 다시 호출하세요. temporaryArticleId를 주면 기존 임시글 끝에 blocks를 추가합니다.',
        inputSchema: z.object({
            title: z.string().trim().min(1).max(300).optional().describe('새 임시글에 필요합니다. 수정할 때 생략하면 기존 제목을 유지합니다.'),
            boardUrl: z.string().trim().min(1).max(4_096).optional().describe('네이버 카페 게시판 링크. 생략하면 설정된 기본 게시판이나 열린 탭의 게시판을 사용합니다.'),
            blocks: z.array(editorBlock).max(100).default([]).describe('문단, 인용구, 사진을 표시할 순서대로 입력합니다. 사진 file에는 NAVER_IMAGE_DIR 안의 파일 이름을 넣으세요.'),
            temporaryArticleId: draftId.optional().describe('수정할 네이버 카페 임시글의 ID. 생략하면 새 임시글을 만듭니다.'),
            representativeImage: z.number().int().positive().optional().describe('본문 사진 중 대표이미지 번호. 기존 사진을 포함하며 첫 사진이 1번입니다.'),
            browser: z.enum(browsers).optional().describe('사용자가 선택한 브라우저. 선택을 모르면 생략합니다.'),
            refreshLogin: z.boolean().optional().describe('이전 버전 호출과의 호환용입니다. 현재는 모든 요청에 브라우저의 최신 로그인 상태를 사용하므로 생략할 수 있습니다.'),
        }),
        annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true},
    }, async ({title, boardUrl, blocks, temporaryArticleId, representativeImage, browser}, {mcpReq: {signal}}) => {
        const target = resolveCafeTarget(boardUrl);
        const needsBoard = {
            status: 'needs_board_url',
            question: '임시저장할 네이버 카페 게시판 링크를 보내주세요.',
        };
        if (boardUrl !== undefined && !target) return toolResult(needsBoard);
        const imageFiles = blocks.flatMap((block) => block.type === 'image' ? [block.file] : []);
        if (temporaryArticleId === undefined && (!title || !blocks.length)) throw new Error('새 임시글에는 제목과 본문이 필요합니다.');
        if (imageFiles.length > maxImages) throw new Error(`한 번에 사진을 최대 ${maxImages}장 첨부할 수 있습니다.`);
        if (temporaryArticleId !== undefined && !title && !blocks.length && representativeImage === undefined) {
            throw new Error('변경할 제목, 추가할 본문, 대표이미지 중 하나를 입력하세요.');
        }
        const textLength = blocks.reduce((sum, block) => sum + (block.type === 'image' ? 0 : block.text.length), 0);
        if (textLength > 30_000) throw new Error('본문은 전체 30,000자 이하여야 합니다.');
        const save = pendingSave.then(async () => {
            signal.throwIfAborted();
            const photos = await loadImages([...new Set(imageFiles)]);
            signal.throwIfAborted();
            const login = await readExtensionLogin(browser, target, signal);
            if (!('loginHeader' in login) || !login.loginHeader) return toolResult(login);
            const saved = await saveSmartEditorDraft(login.board, title, blocks, photos, createEditorRequest(login.loginHeader, signal),
                {temporaryArticleId, representativeImage});
            return toolResult({
                status: 'saved_as_draft', ...saved,
                browser: login.name,
                boardUrl: cafeBoardUrl(login.board)
            });
        });
        pendingSave = save.then(() => {}, () => {});
        return save;
    });
}
