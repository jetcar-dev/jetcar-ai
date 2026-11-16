import {z} from 'zod';
import {buildEditorUpdate, editorContentSchema, planEditorUpdate} from '../../../smart-editor-one/src/editor-document.js';
import type {EditorBlock} from '../../../smart-editor-one/src/editor-blocks.js';
import {EditorUploadError, type EditorMedia} from '../../../smart-editor-one/src/uploads/media.js';
import type {EditorRequest} from '../../../smart-editor-one/src/uploads/request.js';
import type {CafeTarget} from '../boards/target.js';
import {cafeHeaders, type CafeRequest} from '../shared/naver-request.js';

const editorApi = 'https://apis.cafe.naver.com/editor';
const uncertain = '임시저장 결과를 확인할 수 없습니다. 다시 저장하기 전에 카페 글쓰기 화면의 임시등록 목록을 확인하세요.';

export const draftId = z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/)]);
type DraftId = z.infer<typeof draftId>;

const savedArticle = z.object({
    subject: z.string(),
    menuId: draftId.optional(),
    headId: z.number().nullish(),
    noticeType: z.string().nullish(),
    tagList: z.array(z.string()).nullish(),
    contentJson: z.unknown(),
});

async function readJson(request: CafeRequest, url: string | URL, headers: HeadersInit, step: string) {
    const response = await request(url, {headers}).catch(() => null);
    const data = await response?.json().catch(() => null);
    if (!response?.ok || !data || data.error) {
        const rawCode = data?.error?.errorCode;
        const code = /^(?:\d{4,6}|[A-Z]{2,5}\d{2,5})$/.test(String(rawCode)) ? `, ${rawCode}` : '';
        const detail = String(rawCode) === '10004' || response?.status === 401
            ? ' 네이버 웹 로그인 세션을 확인하세요.'
            : String(rawCode) === '33007' ? ' 카페 스탭만 글을 쓸 수 있는 게시판입니다.' : '';
        throw new Error(`${step}에 실패했습니다${response ? `(HTTP ${response.status}${code})` : ''}.${detail}`);
    }
    return data;
}

export class DraftPreparationError extends Error {}

async function editorInfo(request: CafeRequest, target: CafeTarget) {
    const info = await readJson(
        request,
        `${editorApi}/v2/cafes/${target.cafeId}/editor?menuId=${target.menuId}&from=pc`,
        cafeHeaders, '카페 글쓰기 설정 조회',
    ).catch((error: Error) => {
        throw new DraftPreparationError(error.message, {cause: error});
    });
    return info.result;
}

function draftEndpoint(target: CafeTarget, temporaryArticleId?: DraftId) {
    const endpoint = `${editorApi}/v2/cafes/${target.cafeId}/temporary-articles`;
    return temporaryArticleId === undefined ? endpoint : `${endpoint}/${temporaryArticleId}`;
}

export async function readDraft(request: CafeRequest, target: CafeTarget, temporaryArticleId: DraftId) {
    const data = await readJson(request, `${draftEndpoint(target, temporaryArticleId)}?from=pc`, cafeHeaders, '기존 임시글 조회');
    const result = data.result;
    const article = savedArticle.parse(result?.article);
    const menuId = result?.selectedMenu?.menu?.menuId ?? article.menuId;
    if (String(menuId) !== String(target.menuId)) throw new Error('이 임시글의 게시판이 요청한 게시판과 일치하지 않습니다.');
    const content = typeof article.contentJson === 'string' ? JSON.parse(article.contentJson) : article.contentJson;
    return {article, content: editorContentSchema.parse(content)};
}

export async function saveCafeDraft(
    target: CafeTarget, title: string | undefined, blocks: EditorBlock[], media: EditorMedia, request: CafeRequest,
    {temporaryArticleId, representativeImage, signal, uploadRequest}: {
        temporaryArticleId?: DraftId; representativeImage?: number; signal?: AbortSignal; uploadRequest?: EditorRequest;
    } = {},
) {
    const existing = temporaryArticleId === undefined ? undefined : await readDraft(request, target, temporaryArticleId);
    const subject = title ?? existing?.article.subject;
    if (!subject) throw new Error('새 임시글의 제목을 입력하세요.');
    const plan = planEditorUpdate(existing?.content, blocks, representativeImage);
    const info = await editorInfo(request, target);
    const content = await buildEditorUpdate(plan, media, {
        product: 'cafepc001', origin: 'https://cafe.naver.com', token: info?.token, signal, request: uploadRequest,
    }).catch((error) => {
        if (!(error instanceof EditorUploadError)) throw error;
        throw new DraftPreparationError(error.message, {cause: error});
    });
    const article = {
        ...info?.options,
        cafeId: Number(target.cafeId), menuId: Number(target.menuId),
        subject, from: 'pc', editorVersion: 4, tagList: existing?.article.tagList ?? [],
        ...(existing?.article.headId != null && {headId: existing.article.headId}),
        ...(existing?.article.noticeType != null && {noticeType: existing.article.noticeType}),
        contentJson: JSON.stringify(content),
    };
    const response = await request(draftEndpoint(target, temporaryArticleId), {
        method: 'POST',
        headers: {...cafeHeaders, 'Content-Type': 'application/json'},
        body: JSON.stringify({article}),
    }).catch(() => null);
    const data = await response?.json().catch(() => null);
    const result = draftId.safeParse(data?.result?.temporaryArticleId);
    if (response?.ok && result.success && (temporaryArticleId === undefined || String(result.data) === String(temporaryArticleId))) {
        return {temporaryArticleId: result.data, imageCount: plan.imageCount, videoCount: plan.videoCount,
            representativeImage: plan.representativeImage, title: subject};
    }
    if (response && response.status >= 400 && response.status < 500 && response.status !== 408) {
        const code = data?.error?.errorCode;
        const suffix = typeof code === 'string' && /^\d{5}$/.test(code) ? `, ${code}` : '';
        throw new Error(`네이버가 임시저장을 거절했습니다(HTTP ${response.status}${suffix}).`);
    }
    throw new Error(uncertain);
}
