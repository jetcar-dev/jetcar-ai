import {McpServer} from '@modelcontextprotocol/server';
import {serveStdio} from '@modelcontextprotocol/server/stdio';
import {z} from 'zod';
import {documentSchema, prepareDocument} from './document.js';
import {documentPreview, importEditorFile, importFileSchema} from './imports/files.js';
import {documentIdSchema, readPreparedDocument} from './prepared-documents.js';
import {sourceBlocks} from './source.js';

const features = [
    {name: '문단과 글자 서식', input: 'text', description: '줄바꿈, 정렬, 글꼴·크기·색·강조색, 굵게·기울임·밑줄·취소선, 구간별 서식과 링크'},
    {name: '표', input: 'table', description: '행과 열, 셀 병합, 셀 배경색과 글자 서식'},
    {name: '사진', input: 'image', description: '사진 파일 이름, 설명, 링크, 대표사진 순번 지정'},
    {name: '동영상', input: 'video', description: 'MP4 파일 이름과 제목'},
    {name: '인용구', input: 'quote', description: '스타일 1~6과 출처'},
    {name: '구분선', input: 'divider', description: '스타일 0~7'},
];
const readOnly = {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false};
const preparedSchema = z.object({draft: documentSchema});

function preparedResult(draft: ReturnType<typeof prepareDocument>) {
    return {
        content: [{type: 'text' as const, text: `스마트에디터 원고를 구성했습니다. 제목은 “${draft.title}”입니다.`}],
        structuredContent: {draft},
    };
}

function createServer() {
    const server = new McpServer({name: 'smart-editor-one', version: '0.1.0'});

    server.registerTool('list_smart_editor_features', {
        title: '스마트에디터 ONE 기능 조회',
        description: '원고에 적용할 수 있는 스마트에디터 ONE 기능과 입력 항목을 보여줍니다.',
        inputSchema: z.object({}),
        annotations: readOnly,
    }, () => ({
        content: [{type: 'text', text: features.map(({name, input, description}) => `- ${name} (${input}) — ${description}`).join('\n')}],
        structuredContent: {features},
    }));

    server.registerTool('convert_smart_editor_source', {
        title: '스마트에디터 ONE 원문 변환',
        description: '일반 텍스트의 줄바꿈을 유지하거나 Markdown의 제목, 글자 서식, 링크, 표, 인용구, 구분선과 사진 파일을 스마트에디터 본문으로 변환합니다. 반환된 draft는 카페 임시저장에 사용할 수 있습니다.',
        inputSchema: documentSchema.pick({title: true, representativeImage: true}).extend({
            source: z.string().min(1).max(60_000).refine((source) => !!source.trim(), '변환할 원문을 입력하세요.'),
            format: z.enum(['text', 'markdown']).default('text').describe('일반 텍스트는 text, Markdown으로 작성된 원문만 markdown을 사용합니다.'),
        }),
        outputSchema: preparedSchema,
        annotations: readOnly,
    }, ({title, source, format, representativeImage}) => {
        const draft = documentSchema.parse({title, representativeImage, blocks: sourceBlocks(source, format)});
        return preparedResult(prepareDocument(draft));
    });

    server.registerTool('prepare_smart_editor_document', {
        title: '스마트에디터 ONE 서식 입력',
        description: '제목과 본문 블록을 검증하고, 연속된 같은 정렬의 문단을 한 텍스트 블록으로 묶습니다. 반환된 draft를 네이버 카페의 save_cafe_draft 입력에 그대로 사용할 수 있습니다.',
        inputSchema: documentSchema,
        outputSchema: preparedSchema,
        annotations: readOnly,
    }, (draft) => preparedResult(prepareDocument(draft)));

    server.registerTool('import_smart_editor_file', {
        title: '스마트에디터 ONE 원본 파일 가져오기',
        description: '사용자가 준 TXT, Markdown, JSON, DOCX, HTML, HWPX, CSV·TSV, XLSX, PDF 파일을 로컬에서 변환합니다. 워크시트와 PDF 쪽을 선택할 수 있습니다. 반환된 documentId를 저장 도구에 넘기며, 같은 원본과 옵션은 변환 결과를 재사용합니다.',
        inputSchema: importFileSchema,
        annotations: {...readOnly, readOnlyHint: false},
    }, async (input, {mcpReq: {signal}}) => {
        const started = performance.now();
        const {documentId, record, reused} = await importEditorFile(input, signal);
        const result = {documentId, format: record.format, title: record.draft.title, blockCount: record.draft.blocks.length,
            attachmentCount: record.attachmentCount, warnings: record.warnings, preview: documentPreview(record.draft),
            reused, elapsedMs: Math.round(performance.now() - started)};
        const message = reused ? '기존 변환 결과를 재사용했습니다.' : '원본 파일을 가져왔습니다.';
        return {content: [{type: 'text', text: `${message}\n${JSON.stringify(result)}`}], structuredContent: result};
    });

    server.registerTool('read_smart_editor_document', {
        title: '가져온 스마트에디터 원고 읽기',
        description: '파일 가져오기가 반환한 원고 ID로 전체 본문과 서식, 변환 시 안내를 읽습니다. 그대로 저장할 때는 이 도구를 건너뛰고 저장 도구에 원고 ID를 넘기세요.',
        inputSchema: z.object({documentId: documentIdSchema}),
        annotations: readOnly,
    }, async ({documentId}) => {
        const {record} = await readPreparedDocument(documentId);
        return {content: [{type: 'text', text: `“${record.draft.title}” 원고를 읽었습니다.`}],
            structuredContent: {documentId, draft: record.draft, warnings: record.warnings}};
    });

    return server;
}

serveStdio(createServer);
