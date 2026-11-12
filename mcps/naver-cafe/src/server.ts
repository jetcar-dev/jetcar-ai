import {randomUUID} from 'node:crypto';
import {McpServer} from '@modelcontextprotocol/server';
import {serveStdio} from '@modelcontextprotocol/server/stdio';
import {z} from 'zod';
import {cafeBoardUrl, resolveCafeTarget} from './board.js';
import {formatBody, loadImages, maxImages, publishArticle, type Draft} from './cafe.js';
import {createTokenProvider} from './oauth.js';

const draftLifetime = 30 * 60_000;

function createServer() {
    const server = new McpServer({name: 'naver-cafe', version: '0.1.0'});
    const drafts = new Map<string, { post: Draft; expiresAt: number; inUse: boolean }>();
    const getToken = createTokenProvider();
    let preparing = false;

    function result(data: Record<string, unknown>) {
        return {content: [{type: 'text' as const, text: JSON.stringify(data)}], structuredContent: data};
    }

    server.registerTool('preview_cafe_post', {
        title: '네이버 카페 게시글 미리보기',
        description: '네이버 카페 게시판 링크에서 게시 대상을 확인하고 제목, 본문과 사진 파일 목록을 미리 보여줍니다. 대화에 게시판 링크가 있으면 boardUrl에 전달하세요. status가 needs_board_url이면 반환된 question을 사용자에게 물어보세요. 미리보기는 게시하지 않습니다.',
        inputSchema: z.object({
            title: z.string().trim().min(1).max(300),
            body: z.string().trim().min(1).max(30_000),
            boardUrl: z.string().trim().min(1).max(4_096).optional().describe('네이버 카페 게시판 링크. 생략하면 설정된 기본 게시판을 사용합니다.'),
            format: z.enum(['text', 'html']).default('text'),
            imageFiles: z.array(z.string().min(1).max(255)).max(maxImages).default([]),
            publicPost: z.boolean().default(false).describe('true는 전체 공개 및 검색 허용, false는 카페 멤버 공개입니다.'),
        }),
        annotations: {readOnlyHint: true, openWorldHint: false},
    }, async ({title, body, boardUrl, format, imageFiles, publicPost}) => {
        const target = resolveCafeTarget(boardUrl);
        if (!target) {
            return result({
                status: 'needs_board_url',
                question: '어느 게시판에 올릴까요? 네이버 카페에서 해당 게시판을 연 뒤 그 링크를 보내주세요.',
            });
        }
        for (const [id, entry] of drafts) {
            if (!entry.inUse && entry.expiresAt <= Date.now()) drafts.delete(id);
        }
        if (preparing || drafts.size >= 4) throw new Error('처리 중이거나 유효한 미리보기가 많습니다. 기존 글을 게시하거나 만료 후 다시 시도하세요.');
        preparing = true;
        try {
            const html = formatBody(body, format);
            const images = await loadImages(imageFiles);
            const previewId = randomUUID();
            const expiresAt = Date.now() + draftLifetime;
            drafts.set(previewId, {post: {target, title, html, images, publicPost}, expiresAt, inUse: false});
            return result({
                previewId, target, boardUrl: cafeBoardUrl(target), title, bodyHtml: html, publicPost,
                images: images.map(({name, blob, sha256}) => ({name, bytes: blob.size, sha256})),
                expiresAt: new Date(expiresAt).toISOString(),
            });
        } finally {
            preparing = false;
        }
    });

    server.registerTool('publish_cafe_post', {
        title: '네이버 카페 게시글 등록',
        description: '사용자가 해당 미리보기의 게시를 요청한 뒤에만 호출하세요. 확인한 내용과 사진을 지정 게시판에 한 번 등록하고 게시글 링크를 반환합니다.',
        inputSchema: z.object({previewId: z.uuid(), confirmed: z.literal(true)}),
        annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true},
    }, async ({previewId}) => {
        const draft = drafts.get(previewId);
        if (!draft || draft.expiresAt <= Date.now()) throw new Error('유효한 미리보기를 찾을 수 없습니다. 미리보기를 다시 생성하세요.');
        if (draft.inUse) throw new Error('이미 이 글의 게시 요청을 처리하고 있습니다.');
        draft.inUse = true;
        let token: string;
        try {
            token = await getToken();
        } catch (error) {
            draft.inUse = false;
            throw error;
        }
        drafts.delete(previewId);
        if (draft.expiresAt <= Date.now()) throw new Error('미리보기가 만료됐습니다. 미리보기를 다시 생성하세요.');
        return result(await publishArticle(draft.post, token));
    });

    return server;
}

serveStdio(createServer);
