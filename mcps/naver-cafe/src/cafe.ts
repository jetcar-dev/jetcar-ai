import {createHash} from 'node:crypto';
import {readFile, realpath, stat} from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';
import sanitizeHtml from 'sanitize-html';
import {z} from 'zod';
import {imageDirectory} from './config.js';
import type {CafeTarget} from './board.js';

export const maxImages = 5;
const maxImageBytes = 5 * 1024 * 1024;
const imageTypes = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
} as const;

export function formatBody(body: string, format: 'text' | 'html') {
    if (format === 'text') {
        return body.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
            .replace(/\r\n?|\n/g, '<br>');
    }
    const html = sanitizeHtml(body, {
        allowedTags: ['a', 'b', 'blockquote', 'br', 'div', 'em', 'h2', 'h3', 'hr', 'i', 'li', 'ol', 'p', 's', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul'],
        allowedAttributes: {a: ['href']},
        allowedSchemes: ['https', 'http'],
        allowProtocolRelative: false,
    });
    if (!sanitizeHtml(html, {allowedTags: [], allowedAttributes: {}}).trim()) {
        throw new Error('지원되는 서식과 실제 글 내용이 포함된 본문을 입력하세요.');
    }
    return html;
}

export async function loadImages(names: string[]) {
    if (names.length === 0) return [];
    const directory = await realpath(imageDirectory());
    const images: { name: string; blob: Blob; sha256: string }[] = [];
    for (const name of names) {
        const extension = name.slice(name.lastIndexOf('.')).toLowerCase();
        if (name !== basename(name) || /[\\/:\x00-\x1f]/.test(name) || !Object.hasOwn(imageTypes, extension)) {
            throw new Error('이미지는 지정 폴더에 있는 JPG, PNG, GIF 파일의 이름만 입력하세요.');
        }
        const file = await realpath(join(directory, name));
        if (dirname(file) !== directory) throw new Error('지정 폴더 안의 이미지 파일을 사용하세요.');
        const info = await stat(file);
        if (!info.isFile() || info.size === 0 || info.size > maxImageBytes) {
            throw new Error('지정 폴더에 있는 5 MiB 이하의 이미지 파일을 사용하세요.');
        }
        const bytes = await readFile(file);
        const type = imageTypes[extension as keyof typeof imageTypes];
        const validSignature = {
            'image/jpeg': bytes.subarray(0, 3).toString('hex') === 'ffd8ff',
            'image/png': bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
            'image/gif': ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii')),
        }[type];
        if (bytes.length > maxImageBytes || !validSignature) {
            throw new Error('이미지 파일 형식 또는 크기를 확인하세요.');
        }
        images.push({name, blob: new Blob([bytes], {type}), sha256: createHash('sha256').update(bytes).digest('hex')});
    }
    return images;
}

export type Draft = {
    target: CafeTarget;
    title: string;
    html: string;
    images: Awaited<ReturnType<typeof loadImages>>;
    publicPost: boolean;
};

const resultSchema = z.object({
    articleId: z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/)]),
    articleUrl: z.url({protocol: /^https$/, hostname: /^cafe\.naver\.com$/}),
});

export async function publishArticle(draft: Draft, accessToken: string) {
    const {cafeId, menuId} = draft.target;
    const fields = {
        subject: draft.title,
        content: draft.html,
        openyn: String(draft.publicPost),
        searchopen: String(draft.publicPost),
    };
    let body: FormData | URLSearchParams = new URLSearchParams(fields);
    if (draft.images.length) {
        const multipart = new FormData();
        // The Naver multipart example percent-encodes title and content inside each text field.
        multipart.set('subject', encodeURIComponent(fields.subject));
        multipart.set('content', encodeURIComponent(fields.content));
        multipart.set('openyn', fields.openyn);
        multipart.set('searchopen', fields.searchopen);
        for (const image of draft.images) multipart.append('image', image.blob, image.name);
        body = multipart;
    }

    const uncertain = '게시 결과를 확인하지 못했습니다. 중복 게시를 피하려면 새로 시도하기 전에 카페 게시판에서 등록 여부를 확인하세요.';
    const response = await fetch(`https://openapi.naver.com/v1/cafe/${cafeId}/menu/${menuId}/articles`, {
        method: 'POST',
        headers: {Authorization: `Bearer ${accessToken}`},
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
    }).catch(() => {
        throw new Error(uncertain);
    });

    const payload = await response.json().catch(() => null);
    const result = resultSchema.safeParse(payload?.message?.result);
    if (response.ok && String(payload?.message?.status) === '200' && result.success) return result.data;
    if (response.status >= 400 && response.status < 500 && response.status !== 408) {
        const code = payload?.message?.error?.code ?? payload?.errorCode;
        const label = typeof code === 'string' && /^[a-z\d_]{1,32}$/i.test(code) ? `, ${code}` : '';
        throw new Error(`네이버 게시 요청이 거절됐습니다(HTTP ${response.status}${label}). API 권한, 게시판 설정, 계정 상태를 확인하세요.`);
    }
    throw new Error(uncertain);
}
