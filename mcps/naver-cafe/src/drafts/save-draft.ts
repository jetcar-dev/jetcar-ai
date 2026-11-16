import type {McpServer} from '@modelcontextprotocol/server';
import {z} from 'zod';
import {blockTextLength, editorBlock} from '../../../smart-editor-one/src/editor-blocks.js';
import {documentIdSchema, readPreparedDocument} from '../../../smart-editor-one/src/prepared-documents.js';
import {loadEditorMedia} from '../../../smart-editor-one/src/uploads/media.js';
import {browsers} from '../auth/browser-connection.js';
import {readExtensionLogin} from '../auth/playwright-extension.js';
import {cafeBoardUrl, resolveCafeTarget} from '../boards/target.js';
import {imageDirectory} from '../shared/config.js';
import {createCafeDraftRequest} from '../shared/naver-request.js';
import {toolResult} from '../shared/tool-result.js';
import {DraftPreparationError, draftId, saveCafeDraft} from './draft-client.js';

export function registerSaveDraft(server: McpServer) {
    let pendingSave = Promise.resolve();

    server.registerTool('save_cafe_draft', {
        title: '네이버 카페 글 임시저장',
        description: '네이버 카페에 원고를 임시저장합니다. 스마트에디터에서 가져온 파일은 preparedDocumentId로 그대로 저장합니다. 직접 구성한 원고는 title과 blocks를 사용합니다. temporaryArticleId를 주면 기존 임시글 끝에 blocks를 추가합니다.',
        inputSchema: z.object({
            preparedDocumentId: documentIdSchema.optional().describe('가져온 원고를 새 임시글로 저장할 때 사용합니다.'),
            title: z.string().trim().min(1).max(300).optional().describe('새 임시글에 필요합니다. 수정할 때 생략하면 기존 제목을 유지합니다.'),
            boardUrl: z.string().trim().min(1).max(4_096).optional().describe('네이버 카페 게시판 링크. 생략하면 설정된 기본 게시판이나 열린 탭의 게시판을 사용합니다.'),
            blocks: z.array(editorBlock).max(100).default([]).describe('문단, 인용구, 표, 구분선, 사진, MP4를 표시할 순서대로 입력합니다. 사진과 동영상 file에는 NAVER_IMAGE_DIR 안의 파일 이름을 넣으세요.'),
            temporaryArticleId: draftId.optional().describe('수정할 네이버 카페 임시글의 ID. 생략하면 새 임시글을 만듭니다.'),
            representativeImage: z.number().int().positive().optional().describe('본문 사진 중 대표이미지 번호. 기존 사진을 포함하며 첫 사진이 1번입니다.'),
            browser: z.enum(browsers).optional().describe('사용자가 선택한 브라우저. 선택을 모르면 생략합니다.'),
            refreshLogin: z.boolean().optional().describe('이전 버전 호출과의 호환용입니다. 현재는 모든 요청에 브라우저의 최신 로그인 상태를 사용하므로 생략할 수 있습니다.'),
        }),
        annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true},
    }, async ({preparedDocumentId, title, boardUrl, blocks, temporaryArticleId, representativeImage, browser}, {mcpReq: {signal}}) => {
        const target = resolveCafeTarget(boardUrl);
        const needsBoard = {
            status: 'needs_board_url',
            question: '임시저장할 네이버 카페 게시판 링크를 보내주세요.',
        };
        if (boardUrl !== undefined && !target) return toolResult(needsBoard);
        if (preparedDocumentId && (title !== undefined || blocks.length || representativeImage !== undefined || temporaryArticleId !== undefined)) {
            throw new Error('가져온 원고 ID는 새 임시글에 사용합니다. 제목, 본문, 대표사진, 기존 임시글 ID와 함께 전달하지 마세요.');
        }
        if (!preparedDocumentId && temporaryArticleId === undefined && (!title || !blocks.length)) throw new Error('새 임시글에는 제목과 본문이 필요합니다.');
        if (temporaryArticleId !== undefined && !title && !blocks.length && representativeImage === undefined) {
            throw new Error('변경할 제목, 추가할 본문, 대표이미지 중 하나를 입력하세요.');
        }
        const textLength = blocks.reduce((sum, block) => sum + blockTextLength(block), 0);
        if (textLength > 30_000) throw new Error('본문은 전체 30,000자 이하여야 합니다.');
        const save = pendingSave.then(async () => {
            signal.throwIfAborted();
            const prepared = preparedDocumentId ? await readPreparedDocument(preparedDocumentId) : undefined;
            const draft = prepared?.record.draft ?? {title, blocks, representativeImage};
            const embedded = prepared?.record.embeddedImageNames;
            const embeddedNames = embedded && new Set(embedded);
            const media = await loadEditorMedia(draft.blocks, (name) => prepared?.attachmentDirectory &&
                (!embeddedNames || embeddedNames.has(name)) ? prepared.attachmentDirectory : imageDirectory());
            signal.throwIfAborted();
            const login = await readExtensionLogin(browser, target, signal);
            if (!('loginHeader' in login) || !login.loginHeader) return toolResult(login);
            const boardUrl = cafeBoardUrl(login.board);
            const request = createCafeDraftRequest(login.loginHeader, signal);
            try {
                const saved = await saveCafeDraft(login.board, draft.title, draft.blocks, media, request,
                    {temporaryArticleId, representativeImage: draft.representativeImage, signal});
                return toolResult({status: 'saved_as_draft', ...saved, browser: login.name, boardUrl});
            } catch (error) {
                signal.throwIfAborted();
                if (!(error instanceof DraftPreparationError)) throw error;
                const message = `${error.message} 임시저장 요청을 보내기 전에 중단됐습니다.`;
                return {
                    ...toolResult({status: 'draft_preparation_failed', browser: login.name, boardUrl, message}, message),
                    isError: true,
                };
            }
        });
        pendingSave = save.then(() => {}, () => {});
        return save;
    });
}
