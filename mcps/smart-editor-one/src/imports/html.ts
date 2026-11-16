import {parseDocument, DomUtils} from 'htmlparser2';
import type {Block, Run} from '../document.js';

type Node = ReturnType<typeof parseDocument>['children'][number];
type Tag = Extract<Node, {attribs: Record<string, string>}>;
const isTag = (node: Node): node is Tag => 'attribs' in node;
type Style = Omit<Run, 'text'>;
type Alignment = 'left' | 'center' | 'right';
type Table = Extract<Block, {type: 'table'}>;
type Image = Extract<Block, {type: 'image'}>;

const ignoredTags = new Set(['head', 'script', 'style', 'template', 'noscript', 'iframe', 'svg', 'canvas', 'object']);
const paragraphTags = new Set(['p', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const containers = new Set(['div', 'main', 'section', 'article', 'figure', 'figcaption', 'header', 'footer', 'aside']);
const namedColors: Record<string, string> = {
    black: '#000000', white: '#FFFFFF', red: '#FF0000', blue: '#0000FF', green: '#008000', yellow: '#FFFF00',
    orange: '#FFA500', gray: '#808080', grey: '#808080', purple: '#800080', navy: '#000080', silver: '#C0C0C0',
};

function css(node: Tag) {
    const rules: Record<string, string> = Object.create(null);
    for (const rule of node.attribs.style?.split(';') ?? []) {
        const index = rule.indexOf(':');
        if (index > 0) rules[rule.slice(0, index).trim().toLowerCase()] = rule.slice(index + 1).replace(/\s*!important\s*$/i, '').trim();
    }
    return rules;
}

function color(value: string | undefined) {
    if (!value) return;
    if (/^#[0-9a-f]{6}$/i.test(value)) return value;
    if (/^#[0-9a-f]{3}$/i.test(value)) return `#${[...value.slice(1)].map((digit) => digit.repeat(2)).join('')}`;
    const match = /^rgb\(\s*(\d{1,3})[ ,]+(\d{1,3})[ ,]+(\d{1,3})\s*\)$/i.exec(value);
    if (match && match.slice(1).every((part) => Number(part) <= 255)) {
        return `#${match.slice(1).map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`;
    }
    return Object.hasOwn(namedColors, value.toLowerCase()) ? namedColors[value.toLowerCase()] : undefined;
}

function webLink(url: string | undefined) {
    const link = url && URL.parse(url);
    return link && ['http:', 'https:'].includes(link.protocol) && !link.username && !link.password ? link.href : undefined;
}

type Formatting = {style: Style; align?: Alignment; pre: boolean};
const initial: Formatting = {style: {}, pre: false};

function hidden(node: Tag, rules: Record<string, string>) {
    return ignoredTags.has(node.name) || Object.hasOwn(node.attribs, 'hidden') || rules.display === 'none' || rules.visibility === 'hidden';
}

function formatting(node: Tag, rules: Record<string, string>, parent: Formatting, warn: (message: string) => void): Formatting {
    const {name, attribs} = node;
    const style = {...parent.style};
    if (name === 'b' || name === 'strong' || name === 'th') style.bold = true;
    if (name === 'i' || name === 'em') style.italic = true;
    if (name === 'u') style.underline = true;
    if (['s', 'del', 'strike'].includes(name)) style.strikeThrough = true;
    if (name === 'mark') style.backgroundColor = '#FFFF00';
    if (name === 'a') {
        const url = webLink(attribs.href);
        if (url) style.link = url;
        else if (attribs.href) warn('일부 HTML 링크는 주소를 연결하지 않고 표시 텍스트를 가져왔습니다.');
    }
    if (/^h[1-6]$/.test(name)) {
        style.bold = true;
        style.fontSize = [26, 23, 20, 18, 16, 16][Number(name[1]) - 1];
    }
    const weight = rules['font-weight'];
    if (weight && /^(normal|bold|bolder|lighter|\d+)$/.test(weight)) style.bold = weight === 'bold' || weight === 'bolder' || Number(weight) >= 600;
    const fontStyle = rules['font-style'];
    if (fontStyle) style.italic = /^(italic|oblique)/.test(fontStyle);
    const decoration = rules['text-decoration-line'] ?? rules['text-decoration'];
    if (decoration) {
        style.underline = decoration.includes('underline');
        style.strikeThrough = decoration.includes('line-through');
    }
    const fg = color(rules.color ?? attribs.color), bg = color(rules['background-color'] ?? rules.background);
    if (fg) style.fontColor = fg;
    if (bg) style.backgroundColor = bg;
    const size = /^(\d+(?:\.\d+)?|\.\d+)(px|pt)$/.exec(rules['font-size'] ?? '');
    if (size) {
        const pixels = Math.round(Number(size[1]) * (size[2] === 'pt' ? 4 / 3 : 1));
        style.fontSize = Math.max(10, Math.min(40, pixels));
        if (style.fontSize !== pixels) warn('HTML의 일부 글자 크기를 10~40px 범위로 조정했습니다.');
    } else if (rules['font-size']) warn('일부 HTML 글자 크기 단위는 그대로 적용되지 않습니다.');
    const font = (rules['font-family'] ?? attribs.face)?.split(',')[0].replace(/['"\s]/g, '').toLowerCase();
    if (font) {
        const families: NonNullable<Style['fontFamily']>[] = [
            'nanumgothic', 'nanummyeongjo', 'nanumbarungothic', 'nanumsquare', 'nanummaruburi',
            'nanumdasisijaghae', 'nanumbareunhipi', 'nanumuriddalsongeulssi',
        ];
        const family = font === '나눔고딕' ? 'nanumgothic' : font === '나눔명조' ? 'nanummyeongjo' : families.find((item) => item === font);
        if (family) style.fontFamily = family;
        else warn('스마트에디터에서 선택할 수 없는 HTML 글꼴은 기본 글꼴로 표시됩니다.');
    }
    const align = rules['text-align'] ?? attribs.align ?? (name === 'center' ? 'center' : undefined);
    if (align === 'justify') warn('HTML 양쪽 맞춤은 그대로 적용되지 않습니다.');
    return {style, align: align === 'left' || align === 'center' || align === 'right' ? align : parent.align,
        pre: name === 'pre' || /^pre(?:-wrap|-line)?$/.test(rules['white-space'] ?? '') || parent.pre};
}

export function parseHtml(source: string) {
    const doc = parseDocument(source);
    const body = DomUtils.findOne((node) => node.name === 'body', doc.children);
    const title = DomUtils.findOne((node) => node.name === 'title', doc.children);
    const warnings = new Set<string>(), blocks: Block[] = [];
    const assets = new Map<string, Buffer>(), namedImages = new Set<string>();
    const warn = (message: string) => { warnings.add(message); };
    if (DomUtils.findOne((node) => node.name === 'style' || (node.name === 'link' && node.attribs.rel?.toLowerCase() === 'stylesheet'), doc.children)) {
        warn('HTML 스타일시트는 적용하지 않았습니다. 태그와 인라인 서식을 가져왔습니다.');
    }
    const dataImages = new Map<string, string>();
    let assetBytes = 0, assetName = 1;
    for (const node of DomUtils.findAll((node) => node.name === 'img', (body ?? doc).children)) {
        const src = node.attribs.src?.trim().replace(/^\.\//, '');
        if (src && src.length <= 255 && !src.includes(':')) namedImages.add(src.toLowerCase());
    }

    function image(node: Tag, ctx: Formatting): Image | undefined {
        const src = node.attribs.src?.trim();
        if (!src) return;
        let file: string;
        const data = /^data:image\/(jpeg|png|gif);base64,([a-z0-9+/=\s]+)$/i.exec(src);
        if (data) {
            const encoded = data[2].replace(/\s/g, '');
            const previous = dataImages.get(encoded);
            if (previous) file = previous;
            else {
                const bytes = Buffer.from(encoded, 'base64');
                const ext = data[1].toLowerCase().replace('jpeg', 'jpg');
                if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('HTML 내장 사진은 한 장에 5 MiB까지 가져올 수 있습니다.');
                assetBytes += bytes.length;
                if (assetBytes > 25 * 1024 * 1024) throw new Error('HTML 내장 사진의 전체 용량은 25 MiB 이하여야 합니다.');
                do { file = `image-${assetName++}.${ext}`; } while (namedImages.has(file));
                assets.set(file, bytes);
                dataImages.set(encoded, file);
            }
        } else {
            file = src.replace(/^\.\//, '');
            if (!/^[^\\/:*?"<>|\x00-\x1f]+\.(?:jpe?g|png|gif)$/i.test(file)) return;
        }
        return {type: 'image', file, align: ctx.align, ...(ctx.style.link && {link: ctx.style.link})};
    }

    function inline(nodes: Node[], ctx: Formatting, depth: number, images: boolean) {
        const parts: (Run | Image)[] = [];
        function text(raw: string, format: Formatting) {
            const previous = parts.at(-1);
            let value = format.pre ? raw : raw.replace(/[\t\n\r\f ]+/g, ' ');
            if (!format.pre && (!previous || !('text' in previous) || /[ \n]$/.test(previous.text))) value = value.replace(/^ +/, '');
            if (value) parts.push({text: value, ...format.style});
        }
        function visit(items: Node[], format: Formatting, level: number) {
            if (level > 120) throw new Error('HTML 문서의 구조가 너무 깊습니다.');
            for (const node of items) {
                if (node.type === 'text') { text(node.data, format); continue; }
                if (!isTag(node)) continue;
                const rules = css(node);
                if (hidden(node, rules)) continue;
                const current = formatting(node, rules, format, warn);
                if (node.name === 'br') { text('\n', {...current, pre: true}); continue; }
                if (node.name === 'img') {
                    const picture = images && image(node, current);
                    if (picture) parts.push(picture);
                    else {
                        warn(images ? '외부 사진과 지원하지 않는 사진 경로는 대체 텍스트로 옮겼습니다.' : 'HTML 표·인용구 안의 사진은 대체 텍스트로 옮겼습니다.');
                        const link = webLink(node.attribs.src);
                        text(node.attribs.alt || link || '', link ? {...current, style: {...current.style, link}} : current);
                    }
                    continue;
                }
                if ((paragraphTags.has(node.name) || containers.has(node.name) || node.name === 'li') && parts.length) {
                    text('\n', {...current, pre: true});
                }
                visit(node.children, current, level + 1);
            }
        }
        visit(nodes, ctx, depth);
        return parts;
    }

    function inlineRuns(nodes: Node[], ctx: Formatting, depth: number) {
        return inline(nodes, ctx, depth, false).filter((part): part is Run => 'text' in part);
    }

    function paragraph(nodes: Node[], ctx: Formatting, depth: number) {
        let runs: Run[] = [];
        const flush = () => {
            if (runs.some(({text}) => text.trim())) blocks.push({type: 'text', runs, align: ctx.align});
            runs = [];
        };
        for (const part of inline(nodes, ctx, depth, true)) {
            if ('text' in part) runs.push(part);
            else { flush(); blocks.push(part); }
        }
        flush();
    }

    function table(node: Tag, ctx: Formatting, depth: number) {
        const isRow = (tag: Tag) => tag.name === 'tr';
        const rows = node.children.flatMap((item) => !isTag(item) ? [] : isRow(item) ? [item]
            : ['thead', 'tbody', 'tfoot'].includes(item.name) ? item.children.filter(isTag).filter(isRow) : []);
        if (!rows.length) return;
        if (rows.length > 30) throw new Error('HTML 표는 한 표에 최대 30행까지 가져올 수 있습니다.');
        const grid = rows.map(() => Array<boolean>(20).fill(false));
        const widths: number[] = [];
        const converted: Table['rows'] = rows.map((row, index) => {
            let column = 0;
            const output: Table['rows'][number] = [];
            for (const td of row.children.filter(isTag).filter((tag) => ['td', 'th'].includes(tag.name))) {
                while (grid[index][column]) column++;
                const rowSpan = Number(td.attribs.rowspan ?? 1);
                const colSpan = Number(td.attribs.colspan ?? 1);
                const height = rowSpan === 0 ? rows.length - index : Math.min(rows.length - index, Math.max(1, rowSpan || 1));
                const width = Math.max(1, colSpan || 1);
                if (!Number.isInteger(height) || !Number.isInteger(width) || column + width > 20) throw new Error('HTML 표는 최대 20열까지 가져올 수 있습니다.');
                for (let y = index; y < index + height; y++) for (let x = column; x < column + width; x++) {
                    if (grid[y][x]) throw new Error('HTML 표의 병합 셀이 겹칩니다.');
                    grid[y][x] = true;
                }
                const rules = css(td), format = formatting(td, rules, ctx, warn);
                const runs = inlineRuns(td.children, format, depth + 1);
                const cellColor = color(rules['background-color'] ?? td.attribs.bgcolor);
                output.push({...(runs.length ? {runs} : {text: ''}), align: format.align,
                    ...(height > 1 && {rowSpan: height}), ...(width > 1 && {colSpan: width}), ...(cellColor && {cellColor})});
            }
            widths.push(grid[index].lastIndexOf(true) + 1);
            return output;
        });
        const width = Math.max(...widths);
        if (!width) return;
        for (const [index, row] of converted.entries()) {
            for (let j = 0; j < width; j++) if (!grid[index][j]) row.push('');
        }
        blocks.push({type: 'table', rows: converted, align: ctx.align});
    }

    function walk(nodes: Node[], ctx: Formatting, depth = 0) {
        if (depth > 120) throw new Error('HTML 문서의 구조가 너무 깊습니다.');
        const loose: Node[] = [];
        const flush = () => { if (loose.length) paragraph(loose.splice(0), ctx, depth); };
        for (const node of nodes) {
            if (!isTag(node)) { if (node.type === 'text') loose.push(node); continue; }
            const rules = css(node);
            if (hidden(node, rules)) continue;
            const format = formatting(node, rules, ctx, warn);
            if (!paragraphTags.has(node.name) && !containers.has(node.name) && !['blockquote','hr','table','ul','ol','img','center','html','body'].includes(node.name)) {
                loose.push(node); continue;
            }
            flush();
            if (node.name === 'table') table(node, format, depth);
            else if (node.name === 'hr') blocks.push({type: 'divider', align: format.align});
            else if (node.name === 'img') paragraph([node], ctx, depth);
            else if (node.name === 'blockquote') {
                const text = inlineRuns(node.children, format, depth).map((run) => run.text).join('').trim();
                if (text) blocks.push({type: 'quote', text, align: format.align});
            } else if (node.name === 'ul' || node.name === 'ol') {
                const start = Number(node.attribs.start) || 1;
                const items = node.children.filter(isTag).filter((item) => item.name === 'li');
                const runs = items.flatMap((item, index) => [{text: `${index ? '\n' : ''}${node.name === 'ol' ? `${start + index}. ` : '• '}`},
                    ...inlineRuns(item.children, format, depth + 1)]);
                if (runs.length) blocks.push({type: 'text', runs, align: format.align});
            } else if (paragraphTags.has(node.name)) paragraph(node.children, format, depth + 1);
            else walk(node.children, format, depth + 1);
        }
        flush();
    }

    walk((body ?? doc).children, initial);
    return {title: title ? DomUtils.textContent(title).trim() : undefined, blocks, assets, warnings: [...warnings]};
}
