import {createHash} from 'node:crypto';
import {open} from 'node:fs/promises';
import {basename, extname, isAbsolute} from 'node:path';
import {z} from 'zod';
import {documentSchema, prepareDocument, type Draft} from '../document.js';
import {editorBlock} from '../editor-blocks.js';
import {findPreparedDocument, preparedFormat, storePreparedDocument, type PreparedDocument} from '../prepared-documents.js';
import {sourceBlocks} from '../source.js';
import {parseDocx} from './docx.js';
import {parseHtml} from './html.js';
import {parseHwpx} from './hwpx.js';
import {parsePdf} from './pdf.js';
import {parseCsv, parseXlsx} from './tabular.js';

const formats = {
    '.txt': 'text', '.md': 'markdown', '.markdown': 'markdown', '.json': 'json', '.docx': 'docx',
    '.html': 'html', '.htm': 'html', '.hwpx': 'hwpx', '.csv': 'csv', '.tsv': 'csv', '.xlsx': 'xlsx', '.pdf': 'pdf',
} as const;
const textFormats = new Set<PreparedDocument['format']>(['text', 'markdown', 'html', 'csv']);
const textEncoding = z.enum(['auto', 'utf-8', 'utf-16le', 'utf-16be', 'euc-kr']);
const fieldPath = z.string().trim().min(1).max(200);
const jsonFields = z.object({
    title: fieldPath.optional(), blocks: fieldPath.optional(), body: fieldPath.optional(), representativeImage: fieldPath.optional(),
    bodyFormat: z.enum(['text', 'markdown']).default('text'),
}).refine(({blocks, body}) => !!blocks !== !!body, 'JSON 매핑에는 blocks 또는 body 중 하나만 지정하세요.');

export const importFileSchema = z.object({
    filePath: z.string().trim().min(1).max(4_096).describe('사용자가 제공한 로컬 원본의 절대 경로'),
    format: preparedFormat.optional().describe('생략하면 파일 확장자로 결정합니다.'),
    title: documentSchema.shape.title.optional().describe('글 제목을 직접 지정할 때 사용합니다. 생략하면 원본 제목이나 파일 이름을 씁니다.'),
    representativeImage: documentSchema.shape.representativeImage,
    encoding: textEncoding.default('auto').describe('TXT·Markdown·HTML·CSV의 인코딩. 자동은 BOM 또는 UTF-8을 우선 사용합니다.'),
    jsonFields: jsonFields.optional().describe('다른 JSON 양식의 본문 필드 경로. 예: {title:"post.subject",body:"post.content"}'),
    delimiter: z.enum([',', ';', '\t']).optional().describe('CSV 구분 문자. 기본 쉼표, .tsv는 기본 탭입니다.'),
    sheet: z.string().trim().min(1).max(255).optional().describe('XLSX 워크시트 이름. 생략하면 첫 번째 표시 시트를 가져옵니다.'),
    pdfPages: z.object({from: z.number().int().positive(), to: z.number().int().positive()})
        .refine(({from, to}) => from <= to, 'PDF의 마지막 쪽은 시작 쪽 이후여야 합니다.').optional().describe('PDF 쪽 범위. 첫 쪽은 1입니다.'),
});

const convertedDocument = documentSchema.extend({blocks: z.array(editorBlock).min(1).max(4_000)});
const inProgress = new Map<string, Promise<{record: PreparedDocument; reused: boolean}>>();
const recent = new Map<string, {record: PreparedDocument; storedAt: number}>();

function remember(id: string, record: PreparedDocument) {
    recent.delete(id);
    if (recent.size >= 8) recent.delete(recent.keys().next().value!);
    recent.set(id, {record, storedAt: performance.now()});
}

async function readSource(filePath: string, sizeLimit: number) {
    const file = await open(filePath, 'r');
    try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size === 0) throw new Error('내용이 있는 원본 파일을 지정하세요.');
        if (stat.size > sizeLimit) throw new Error(`원본 파일은 최대 ${sizeLimit / 1024 / 1024} MiB까지 가져올 수 있습니다.`);
        const bytes = await file.readFile();
        if (bytes.length > sizeLimit) throw new Error('가져오는 중 파일 크기가 허용 범위를 초과했습니다.');
        return bytes;
    } finally {
        await file.close();
    }
}

function decodeText(bytes: Buffer, encoding: z.infer<typeof textEncoding>) {
    if (encoding !== 'auto') return new TextDecoder(encoding, {fatal: true}).decode(bytes);
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return decodeText(bytes, 'utf-16le');
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return decodeText(bytes, 'utf-16be');
    try {
        return decodeText(bytes, 'utf-8');
    } catch {
        throw new Error('원본 문자 인코딩을 확인할 수 없습니다. 인코딩을 지정하거나 UTF-8로 저장한 파일을 사용하세요.');
    }
}

function field(value: unknown, path: string | undefined): unknown {
    if (!path) return;
    for (const key of path.split('.')) {
        if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return;
        value = (value as Record<string, unknown>)[key];
    }
    return value;
}

function ignoredField(value: unknown, parsed: unknown, path = 'blocks'): string | undefined {
    if (!value || !parsed || typeof value !== 'object' || typeof parsed !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
        const location = `${path}.${key}`;
        if (!Object.hasOwn(parsed, key)) return location;
        const omitted = ignoredField(item, (parsed as Record<string, unknown>)[key], location);
        if (omitted) return omitted;
    }
}

function fromJson(bytes: Buffer, mapping: z.infer<typeof jsonFields> | undefined) {
    let data: unknown;
    try { data = JSON.parse(decodeText(bytes, 'auto')); }
    catch { throw new Error('JSON 원본을 읽지 못했습니다. 올바른 JSON 파일인지 확인하세요.'); }
    const root = mapping ? data : field(data, 'draft') ?? data;
    const title = field(root, mapping ? mapping.title : 'title');
    const representativeImage = field(root, mapping ? mapping.representativeImage : 'representativeImage');
    if (mapping?.body) {
        const source = field(root, mapping.body);
        if (typeof source !== 'string') throw new Error(`JSON에서 본문 문자열을 찾지 못했습니다. (${mapping.body})`);
        return {title, representativeImage, blocks: sourceBlocks(source, mapping.bodyFormat), group: true};
    }
    const blocks = field(root, mapping?.blocks ?? 'blocks');
    if (!Array.isArray(blocks)) throw new Error('JSON 본문 블록을 찾지 못했습니다. blocks 배열의 경로 또는 본문 문자열 경로를 지정하세요.');
    return {title, representativeImage, blocks, group: false};
}

function parseFormattedFile(bytes: Buffer, format: Exclude<PreparedDocument['format'], 'text' | 'markdown' | 'json'>,
    {encoding, delimiter, sheet, pdfPages}: z.infer<typeof importFileSchema>,
) {
    switch (format) {
        case 'docx': return parseDocx(bytes);
        case 'hwpx': return parseHwpx(bytes);
        case 'pdf': return parsePdf(bytes, pdfPages);
        case 'xlsx': return parseXlsx(bytes, {sheet});
        case 'csv': return parseCsv(decodeText(bytes, encoding), {delimiter});
        case 'html': return parseHtml(decodeText(bytes, encoding));
    }
}

async function convertAndStore(documentId: string, bytes: Buffer, format: PreparedDocument['format'], filenameTitle: string,
    options: z.infer<typeof importFileSchema>,
) {
    const {title, representativeImage, encoding, jsonFields} = options;
    let draft: Draft;
    let warnings: string[] = [];
    let assets = new Map<string, Buffer>();
    if (format !== 'text' && format !== 'markdown' && format !== 'json') {
        const document = await parseFormattedFile(bytes, format, options);
        warnings = document.warnings;
        assets = document.assets;
        const originalTitle = 'title' in document ? document.title : undefined;
        draft = prepareDocument(convertedDocument.parse({title: title ?? (originalTitle || filenameTitle), blocks: document.blocks, representativeImage}));
    } else if (format === 'json') {
        const parsed = fromJson(bytes, jsonFields);
        const data = convertedDocument.parse({title: title ?? parsed.title ?? filenameTitle, blocks: parsed.blocks,
            representativeImage: representativeImage ?? parsed.representativeImage});
        const omitted = ignoredField(parsed.blocks, data.blocks);
        if (omitted) throw new Error(`JSON에 지원하지 않는 필드가 있습니다. (${omitted})`);
        draft = prepareDocument(data, parsed.group);
    } else {
        const blocks = sourceBlocks(decodeText(bytes, encoding), format);
        draft = prepareDocument(convertedDocument.parse({title: title ?? filenameTitle, blocks, representativeImage}));
    }
    const attachmentCount = draft.blocks.filter(({type}) => type === 'image' || type === 'video').length;
    const record: PreparedDocument = {format, draft, attachmentCount, warnings, embeddedImages: assets.size > 0,
        ...(assets.size > 0 && {embeddedImageNames: [...assets.keys()]})};
    await storePreparedDocument(documentId, record, assets);
    return record;
}

export async function importEditorFile(input: z.infer<typeof importFileSchema>, signal?: AbortSignal) {
    const {filePath, title, representativeImage, encoding, jsonFields, sheet, pdfPages} = input;
    if (!isAbsolute(filePath)) throw new Error('가져올 파일의 절대 경로를 입력하세요.');
    const extension = extname(filePath);
    const lowerExtension = extension.toLowerCase();
    const format = input.format ?? formats[lowerExtension as keyof typeof formats];
    if (!format) throw new Error('TXT, Markdown, JSON, DOCX, HTML, HWPX, CSV, XLSX 또는 PDF 파일을 지정하세요.');
    if (jsonFields && format !== 'json') throw new Error('jsonFields는 JSON 파일에만 사용할 수 있습니다.');
    if (encoding !== 'auto' && !textFormats.has(format)) throw new Error('인코딩 지정은 TXT, Markdown, HTML, CSV 파일에 사용할 수 있습니다.');
    if (input.delimiter && format !== 'csv') throw new Error('구분 문자 지정은 CSV와 TSV 파일에 사용할 수 있습니다.');
    if (sheet && format !== 'xlsx') throw new Error('시트 선택은 XLSX 파일에만 사용할 수 있습니다.');
    if (pdfPages && format !== 'pdf') throw new Error('쪽 선택은 PDF 파일에만 사용할 수 있습니다.');
    const delimiter = input.delimiter ?? (format === 'csv' && lowerExtension === '.tsv' ? '\t' : undefined);
    const options = {...input, delimiter};
    const filenameTitle = basename(filePath, extension);
    const bytes = await readSource(filePath, (textFormats.has(format) || format === 'json' ? 2 : 64) * 1024 * 1024);
    signal?.throwIfAborted();
    const documentId = createHash('sha256')
        .update(JSON.stringify({version: 1, format, title: title ?? null, filenameTitle: title ? undefined : filenameTitle,
            representativeImage, encoding, jsonFields, delimiter, sheet, pdfPages})).update('\0').update(bytes).digest('hex');
    const hot = recent.get(documentId);
    if (hot && performance.now() - hot.storedAt < 2_000) return {documentId, record: hot.record, reused: true};
    const active = inProgress.get(documentId);
    const conversion = active ?? (async () => {
        const cached = await findPreparedDocument(documentId);
        const record = cached?.record ?? await convertAndStore(documentId, bytes, format, filenameTitle, options);
        remember(documentId, record);
        return {record, reused: !!cached};
    })();
    if (!active) inProgress.set(documentId, conversion);
    try {
        const {record, reused} = await conversion;
        signal?.throwIfAborted();
        return {documentId, record, reused: reused || !!active};
    } finally {
        if (!active) inProgress.delete(documentId);
    }
}

function* previewLines(draft: Draft) {
    for (const block of draft.blocks) {
        if (block.type === 'text') yield block.text ?? block.runs?.map(({text}) => text).join('') ?? '';
        if (block.type === 'quote') yield block.text;
        if (block.type === 'table') {
            for (const row of block.rows) {
                yield row.map((cell) => typeof cell === 'string' ? cell : cell.text ?? cell.runs?.map(({text}) => text).join('') ?? '').join(' | ');
            }
        }
    }
}

export function documentPreview(draft: Draft) {
    let preview = '';
    for (const line of previewLines(draft)) {
        if (preview) preview += '\n';
        preview += line.slice(0, 600 - preview.length);
        if (preview.length >= 600) break;
    }
    return preview;
}
