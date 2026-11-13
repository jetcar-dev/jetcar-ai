import {openAsBlob} from 'node:fs';
import {realpath} from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {z} from 'zod';
import {imageDirectory} from '../shared/config.js';
import type {CafeRequest} from '../shared/naver-request.js';

export const maxVideos = 10;
const chunkSize = 5 * 1024 * 1024;
const vod = 'https://nexus.vod.naver.com';

const videoConfig = z.object({
    apiInfo: z.object({fetchVideoUploaderToken: z.string()}),
    infraInfo: z.object({videoInfra: z.object({
        serviceId: z.number().int().positive(),
        region: z.string().regex(/^[a-z0-9-]*$/i).nullish(),
    })}),
    userInfo: z.object({userId: z.string().min(1)}),
});
const videoId = z.string().regex(/^[a-z0-9_-]+$/i);
const uploadSession = z.object({key: z.string().min(1), servers: z.array(z.string()).min(1),
    chunkSize: z.number().int().positive(), fileSizeLimit: z.number().positive().optional()});
const jobsSchema = z.object({data: z.object({video: z.array(z.object({
    type: z.string(), status: z.string(), data: z.array(z.unknown()).nullish(),
    errors: z.array(z.unknown()).nullish(),
}))})});
const videoHeader = z.object({width: z.number().int().positive(), height: z.number().int().positive(),
    duration: z.number().positive(), rotation: z.number().optional()});
const thumbnail = z.object({type: z.string(), path: z.string().min(1)});

export async function loadVideos(names: string[]) {
    if (!names.length) return [];
    const directory = await realpath(imageDirectory());
    return Promise.all(names.map(async (name) => {
        if (name !== basename(name) || /[\\/:\x00-\x1f]/.test(name) || !/\.mp4$/i.test(name)) {
            throw new Error('동영상은 지정 폴더에 있는 MP4 파일의 이름만 입력하세요.');
        }
        const file = await realpath(join(directory, name));
        if (dirname(file) !== directory) throw new Error('지정 폴더 안의 MP4 파일을 사용하세요.');
        const blob = await openAsBlob(file, {type: 'video/mp4'});
        if (!blob.size) throw new Error(`비어 있는 MP4 파일입니다: ${name}`);
        return {name, blob};
    }));
}

export type VideoFile = Awaited<ReturnType<typeof loadVideos>>[number];

async function videoResponse(request: CafeRequest, url: string | URL, options: RequestInit, step: string) {
    const response = await request(url, options).catch(() => undefined);
    if (!response?.ok) throw new Error(`${step}에 실패했습니다${response ? `(HTTP ${response.status})` : ''}.`);
    return response;
}

async function videoJson(request: CafeRequest, url: string | URL, options: RequestInit, step: string) {
    const response = await videoResponse(request, url, options, step);
    const data = await response.json().catch(() => undefined);
    if (!data || data.error || (Array.isArray(data.errors) && data.errors.length)) {
        throw new Error(`${step} 응답을 확인할 수 없습니다.`);
    }
    return data.result ?? data;
}

function jsonPost(body: unknown, contentType = 'application/json'): RequestInit {
    return {method: 'POST', headers: {'Content-Type': contentType}, body: JSON.stringify(body)};
}

function thumbnailUrl(path: string) {
    const url = URL.parse(path.startsWith('//') ? `https:${path}` : path);
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.port ||
        !/\.(?:naver\.com|pstatic\.net)$/i.test(url.hostname)) {
        throw new Error('네이버 동영상 썸네일 주소를 확인할 수 없습니다.');
    }
    return url.href;
}

async function waitForVideo(request: CafeRequest, base: string, key: string, signal?: AbortSignal) {
    const types = ['Ingest', 'VideoHeader', 'Thumbnails'];
    const query = `query getVideoStatus { video(id: ${JSON.stringify(key)}, type: ${JSON.stringify(types)}) {
        type status data { ...ingest ...videoHeader ...thumbnails } errors { code message }
    } } fragment ingest on Ingest { videoId }
        fragment videoHeader on VideoHeader { duration width height rotation }
        fragment thumbnails on Thumbnails { type path }`;
    const deadline = Date.now() + 120_000;
    let vid: string | undefined;
    let header: z.infer<typeof videoHeader> | undefined;
    let cover: string | undefined;
    while (Date.now() < deadline) {
        const result = await videoJson(request, `${base}/postman/api/v1/files`, jsonPost({query}, 'text/plain'), '동영상 처리 조회');
        const jobs = jobsSchema.parse(result).data.video;
        for (const job of jobs) {
            if (job.status === 'error' || job.errors?.length) throw new Error('네이버가 동영상 처리에 실패했습니다.');
            if (job.status !== 'done') continue;
            if (job.type === 'Ingest') vid = videoId.parse(z.object({videoId}).parse(job.data?.[0]).videoId);
            if (job.type === 'VideoHeader') header = videoHeader.parse(job.data?.[0]);
            if (job.type === 'Thumbnails') {
                const thumbnails = z.array(thumbnail).parse(job.data ?? []);
                cover = (thumbnails.find(({type}) => type === 'COVER') ?? thumbnails[0])?.path;
            }
        }
        if (vid && header && cover) return {vid, header, src: thumbnailUrl(cover)};
        await sleep(2500, undefined, {signal});
    }
    throw new Error('네이버가 동영상 정보를 만드는 중에 응답 시간이 지났습니다.');
}

export async function uploadVideo(request: CafeRequest, video: VideoFile, settings: unknown, editorHeaders: HeadersInit,
    signal?: AbortSignal,
) {
    const config = videoConfig.safeParse(settings);
    if (!config.success) throw new Error('스마트에디터 설정에서 동영상 업로드 정보를 찾을 수 없습니다.');
    const {apiInfo, infraInfo: {videoInfra}, userInfo: {userId}} = config.data;
    const tokenUrl = URL.parse(apiInfo.fetchVideoUploaderToken, 'https://platform.editor.naver.com');
    if (!tokenUrl || tokenUrl.origin !== 'https://platform.editor.naver.com' || tokenUrl.username || tokenUrl.password ||
        !/^\/api\/cafepc001\/v[12]\/video-uploader\/token$/.test(tokenUrl.pathname)) {
        throw new Error('네이버 동영상 토큰 주소를 확인할 수 없습니다.');
    }
    tokenUrl.pathname = tokenUrl.pathname.replace('/v1/', '/v2/');
    const getToken = () => videoJson(request, tokenUrl, {headers: editorHeaders}, '동영상 토큰 발급');
    const [authorization, videoInfo] = await Promise.all([getToken(), getToken()]);
    const token = z.object({token: z.string().min(1), fileSizeLimit: z.number().positive().optional()}).parse(authorization);
    const id = z.object({videoId}).parse(videoInfo).videoId;
    const {serviceId, region} = videoInfra;
    const base = region ? `${vod}/${region}` : vod;
    const {name: fileName, blob} = video;
    const fileSize = blob.size;
    if (token.fileSizeLimit && fileSize > token.fileSizeLimit) throw new Error(`네이버 동영상 용량 제한을 초과했습니다: ${fileName}`);
    const session = uploadSession.parse(await videoJson(request, `${base}/warp/${serviceId}/upload/v4/${id}/sessions`,
        jsonPost({token: token.token, userId, serviceId, chunkSize, fileName, fileSize, chunkUpload: true}), '동영상 업로드 세션 발급'));
    if (session.fileSizeLimit && fileSize > session.fileSizeLimit) throw new Error(`네이버 동영상 용량 제한을 초과했습니다: ${fileName}`);
    const host = session.servers.find((server) => /^[a-z0-9-]+\.vod\.naver\.com$/i.test(server));
    if (!host) throw new Error('네이버 동영상 업로드 주소를 확인할 수 없습니다.');
    for (let offset = 0; offset < fileSize; offset += session.chunkSize) {
        const chunk = blob.slice(offset, offset + session.chunkSize, 'video/mp4');
        const body = new FormData();
        const fields = {key: session.key, fileName, fileSize, chunkIndex: offset / session.chunkSize + 1,
            chunkSize: session.chunkSize, currentChunkSize: chunk.size, chunkUpload: true};
        for (const [field, value] of Object.entries(fields)) body.set(field, String(value));
        body.set('file', chunk, fileName);
        await videoResponse(request, `https://${host}/upload/v2/files`, {method: 'POST', body}, '동영상 전송');
    }
    const {vid, header, src} = await waitForVideo(request, base, session.key, signal);
    const rotated = header.rotation === 90 || header.rotation === 270;
    const width = rotated ? header.height : header.width;
    const height = rotated ? header.width : header.height;
    return {
        '@ctype': 'video', vid, layout: 'default', contentMode: 'fit', fileSize, playTime: header.duration,
        internalResource: true, vendor: '', format: 'normal', source: '', represent: false, ai: false,
        width, height, originalWidth: width, originalHeight: height,
        thumbnail: {'@ctype': 'thumbnail', src, alt: ''}, videoInfraServiceId: String(serviceId),
        origin: {'@ctype': 'videoOrigin', srcFrom: 'local'},
    };
}
