import {randomUUID} from 'node:crypto';
import {z} from 'zod';

export const editorId = () => `SE-${randomUUID()}`;

const align = z.enum(['left', 'center', 'right']);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/).describe('예: #173E72');
const linkUrl = z.url({protocol: /^https?$/}).max(4_096);
const format = {
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    strikeThrough: z.boolean().optional(),
    fontFamily: z.enum([
        'system', 'nanumgothic', 'nanummyeongjo', 'nanumbarungothic', 'nanumsquare',
        'nanummaruburi', 'nanumdasisijaghae', 'nanumbareunhipi', 'nanumuriddalsongeulssi',
    ]).optional(),
    fontSize: z.number().int().min(10).max(40).optional(),
    fontColor: color.optional(),
    backgroundColor: color.optional(),
    link: linkUrl.optional(),
};
const run = z.object({text: z.string().min(1).max(30_000), ...format});
const runs = z.array(run).min(1).max(200);
const paragraph = {align: align.optional(), ...format};

const cell = z.union([
    z.string().max(30_000),
    z.object({
        text: z.string().max(30_000).optional(),
        runs: runs.optional(),
        ...paragraph,
        cellColor: color.optional(),
        rowSpan: z.number().int().min(1).optional(),
        colSpan: z.number().int().min(1).optional(),
    }).refine(({text, runs}) => text === undefined || runs === undefined, '셀에는 text 또는 runs 중 하나만 입력하세요.'),
]);
type Cell = z.infer<typeof cell>;

function tableWidth(rows: Cell[][]) {
    return rows[0].reduce((count, cell) => count + (typeof cell === 'string' ? 1 : cell.colSpan ?? 1), 0);
}

function validTable(rows: Cell[][]) {
    const width = tableWidth(rows);
    if (width < 1 || width > 20) return false;
    const grid = rows.map(() => Array<boolean>(width).fill(false));
    for (const [row, cells] of rows.entries()) {
        let column = 0;
        for (const cell of cells) {
            while (grid[row][column]) column++;
            const height = typeof cell === 'string' ? 1 : cell.rowSpan ?? 1;
            const span = typeof cell === 'string' ? 1 : cell.colSpan ?? 1;
            if (row + height > rows.length || column + span > width) return false;
            for (let y = row; y < row + height; y++) {
                for (let x = column; x < column + span; x++) {
                    if (grid[y][x]) return false;
                    grid[y][x] = true;
                }
            }
            column += span;
        }
        if (grid[row].includes(false)) return false;
    }
    return true;
}

export const editorBlock = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('text'),
        text: z.string().max(30_000).refine((text) => text.trim().length > 0, '본문을 입력하세요.').optional(),
        runs: runs.optional().describe('같은 문단 안에서 구간별 서식을 지정합니다. text와 함께 사용하지 않습니다.'),
        ...paragraph,
    }).refine(({text, runs}) => text ? !runs : !!runs?.some(({text}) => text.trim()),
        '본문에 text 또는 내용이 있는 runs 중 하나를 입력하세요.'),
    z.object({
        type: z.literal('quote'),
        text: z.string().max(5_000).refine((text) => text.trim().length > 0, '인용구 내용을 입력하세요.'),
        source: z.string().trim().min(1).max(1_000).optional(),
        ...paragraph,
        style: z.literal([1, 2, 3, 4, 5, 6]).optional().describe(
            '스마트에디터 인용구: 1 기본, 2 세로선(생략 시), 3 말풍선, 4 밑줄, 5 포스트잇, 6 모서리',
        ),
    }),
    z.object({
        type: z.literal('table'),
        rows: z.array(z.array(cell).max(20)).min(1).max(30).refine(validTable,
            '표는 모든 행의 열 수가 같아야 합니다. 병합한 영역에는 셀을 추가로 넣지 마세요.'),
        align: align.optional(),
        style: z.literal([0, 1, 2, 3, 4, 5, 6, 7]).optional().describe('표 디자인 번호. 0은 기본입니다.'),
    }),
    z.object({
        type: z.literal('divider'),
        align: align.optional(),
        style: z.literal([0, 1, 2, 3, 4, 5, 6, 7]).optional().describe('구분선 디자인 번호. 0은 기본입니다.'),
    }),
    z.object({
        type: z.literal('image'),
        file: z.string().min(1).max(255),
        align: align.optional(),
        caption: z.string().trim().min(1).max(5_000).optional(),
        link: linkUrl.optional(),
    }),
    z.object({
        type: z.literal('video'),
        file: z.string().min(1).max(255).describe('사진과 같은 폴더에 있는 MP4 파일 이름입니다.'),
        title: z.string().trim().min(1).max(40).optional(),
        align: align.optional(),
    }),
]);

type Format = {[K in keyof typeof format]?: z.infer<(typeof format)[K]>};
type Text = {text?: string; runs?: z.infer<typeof runs>; align?: z.infer<typeof align>} & Format;
export type EditorBlock = z.infer<typeof editorBlock>;

function textLength({text, runs}: Text) {
    return runs?.reduce((count, run) => count + run.text.length, 0) ?? text?.length ?? 0;
}

export function blockTextLength(block: EditorBlock): number {
    switch (block.type) {
        case 'text': return textLength(block);
        case 'quote': return block.text.length + (block.source?.length ?? 0);
        case 'table': return block.rows.flat().reduce((count, cell) =>
            count + (typeof cell === 'string' ? cell.length : textLength(cell)), 0);
        case 'image': return block.caption?.length ?? 0;
        case 'video': return block.title?.length ?? 0;
        default: return 0;
    }
}

function textNode(value: string, {fontSize, link, ...style}: Format) {
    const nodeStyle = {
        ...style,
        ...(fontSize !== undefined && {fontSizeCode: `fs${fontSize}`}),
    };
    return {
        '@ctype': 'textNode', id: editorId(), value,
        ...(Object.values(nodeStyle).some((value) => value !== undefined) && {style: {'@ctype': 'nodeStyle', ...nodeStyle}}),
        ...(link && {link: {'@ctype': 'urlLink', url: link}}),
    };
}

export function paragraphs({text: plainText, runs, align, ...base}: Text) {
    const lines: ReturnType<typeof textNode>[][] = [[]];
    for (const {text, ...format} of runs ?? [{text: plainText ?? ''}]) {
        const style = {...base, ...format};
        const pieces = text.split(/\r\n?|\n/);
        for (const [index, piece] of pieces.entries()) {
            if (index) lines.push([]);
            if (piece) lines[lines.length - 1].push(textNode(piece, style));
        }
    }
    return lines.map((nodes) => ({
        '@ctype': 'paragraph', id: editorId(), nodes,
        ...(align && {style: {'@ctype': 'paragraphStyle', align}}),
    }));
}

const quotationLayouts = {
    1: 'default',
    2: 'quotation_line',
    3: 'quotation_bubble',
    4: 'quotation_underline',
    5: 'quotation_postit',
    6: 'quotation_corner',
} as const;

export function editorComponent(block: Exclude<EditorBlock, {type: 'image' | 'video'}>) {
    switch (block.type) {
        case 'text': {
            const {type, ...text} = block;
            return {'@ctype': 'text', id: editorId(), layout: 'default', value: paragraphs(text)};
        }
        case 'quote': {
            const {type, style, source, align, ...text} = block;
            return {
                '@ctype': 'quotation', id: editorId(), layout: quotationLayouts[style ?? 2], value: paragraphs(text),
                ...(align && {align}),
                ...(source && {source: paragraphs({text: source})}),
            };
        }
        case 'divider':
            return {
                '@ctype': 'horizontalLine', id: editorId(), layout: block.style ? `line${block.style}` : 'default',
                ...(block.align && {align: block.align}),
            };
        case 'table': {
            const columnCount = tableWidth(block.rows);
            const rows = block.rows.map((row) => ({
                '@ctype': 'tableRow', id: editorId(),
                cells: row.map((cell) => {
                    const {cellColor, rowSpan = 1, colSpan = 1, ...text} = typeof cell === 'string' ? {text: cell} : cell;
                    const value = paragraphs(text);
                    return {
                        '@ctype': 'tableCell', id: editorId(), rowSpan, colSpan,
                        width: Number((100 * colSpan / columnCount).toFixed(2)), height: 43 * rowSpan,
                        ...(cellColor && {backgroundColor: cellColor}),
                        ...(value.some((paragraph) => paragraph.nodes.length || paragraph.style) && {value}),
                    };
                }),
            }));
            return {
                '@ctype': 'table', id: editorId(), layout: block.style ? `table_layout${block.style}` : 'default',
                width: 100, columnCount, rows, borderStyleName: 'thinLine',
                ...(block.align && {align: block.align}),
            };
        }
    }
}
