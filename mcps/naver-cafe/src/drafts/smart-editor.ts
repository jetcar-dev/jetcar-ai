import {z} from 'zod';
import type {CafeTarget} from '../boards/target.js';
import type {loadImages} from './images.js';
import {cafeHeaders, type CafeRequest} from '../shared/naver-request.js';
import {editorBlock, editorComponent, editorId, paragraphs} from './editor-blocks.js';
import {maxVideos, uploadVideo, type VideoFile} from './videos.js';

const editorApi = 'https://apis.cafe.naver.com/editor';
const serviceConfig = 'https://platform.editor.naver.com/api/cafepc001/v1/service_config';
const uncertain = '임시저장 결과를 확인할 수 없습니다. 다시 저장하기 전에 카페 글쓰기 화면의 임시등록 목록을 확인하세요.';
type Block = z.infer<typeof editorBlock>;
type Photo = Awaited<ReturnType<typeof loadImages>>[number];

const configSchema = z.object({
    apiInfo: z.object({fetchPhotoUploadSessionKey: z.string().min(1)}),
    infraInfo: z.object({photoInfra: z.object({domain: z.string().min(1), imageHost: z.string().min(1)})}),
    userInfo: z.object({userId: z.string().min(1)}),
});
export const draftId = z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/)]);
type DraftId = z.infer<typeof draftId>;

const draftComponent = z.looseObject({'@ctype': z.string(), represent: z.boolean().optional()});
const draftDocument = z.looseObject({
    document: z.looseObject({components: z.array(draftComponent)}),
});
const savedArticle = z.object({
    subject: z.string(),
    menuId: draftId.optional(),
    headId: z.number().nullish(),
    noticeType: z.string().nullish(),
    tagList: z.array(z.string()).nullish(),
    contentJson: z.unknown(),
});

function naverUrl(value: string, base?: string, allowCdn = false) {
    const url = URL.parse(value, base);
    const naver = url && (url.hostname === 'naver.com' || url.hostname.endsWith('.naver.com'));
    const cdn = url && (url.hostname === 'pstatic.net' || url.hostname.endsWith('.pstatic.net'));
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.port ||
        !(naver || (allowCdn && cdn))) {
        throw new Error('네이버가 반환한 이미지 서비스 주소를 확인할 수 없습니다.');
    }
    return url;
}

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

async function photoSession(request: CafeRequest, settings: unknown, editorHeaders: HeadersInit) {
    const config = configSchema.safeParse(settings);
    if (!config.success) throw new Error('스마트에디터 설정에서 사진 업로드 정보를 찾을 수 없습니다.');
    const {domain, imageHost} = config.data.infraInfo.photoInfra;
    const sessionUrl = naverUrl(config.data.apiInfo.fetchPhotoUploadSessionKey, serviceConfig);
    const uploadHost = naverUrl(domain.startsWith('//') ? `https:${domain}` :
        domain.includes('://') ? domain : `https://${domain}`);
    const cdn = naverUrl(imageHost.startsWith('//') ? `https:${imageHost}` :
        imageHost.includes('://') ? imageHost : `https://${imageHost}`, undefined, true);
    const session = await readJson(request, sessionUrl, editorHeaders, '사진 업로드 세션 조회');
    const key = z.string().regex(/^[a-z0-9_.~-]+$/i).safeParse(session.sessionKey);
    if (!key.success || key.data === '.' || key.data === '..') throw new Error('사진 업로드 세션 키가 없습니다.');
    return {key: key.data, uploadHost: uploadHost.origin, imageHost: cdn.origin, userId: config.data.userInfo.userId};
}

function xmlField(xml: string, name: string) {
    const value = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)?.[1]?.trim();
    if (!value) return;
    if (value.startsWith('<![CDATA[') && value.endsWith(']]>')) return value.slice(9, -3);
    return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity, key: string) => {
        if (!key.startsWith('#')) return ({amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"} as Record<string, string>)[key] ?? entity;
        const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
        return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    });
}

async function uploadPhoto(request: CafeRequest, photo: Photo, session: Awaited<ReturnType<typeof photoSession>>, index: number) {
    const url = new URL(`/${session.key}/simpleUpload/${index}`, session.uploadHost);
    url.search = new URLSearchParams({
        userId: session.userId, extractExif: 'true', extractAnimatedCnt: 'false',
        extractAnimatedInfo: 'true', autorotate: 'true', denyAnimatedImage: 'false', skipXcamFiltering: 'true',
    }).toString();
    const body = new FormData();
    body.set('imageFileName', photo.name);
    body.set('image', photo.blob, photo.name);
    const response = await request(url, {method: 'POST', body}).catch(() => null);
    const xml = await response?.text().catch(() => '');
    const failure = `사진을 업로드하지 못했습니다: ${photo.name}`;
    if (!response?.ok || !xml) throw new Error(failure);
    const item = /<item>([\s\S]*?)<\/item>/.exec(xml)?.[1] ?? xml;
    const code = xmlField(item, 'code');
    const path = xmlField(item, 'path');
    const fileName = xmlField(item, 'fileName');
    const src = xmlField(item, 'url');
    const width = Number(xmlField(item, 'width'));
    const height = Number(xmlField(item, 'height'));
    const fileSize = Number(xmlField(item, 'fileSize'));
    if ((code && code !== 'IMAGE' && code !== 'SUCCESS') || !path || !fileName || !src ||
        ![width, height, fileSize].every((value) => Number.isSafeInteger(value) && value > 0)) {
        throw new Error(failure);
    }
    const urlOfImage = naverUrl(src, session.imageHost, true);
    const animated = Number(xmlField(item, 'animatedCnt')) > 1;
    const format = animated ? 'animated' : 'normal';
    return {
        '@ctype': 'image', layout: 'default', src: urlOfImage.href,
        domain: urlOfImage.origin, path: `${path.replace(/\/$/, '')}/${fileName}`, fileName,
        width, height, fileSize, internalResource: true, format, displayFormat: format,
    };
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
    return {article, content: draftDocument.parse(content)};
}

export async function saveSmartEditorDraft(
    target: CafeTarget, title: string | undefined, blocks: Block[], photos: Photo[], request: CafeRequest,
    {temporaryArticleId, representativeImage, videos = [], signal}: {
        temporaryArticleId?: DraftId; representativeImage?: number; videos?: VideoFile[]; signal?: AbortSignal;
    } = {},
) {
    const existing = temporaryArticleId === undefined ? undefined : await readDraft(request, target, temporaryArticleId);
    const subject = title ?? existing?.article.subject;
    if (!subject) throw new Error('새 임시글의 제목을 입력하세요.');
    const oldComponents = existing?.content.document.components ?? [];
    const oldImages = oldComponents.filter((component) => component['@ctype'] === 'image');
    const imageCount = oldImages.length + blocks.filter((block) => block.type === 'image').length;
    const videoCount = oldComponents.filter((component) => component['@ctype'] === 'video').length +
        blocks.filter((block) => block.type === 'video').length;
    if (videos.length && videoCount > maxVideos) throw new Error(`한 글에 동영상을 최대 ${maxVideos}개 첨부할 수 있습니다.`);
    if (representativeImage !== undefined && representativeImage > imageCount) {
        throw new Error(imageCount ? `대표이미지는 본문 사진의 순서로 1~${imageCount} 사이에서 선택하세요.`
            : '대표이미지를 지정하려면 본문에 사진이 있어야 합니다.');
    }
    const existingRepresentative = oldImages.findIndex((image) => image.represent);
    const selected = representativeImage ?? (existingRepresentative < 0 ? 1 : existingRepresentative + 1);
    const info = await editorInfo(request, target);
    const uploaded = new Map<string, Awaited<ReturnType<typeof uploadPhoto>>>();
    const uploadedVideos = new Map<string, Awaited<ReturnType<typeof uploadVideo>>>();
    if (photos.length || videos.length) {
        if (typeof info?.token !== 'string' || !info.token) {
            throw new DraftPreparationError('카페 글쓰기 설정에 스마트에디터 토큰이 없습니다.');
        }
        const editorHeaders = {'SE-Authorization': info.token};
        try {
            const settings = await readJson(request, serviceConfig, editorHeaders, '스마트에디터 설정 조회');
            if (photos.length) {
                const session = await photoSession(request, settings, editorHeaders);
                const batchSize = 3;
                for (let offset = 0; offset < photos.length; offset += batchSize) {
                    const batch = photos.slice(offset, offset + batchSize);
                    const results = await Promise.allSettled(batch.map(async (photo, index) => {
                        uploaded.set(photo.name, await uploadPhoto(request, photo, session, offset + index));
                    }));
                    const failure = results.find((result) => result.status === 'rejected');
                    if (failure) throw failure.reason;
                }
            }
            for (const video of videos) {
                uploadedVideos.set(video.name, await uploadVideo(request, video, settings, editorHeaders, signal));
            }
        } catch (error) {
            signal?.throwIfAborted();
            const message = error instanceof Error && !(error instanceof z.ZodError) ? error.message :
                '스마트에디터 첨부 파일 처리 결과를 확인할 수 없습니다.';
            throw new DraftPreparationError(message, {cause: error});
        }
    }

    const appended: z.infer<typeof draftComponent>[] = blocks.map((block) => {
        if (block.type === 'video') {
            const video = uploadedVideos.get(block.file);
            if (!video) throw new Error(`첨부할 동영상을 찾지 못했습니다: ${block.file}`);
            return {
                ...video, id: editorId(),
                ...(block.align && {align: block.align}),
                ...(block.title && {mediaMeta: {'@ctype': 'mediaMeta', title: block.title, description: '', tags: []}}),
            };
        }
        if (block.type !== 'image') return editorComponent(block);
        const photo = uploaded.get(block.file);
        if (!photo) throw new Error(`첨부할 사진을 찾지 못했습니다: ${block.file}`);
        const {align, caption, link} = block;
        return {
            ...photo, id: editorId(),
            ...(align && {align}),
            ...(caption && {caption: paragraphs({text: caption})}),
            ...(link && {link}),
        };
    });
    let imageIndex = 0;
    const components = [...oldComponents, ...appended].map((component) => {
        if (component['@ctype'] === 'image') return {...component, represent: ++imageIndex === selected};
        if (component['@ctype'] === 'video' && imageCount && component.represent) return {...component, represent: false};
        return component;
    });
    const content = existing?.content ?? {documentId: '', document: {version: '2.10.2', theme: 'default'}};
    const article = {
        ...info?.options,
        cafeId: Number(target.cafeId), menuId: Number(target.menuId),
        subject, from: 'pc', editorVersion: 4, tagList: existing?.article.tagList ?? [],
        ...(existing?.article.headId != null && {headId: existing.article.headId}),
        ...(existing?.article.noticeType != null && {noticeType: existing.article.noticeType}),
        contentJson: JSON.stringify({...content, document: {...content.document, components}}),
    };
    const response = await request(draftEndpoint(target, temporaryArticleId), {
        method: 'POST',
        headers: {...cafeHeaders, 'Content-Type': 'application/json'},
        body: JSON.stringify({article}),
    }).catch(() => null);
    const data = await response?.json().catch(() => null);
    const result = draftId.safeParse(data?.result?.temporaryArticleId);
    if (response?.ok && result.success && (temporaryArticleId === undefined || String(result.data) === String(temporaryArticleId))) {
        return {temporaryArticleId: result.data, imageCount, videoCount, representativeImage: imageCount ? selected : undefined, title: subject};
    }
    if (response && response.status >= 400 && response.status < 500 && response.status !== 408) {
        const code = data?.error?.errorCode;
        const suffix = typeof code === 'string' && /^\d{5}$/.test(code) ? `, ${code}` : '';
        throw new Error(`네이버가 임시저장을 거절했습니다(HTTP ${response.status}${suffix}).`);
    }
    throw new Error(uncertain);
}
