import {z} from 'zod';
import type {EditorBlock} from '../editor-blocks.js';
import {loadImages, maxImages} from './images.js';
import {photoSession, uploadPhoto} from './photos.js';
import {createEditorUploadRequest, readEditorJson, type EditorRequest} from './request.js';
import {loadVideos, maxVideos, uploadVideo} from './videos.js';

export async function loadEditorMedia(blocks: EditorBlock[], attachmentDirectory: (name: string) => string) {
    const names = (type: 'image' | 'video') => blocks.flatMap((block) => block.type === type ? [block.file] : []);
    const imageFiles = names('image');
    const videoFiles = names('video');
    if (imageFiles.length > maxImages) throw new Error(`한 번에 사진을 최대 ${maxImages}장 첨부할 수 있습니다.`);
    if (videoFiles.length > maxVideos) throw new Error(`한 글에 동영상을 최대 ${maxVideos}개 첨부할 수 있습니다.`);
    const [photos, videos] = await Promise.all([
        loadImages([...new Set(imageFiles)], attachmentDirectory),
        loadVideos([...new Set(videoFiles)], attachmentDirectory),
    ]);
    return {photos, videos};
}

export type EditorMedia = Awaited<ReturnType<typeof loadEditorMedia>>;
export type EditorUploadContext = {
    product: string;
    origin: string;
    token: unknown;
    signal?: AbortSignal;
    request?: EditorRequest;
};

export class EditorUploadError extends Error {}

export async function uploadEditorMedia({photos, videos}: EditorMedia, context: EditorUploadContext) {
    const uploadedPhotos = new Map<string, Awaited<ReturnType<typeof uploadPhoto>>>();
    const uploadedVideos = new Map<string, Awaited<ReturnType<typeof uploadVideo>>>();
    if (!photos.length && !videos.length) return {uploadedPhotos, uploadedVideos};

    const {product, origin, token, signal, request = createEditorUploadRequest(origin, signal)} = context;
    if (typeof token !== 'string' || !token) throw new EditorUploadError('글쓰기 설정에 스마트에디터 토큰이 없습니다.');
    if (!/^[a-z\d]+$/i.test(product)) throw new EditorUploadError('스마트에디터 서비스 코드를 확인하세요.');
    const headers = {'SE-Authorization': token};
    const configUrl = new URL(`https://platform.editor.naver.com/api/${product}/v1/service_config`);
    try {
        const settings = await readEditorJson(request, configUrl, headers, '스마트에디터 설정 조회');
        if (photos.length) {
            const session = await photoSession(request, settings, headers, configUrl);
            const batchSize = 3;
            for (let offset = 0; offset < photos.length; offset += batchSize) {
                const batch = photos.slice(offset, offset + batchSize);
                const results = await Promise.allSettled(batch.map(async (photo, index) => {
                    uploadedPhotos.set(photo.name, await uploadPhoto(request, photo, session, offset + index));
                }));
                const failure = results.find((result) => result.status === 'rejected');
                if (failure) throw failure.reason;
            }
        }
        for (const video of videos) {
            uploadedVideos.set(video.name, await uploadVideo(request, video, settings, headers, product, signal));
        }
        return {uploadedPhotos, uploadedVideos};
    } catch (error) {
        signal?.throwIfAborted();
        const message = error instanceof Error && !(error instanceof z.ZodError) ? error.message :
            '스마트에디터 첨부 파일 처리 결과를 확인할 수 없습니다.';
        throw new EditorUploadError(message, {cause: error});
    }
}
