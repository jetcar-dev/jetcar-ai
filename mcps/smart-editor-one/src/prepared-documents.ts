import {randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {z} from 'zod';
import {documentSchema} from './document.js';

export const documentIdSchema = z.string().regex(/^[a-f0-9]{64}$/).describe('스마트에디터 파일 가져오기가 반환한 원고 ID');
export const preparedFormat = z.enum(['text', 'markdown', 'json', 'docx', 'html', 'hwpx', 'csv', 'xlsx', 'pdf']);
const recordSchema = z.object({
    format: preparedFormat,
    draft: documentSchema,
    warnings: z.array(z.string()),
    attachmentCount: z.number().int().nonnegative(),
    embeddedImages: z.boolean(),
    embeddedImageNames: z.array(z.string()).optional(),
});
export type PreparedDocument = z.infer<typeof recordSchema>;

function directoryFor(documentId: string) {
    const base = process.env.JETCAR_SMART_EDITOR_DOCUMENT_DIR?.trim() || (process.platform === 'win32'
        ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Jetcar', 'SmartEditorOne', 'documents')
        : join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'jetcar', 'smart-editor-one', 'documents'));
    return resolve(base, documentIdSchema.parse(documentId));
}

export async function findPreparedDocument(documentId: string) {
    const directory = directoryFor(documentId);
    let raw: string;
    try {
        raw = await readFile(join(directory, 'document.json'), 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
    }
    const record = recordSchema.parse(JSON.parse(raw));
    return {record, attachmentDirectory: record.embeddedImages ? join(directory, 'assets') : undefined};
}

export async function readPreparedDocument(documentId: string) {
    const document = await findPreparedDocument(documentId);
    if (!document) throw new Error('이 PC에서 원고 ID를 찾지 못했습니다. 스마트에디터 MCP로 원본 파일을 다시 가져오세요.');
    return document;
}

async function writeAtomic(path: string, data: string | Buffer) {
    const partial = `${path}.${randomUUID()}.tmp`;
    try {
        await writeFile(partial, data, {flag: 'wx', mode: 0o600});
        await rename(partial, path);
    } finally {
        await rm(partial, {force: true});
    }
}

export async function storePreparedDocument(documentId: string, record: PreparedDocument, files: Map<string, Buffer>) {
    const directory = directoryFor(documentId);
    const assets = join(directory, 'assets');
    await mkdir(files.size ? assets : directory, {recursive: true, mode: 0o700});
    await Promise.all([...files].map(([name, bytes]) => {
        if (!/^image-\d+\.(?:jpg|jpeg|png|gif)$/i.test(name)) throw new Error('가져온 이미지 이름을 확인할 수 없습니다.');
        return writeAtomic(join(assets, name), bytes);
    }));
    await writeAtomic(join(directory, 'document.json'), JSON.stringify(record));
}
