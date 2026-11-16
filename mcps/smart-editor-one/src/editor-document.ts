import {z} from 'zod';
import {editorComponent, editorId, paragraphs, type EditorBlock} from './editor-blocks.js';
import {uploadEditorMedia, type EditorMedia, type EditorUploadContext} from './uploads/media.js';
import {maxVideos} from './uploads/videos.js';

const componentSchema = z.looseObject({'@ctype': z.string(), represent: z.boolean().optional()});
export const editorContentSchema = z.looseObject({
    document: z.looseObject({components: z.array(componentSchema)}),
});
type EditorContent = z.infer<typeof editorContentSchema>;
type Component = z.infer<typeof componentSchema>;

export function planEditorUpdate(existing: EditorContent | undefined, blocks: EditorBlock[], representativeImage?: number) {
    const content = existing ?? {documentId: '', document: {version: '2.10.2', theme: 'default', components: []}};
    const oldImages = content.document.components.filter(({['@ctype']: type}) => type === 'image');
    const imageCount = oldImages.length + blocks.filter(({type}) => type === 'image').length;
    const addedVideos = blocks.filter(({type}) => type === 'video').length;
    const videoCount = content.document.components.filter(({['@ctype']: type}) => type === 'video').length + addedVideos;
    if (addedVideos && videoCount > maxVideos) throw new Error(`한 글에 동영상을 최대 ${maxVideos}개 첨부할 수 있습니다.`);
    if (representativeImage !== undefined && representativeImage > imageCount) {
        throw new Error(imageCount ? `대표이미지는 본문 사진의 순서로 1~${imageCount} 사이에서 선택하세요.` :
            '대표이미지를 지정하려면 본문에 사진이 있어야 합니다.');
    }
    const existingRepresentative = oldImages.findIndex((image) => image.represent);
    const selected = representativeImage ?? Math.max(1, existingRepresentative + 1);
    return {content, blocks, imageCount, videoCount, representativeImage: imageCount ? selected : undefined};
}

export async function buildEditorUpdate(plan: ReturnType<typeof planEditorUpdate>, media: EditorMedia, context: EditorUploadContext) {
    const {content, blocks, imageCount, representativeImage} = plan;
    const {uploadedPhotos, uploadedVideos} = await uploadEditorMedia(media, context);
    const appended: Component[] = blocks.map((block) => {
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
        const photo = uploadedPhotos.get(block.file);
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
    const components = [...content.document.components, ...appended].map((component) => {
        if (component['@ctype'] === 'image') return {...component, represent: ++imageIndex === representativeImage};
        if (component['@ctype'] === 'video' && imageCount && component.represent) return {...component, represent: false};
        return component;
    });
    return {...content, document: {...content.document, components}};
}
