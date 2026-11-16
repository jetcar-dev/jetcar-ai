import {posix} from 'node:path';
import type {Block, Run} from '../document.js';
import {internalTarget, withWordArchive} from './word-archive.js';
import {attr, child, descendants, type XmlNode} from './word-xml.js';
import {wordColor} from './word-styles.js';

type Format = Omit<Run, 'text'>;
type Alignment = NonNullable<Block['align']>;
type Table = Extract<Block, {type: 'table'}>;
type TableCell = Exclude<Table['rows'][number][number], string>;
type Image = Extract<Block, {type: 'image'}>;
type Inline = {run: Run} | {block: Block};

const mebibyte = 1024 * 1024;
const photoExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif']);
const fonts = new Map<string, NonNullable<Run['fontFamily']>>([
    ['나눔고딕', 'nanumgothic'], ['nanumgothic', 'nanumgothic'],
    ['나눔명조', 'nanummyeongjo'], ['nanummyeongjo', 'nanummyeongjo'],
    ['나눔바른고딕', 'nanumbarungothic'], ['nanumbarungothic', 'nanumbarungothic'],
    ['나눔스퀘어', 'nanumsquare'], ['nanumsquare', 'nanumsquare'],
    ['마루부리', 'nanummaruburi'], ['나눔마루부리', 'nanummaruburi'], ['maruburi', 'nanummaruburi'],
    ['나눔다시시작해', 'nanumdasisijaghae'], ['나눔바른히피', 'nanumbareunhipi'],
    ['나눔우리딸손글씨', 'nanumuriddalsongeulssi'],
]);
const drawingObjects = new Set(['container', 'line', 'rect', 'ellipse', 'arc', 'polyline', 'polygon', 'curve', 'connectLine']);
const unsupportedObjects = new Set(['equation', 'ole', 'video', 'chart', 'formObject', 'compose', 'dutmal', 'footNote', 'endNote', 'header', 'footer']);
const strikeShapes = new Set(['SOLID', 'DASH', 'DOT', 'DASH_DOT', 'DASH_DOT_DOT', 'LONG_DASH', 'CIRCLE', 'DOUBLE_SLIM',
    'SLIM_THICK', 'THICK_SLIM', 'SLIM_THICK_SLIM', 'WAVE', 'DOUBLE_WAVE']);

function entriesById(parent: XmlNode | undefined, name: string) {
    const entries = new Map<string, XmlNode>();
    for (const node of parent?.children ?? []) {
        const id = attr(node, 'id');
        if (node.name === name && id !== undefined) entries.set(id, node);
    }
    return entries;
}

function alignment(value: string | undefined): Alignment | undefined {
    if (value === 'CENTER') return 'center';
    if (value === 'RIGHT') return 'right';
    if (value === 'LEFT') return 'left';
}

function color(value: string | undefined) {
    return wordColor(value?.replace(/^#/, ''));
}

function webLink(value: string | undefined) {
    if (!value || value.length > 4_096) return;
    const url = URL.parse(value);
    if (url && (url.protocol === 'https:' || url.protocol === 'http:') && url.href.length <= 4_096) return url.href;
}

function integer(value: string | undefined, fallback: number) {
    if (value === undefined) return fallback;
    return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : NaN;
}

function packageTarget(source: string, target: string | undefined) {
    if (!target) return;
    try {
        return internalTarget(source, {target, external: false, type: ''});
    } catch (error) {
        if (!(error instanceof URIError)) throw error;
    }
}

function hwpxStyles(header: XmlNode | undefined, warn: (message: string) => void) {
    const references = child(header, 'refList');
    const characterStyles = entriesById(child(references, 'charProperties'), 'charPr');
    const paragraphStyles = entriesById(child(references, 'paraProperties'), 'paraPr');
    const borderFills = entriesById(child(references, 'borderFills'), 'borderFill');
    const namedStyles = entriesById(child(references, 'styles'), 'style');
    const fontFaces = new Map<string, Map<string, XmlNode>>();
    for (const node of child(references, 'fontfaces')?.children ?? []) {
        if (node.name === 'fontface') fontFaces.set(attr(node, 'lang') ?? '', entriesById(node, 'font'));
    }
    const formats = new Map<XmlNode, Format>();
    function character(id: string): Format {
        const style = characterStyles.get(id);
        if (!style) return {};
        const cached = formats.get(style);
        if (cached) return cached;
        const format: Format = {};
        if (child(style, 'bold')) format.bold = true;
        if (child(style, 'italic')) format.italic = true;
        const underline = attr(child(style, 'underline'), 'type');
        if (underline && underline !== 'NONE') format.underline = true;
        if (strikeShapes.has(attr(child(style, 'strikeout'), 'shape') ?? '')) format.strikeThrough = true;
        const foreground = color(attr(style, 'textColor'));
        const background = color(attr(style, 'shadeColor'));
        if (foreground) format.fontColor = foreground;
        if (background) format.backgroundColor = background;

        const size = Number(attr(style, 'height')) * 4 / 300;
        if (Number.isFinite(size) && size > 0) {
            format.fontSize = Math.max(10, Math.min(40, Math.round(size)));
            if (Math.round(size) !== format.fontSize) warn('10~40px 범위를 벗어나는 HWPX 글자 크기를 조정했습니다.');
        }
        const fontRef = child(style, 'fontRef');
        const face = fontFaces.get('HANGUL')?.get(attr(fontRef, 'hangul') ?? '') ??
            fontFaces.get('LATIN')?.get(attr(fontRef, 'latin') ?? '');
        const name = attr(face, 'face');
        if (name) {
            format.fontFamily = fonts.get(name.replace(/\s/g, '').toLowerCase()) ?? 'system';
            if (format.fontFamily === 'system') warn('스마트에디터에 없는 HWPX 글꼴은 기본 글꼴로 표시됩니다.');
        }
        if (child(style, 'supscript') || child(style, 'subscript')) warn('HWPX 위·아래 첨자는 일반 글자로 옮겼습니다.');
        formats.set(style, format);
        return format;
    }

    function paragraph(node: XmlNode) {
        const named = namedStyles.get(attr(node, 'styleIDRef') ?? '');
        const properties = paragraphStyles.get(attr(node, 'paraPrIDRef') ?? attr(named, 'paraPrIDRef') ?? '');
        const horizontal = attr(child(properties, 'align'), 'horizontal');
        const align = alignment(horizontal) ?? 'left';
        if (horizontal && !alignment(horizontal)) warn('HWPX 양쪽 맞춤 등 지원하지 않는 문단 정렬은 왼쪽으로 표시됩니다.');
        const heading = attr(child(properties, 'heading'), 'type');
        if (heading && heading !== 'NONE') warn('HWPX 자동 목록 번호와 글머리 기호는 본문에 포함되지 않습니다.');
        return {align, characterId: attr(named, 'charPrIDRef') ?? '0'};
    }

    function cellColor(id: string | undefined) {
        const fill = child(borderFills.get(id ?? ''), 'fillBrush');
        if (child(fill, 'gradation') || child(fill, 'imgBrush')) warn('HWPX 표의 그라데이션과 그림 배경은 적용되지 않습니다.');
        return color(attr(child(fill, 'winBrush'), 'faceColor'));
    }
    return {character, paragraph, cellColor};
}

function inlineText(node: XmlNode): string {
    switch (node.name) {
        case 'tab': return '\t';
        case 'lineBreak': return '\n';
        case 'hyphen': return '-';
        case 'nbSpace': return '\u00a0';
        case 'fwSpace': return '\u3000';
        default: return '';
    }
}

function caption(node: XmlNode) {
    const text = child(node, 'caption');
    if (!text) return;
    return [...descendants(text, 'p')].map((paragraph) => [...descendants(paragraph, 't')]
        .map((item) => (item.textParts ?? [item.text]).map((part) => typeof part === 'string' ? part : inlineText(part)).join(''))
        .join('')).join('\n').trim();
}

export function parseHwpx(bytes: Buffer) {
    return withWordArchive(bytes, async (archive) => {
        const [mimetype, container] = await Promise.all([archive.read('mimetype', 256), archive.xml('META-INF/container.xml')]);
        if (mimetype && mimetype.toString('utf8').trim() !== 'application/hwp+zip') throw new Error('HWPX 파일 형식을 확인할 수 없습니다.');
        const rootfiles = child(container, 'rootfiles')?.children ?? [];
        const rootfile = rootfiles.find((node) => attr(node, 'media-type') === 'application/hwpml-package+xml') ??
            rootfiles.find((node) => attr(node, 'full-path')?.endsWith('.hpf'));
        const packagePath = packageTarget('', attr(rootfile, 'full-path')) ?? 'Contents/content.hpf';
        const document = await archive.xml(packagePath);
        const manifest = entriesById(child(document, 'manifest'), 'item');
        if (document?.name !== 'package' || !manifest.size) {
            throw new Error('HWPX 패키지 정보를 찾지 못했습니다. 암호를 해제한 .hwpx 파일을 사용하세요.');
        }

        function partPath(item: XmlNode | undefined) {
            const href = attr(item, 'href');
            // Hancom writes package-root paths, while OPF permits paths relative to the manifest.
            const fromRoot = packageTarget('', href);
            if (fromRoot && archive.size(fromRoot) !== undefined) return fromRoot;
            return packageTarget(packagePath, href);
        }

        const referenced = (child(document, 'spine')?.children ?? []).flatMap((node) => {
            const part = manifest.get(attr(node, 'idref') ?? '');
            return node.name === 'itemref' && part ? [part] : [];
        });
        const namedSections = [...manifest.values()].filter((item) => /(?:^|\/)section\d+\.xml$/i.test(attr(item, 'href') ?? ''))
            .sort((a, b) => (attr(a, 'href') ?? '').localeCompare(attr(b, 'href') ?? '', 'en', {numeric: true}));
        const candidates = referenced.length ? referenced : namedSections;
        const headerPath = partPath(manifest.get('header') ??
            [...manifest.values()].find((item) => /(?:^|\/)header\.xml$/i.test(attr(item, 'href') ?? ''))) ?? 'Contents/header.xml';
        const sectionPaths = [...new Set(candidates.flatMap((item) => {
            const path = partPath(item);
            return path && path !== headerPath && path.toLowerCase().endsWith('.xml') ? [path] : [];
        }))];
        const totalXmlBytes = [headerPath, ...sectionPaths].reduce((sum, path) => sum + (archive.size(path) ?? 0), 0);
        if (totalXmlBytes > 32 * mebibyte) throw new Error('HWPX 본문과 서식의 전체 크기는 32 MiB 이하여야 합니다.');

        const warnings = new Set<string>();
        const warn = (message: string) => { warnings.add(message); };
        const header = await archive.xml(headerPath);
        if (!header) warn('HWPX 서식 정보를 찾지 못해 기본 서식을 적용했습니다.');
        const styles = hwpxStyles(header, warn);
        const images = new Map<string, string>();
        let imageCount = 0;

        function picture(node: XmlNode, align: Alignment): Image | undefined {
            const ref = attr(child(node, 'img'), 'binaryItemIDRef');
            const target = partPath(manifest.get(ref ?? ''));
            const extension = target && posix.extname(target).toLowerCase();
            if (!target || !extension || !photoExtensions.has(extension) || !archive.size(target)) {
                warn('외부 링크 또는 JPG·PNG·GIF 형식 이외의 HWPX 그림은 첨부할 수 없습니다.');
                return;
            }
            if (++imageCount > 20) throw new Error('HWPX 사진은 한 원고에 최대 20장까지 가져올 수 있습니다.');
            if (!images.has(target)) images.set(target, `image-${images.size + 1}${extension}`);
            const position = child(node, 'pos');
            if (attr(position, 'treatAsChar') === '0') {
                warn('위치가 고정된 HWPX 그림은 본문 순서에 맞춰 넣었습니다.');
                align = alignment(attr(position, 'horzAlign')) ?? align;
            }
            const clip = child(node, 'imgClip'), dimensions = child(node, 'imgDim');
            if (clip && dimensions && (Number(attr(clip, 'left')) || Number(attr(clip, 'top')) ||
                attr(clip, 'right') !== attr(dimensions, 'dimwidth') || attr(clip, 'bottom') !== attr(dimensions, 'dimheight'))) {
                warn('HWPX에서 잘라낸 그림은 원본 이미지로 들어갑니다.');
            }
            const label = caption(node);
            return {type: 'image', file: images.get(target)!, align, ...(label && {caption: label.slice(0, 5_000)}),
                link: webLink(attr(node, 'href'))};
        }

        function paragraph(node: XmlNode) {
            const {align, characterId} = styles.paragraph(node);
            const items: Inline[] = [];
            let previousFormat: Format | undefined;
            function addText(text: string, format: Format) {
                if (!text) return;
                const previous = items.at(-1);
                if (format === previousFormat && previous && 'run' in previous) previous.run.text += text;
                else items.push({run: {text, ...format}});
                previousFormat = format;
            }
            function walk(item: XmlNode, format: Format) {
                if (item.name === 't') {
                    for (const part of item.textParts ?? [item.text]) addText(typeof part === 'string' ? part : inlineText(part), format);
                } else if (item.name === 'pic') {
                    const image = picture(item, align);
                    if (image) items.push({block: image});
                } else if (item.name === 'tbl') {
                    for (const block of table(item, align)) items.push({block});
                } else if (item.name === 'run') {
                    const runFormat = styles.character(attr(item, 'charPrIDRef') ?? characterId);
                    for (const nested of item.children) walk(nested, runFormat);
                } else if (drawingObjects.has(item.name)) {
                    warn('HWPX 도형과 글상자의 내용은 본문에 옮기고 도형의 모양은 생략했습니다.');
                    for (const nested of item.children) walk(nested, format);
                } else if (item.name === 'drawText' || item.name === 'subList' || item.name === 'ctrl') {
                    for (const nested of item.children) walk(nested, format);
                } else if (item.name === 'p') {
                    for (const block of paragraphBlocks(item)) items.push({block});
                } else if (item.name === 'switch') {
                    const branch = child(item, 'default') ?? child(item, 'case');
                    for (const nested of branch?.children ?? []) walk(nested, format);
                } else if (unsupportedObjects.has(item.name) || item.name === 'fieldBegin') {
                    warn('HWPX 각주·양식·수식·차트·필드 등 일부 개체의 서식이나 내용은 생략했습니다.');
                }
            }
            const base = styles.character(characterId);
            for (const item of node.children) walk(item, base);
            return {align, items};
        }

        function paragraphBlocks(node: XmlNode): Block[] {
            const {align, items} = paragraph(node);
            const blocks: Block[] = [];
            let runs: Run[] = [];
            function flush() {
                if (runs.length) {
                    if (!runs.some(({text}) => text.trim())) runs.push({text: '\u200b'});
                    blocks.push({type: 'text', align, runs});
                    runs = [];
                }
            }
            for (const item of items) {
                if ('run' in item) {
                    if (runs.length === 199) flush();
                    runs.push(item.run);
                } else {
                    flush();
                    blocks.push(item.block);
                }
            }
            flush();
            if (!items.length) blocks.push({type: 'text', align, text: '\u200b'});
            return blocks;
        }

        function cellContent(node: XmlNode, images: Image[]) {
            const runs: Run[] = [];
            let align: Alignment | undefined;
            for (const paragraph of child(node, 'subList')?.children ?? []) {
                if (paragraph.name !== 'p') continue;
                if (runs.length) runs.push({text: '\n'});
                for (const block of paragraphBlocks(paragraph)) {
                    if (block.type === 'text') {
                        align ??= block.align;
                        runs.push(...(block.runs ?? [{text: block.text ?? ''}]));
                    } else if (block.type === 'image') {
                        images.push(block);
                    } else if (block.type === 'table') {
                        warn('HWPX 중첩 표는 셀 안의 텍스트로 옮겼습니다.');
                        for (const row of block.rows) {
                            if (runs.length) runs.push({text: '\n'});
                            const text = row.map((cell) => typeof cell === 'string' ? cell :
                                cell.text ?? cell.runs?.map(({text}) => text).join('') ?? '').join('\t');
                            if (text) runs.push({text});
                        }
                    }
                }
            }
            const span = child(node, 'cellSpan');
            const rowSpan = integer(attr(span, 'rowSpan'), 1);
            const colSpan = integer(attr(span, 'colSpan'), 1);
            const base = {align, cellColor: styles.cellColor(attr(node, 'borderFillIDRef')), rowSpan, colSpan};
            if (runs.length > 200) {
                warn('글자 서식이 많은 HWPX 표 셀은 일반 텍스트로 옮겼습니다.');
                return {...base, text: runs.map(({text}) => text).join('')};
            }
            return {...base, ...(runs.length ? {runs} : {text: ''})};
        }

        function table(node: XmlNode, align: Alignment): Block[] {
            const rowNodes = node.children.filter((item) => item.name === 'tr');
            const rowCount = integer(attr(node, 'rowCnt'), rowNodes.length);
            const columnCount = integer(attr(node, 'colCnt'), 0);
            const cellImages: Image[] = [];
            const rows: Table['rows'] = [];
            const grid = rowCount > 0 && rowCount <= 30 && columnCount > 0 && columnCount <= 20
                ? Array.from({length: rowCount}, () => Array<boolean>(columnCount).fill(false)) : [];
            let valid = grid.length === rowNodes.length && grid.length > 0;
            for (const [rowIndex, rowNode] of rowNodes.entries()) {
                const cells = rowNode.children.filter((item) => item.name === 'tc');
                const row: TableCell[] = [];
                let column = 0;
                for (const cellNode of cells) {
                    const cell = cellContent(cellNode, cellImages);
                    row.push(cell);
                    if (!valid) continue;
                    while (grid[rowIndex][column]) column++;
                    const address = child(cellNode, 'cellAddr');
                    const {rowSpan, colSpan} = cell;
                    if (integer(attr(address, 'rowAddr'), rowIndex) !== rowIndex ||
                        integer(attr(address, 'colAddr'), column) !== column ||
                        !(rowSpan > 0 && colSpan > 0 && rowIndex + rowSpan <= rowCount && column + colSpan <= columnCount)) {
                        valid = false;
                        continue;
                    }
                    for (let y = rowIndex; y < rowIndex + rowSpan; y++) {
                        for (let x = column; x < column + colSpan; x++) {
                            if (grid[y][x]) valid = false;
                            grid[y][x] = true;
                        }
                    }
                    column += colSpan;
                }
                rows.push(row);
            }
            if (cellImages.length) warn('HWPX 표 안의 사진은 표 뒤에 넣었습니다.');
            const position = child(node, 'pos');
            if (attr(position, 'treatAsChar') === '0') align = alignment(attr(position, 'horzAlign')) ?? align;
            const label = caption(node);
            const captionBlock: Block[] = label ? [{type: 'text', text: label, align}] : [];
            const tableBlocks: Block[] = [];
            if (valid && grid.every((row) => row.every(Boolean))) {
                tableBlocks.push({type: 'table', rows, align});
            } else {
                warn('스마트에디터 크기를 초과하거나 병합을 확인할 수 없는 HWPX 표는 탭으로 구분한 텍스트로 옮겼습니다.');
                for (const row of rows) {
                    const text = row.map((cell) => typeof cell === 'string' ? cell :
                        cell.text ?? cell.runs?.map(({text}) => text).join('') ?? '').join('\t');
                    if (text.trim()) tableBlocks.push({type: 'text', text, align});
                }
            }
            return attr(child(node, 'caption'), 'side') === 'TOP'
                ? [...captionBlock, ...tableBlocks, ...cellImages]
                : [...tableBlocks, ...captionBlock, ...cellImages];
        }

        const blocks: Block[] = [];
        let sectionCount = 0;
        for (const path of sectionPaths) {
            const section = await archive.xml(path, 't');
            if (section?.name !== 'sec') {
                if (!section) throw new Error('HWPX 본문 구역을 읽지 못했습니다.');
                continue;
            }
            sectionCount++;
            for (const node of section.children) {
                if (node.name === 'p') blocks.push(...paragraphBlocks(node));
            }
        }
        if (!sectionCount) throw new Error('HWPX 본문 구역을 찾지 못했습니다.');
        const assets = new Map<string, Buffer>();
        const imageEntries = [...images];
        const imageBytes = imageEntries.reduce((sum, [path]) => sum + (archive.size(path) ?? 0), 0);
        if (imageBytes > 25 * mebibyte) throw new Error('HWPX 사진의 전체 용량은 25 MiB 이하여야 합니다.');
        for (let start = 0; start < imageEntries.length; start += 4) {
            const batch = await Promise.allSettled(imageEntries.slice(start, start + 4).map(async ([path, file]) => {
                const asset = await archive.read(path, 5 * mebibyte);
                if (!asset?.length) throw new Error('HWPX 파일에 첨부된 사진을 읽지 못했습니다.');
                return [file, asset] as const;
            }));
            for (const result of batch) {
                if (result.status === 'rejected') throw result.reason;
                assets.set(...result.value);
            }
        }
        return {title: child(child(document, 'metadata'), 'title')?.text.trim(), blocks, assets, warnings: [...warnings]};
    });
}
