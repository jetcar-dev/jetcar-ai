import {z} from 'zod';
import type {loadImages} from './images.js';
import {readEditorJson, type EditorRequest} from './request.js';

export type PhotoFile = Awaited<ReturnType<typeof loadImages>>[number];

const configSchema = z.object({
    apiInfo: z.object({fetchPhotoUploadSessionKey: z.string().min(1)}),
    infraInfo: z.object({photoInfra: z.object({domain: z.string().min(1), imageHost: z.string().min(1)})}),
    userInfo: z.object({userId: z.string().min(1)}),
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

export async function photoSession(request: EditorRequest, settings: unknown, editorHeaders: HeadersInit, configUrl: URL) {
    const config = configSchema.safeParse(settings);
    if (!config.success) throw new Error('스마트에디터 설정에서 사진 업로드 정보를 찾을 수 없습니다.');
    const {domain, imageHost} = config.data.infraInfo.photoInfra;
    const sessionUrl = naverUrl(config.data.apiInfo.fetchPhotoUploadSessionKey, configUrl.href);
    const uploadHost = naverUrl(domain.startsWith('//') ? `https:${domain}` :
        domain.includes('://') ? domain : `https://${domain}`);
    const cdn = naverUrl(imageHost.startsWith('//') ? `https:${imageHost}` :
        imageHost.includes('://') ? imageHost : `https://${imageHost}`, undefined, true);
    const session = await readEditorJson(request, sessionUrl, editorHeaders, '사진 업로드 세션 조회');
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

export async function uploadPhoto(request: EditorRequest, photo: PhotoFile, session: Awaited<ReturnType<typeof photoSession>>, index: number) {
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
