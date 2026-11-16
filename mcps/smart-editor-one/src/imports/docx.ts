import {posix} from 'node:path';
import type {Block, Run} from '../document.js';
import {internalTarget, withWordArchive} from './word-archive.js';
import {attr, child, descendants, type XmlNode} from './word-xml.js';
import {wordColor, wordStyles} from './word-styles.js';

type Image = Extract<Block, {type: 'image'}>;
type Table = Extract<Block, {type: 'table'}>;
type TableCell = Exclude<Table['rows'][number][number], string>;
type Inline = {run: Run} | {image: Image};
const maxPhotoBytes = 5 * 1024 * 1024;
const maxTotalPhotoBytes = 25 * 1024 * 1024;
const bodyWrappers = new Set(['sdt', 'sdtContent', 'customXml', 'ins']);

export function parseDocx(bytes: Buffer) {
    return withWordArchive(bytes, async (archive) => {
        const packageRelationships = await archive.relationships('');
        const locatePart = (type: string) => [...packageRelationships.values()].find((rel) => rel.type.endsWith(`/${type}`));
        const mainPath = internalTarget('', locatePart('officeDocument')) ?? 'word/document.xml';
        const corePath = internalTarget('', locatePart('core-properties')) ?? 'docProps/core.xml';
        const [main, relationships, core] = await Promise.all([archive.xml(mainPath), archive.relationships(mainPath), archive.xml(corePath)]);
        const body = child(main, 'body');
        if (!body) throw new Error('Word 본문을 찾지 못했습니다. 암호를 해제한 .docx 파일을 사용하세요.');

        const stylesRel = [...relationships.values()].find((rel) => rel.type.endsWith('/styles'));
        const warnings = new Set<string>();
        const warn = (message: string) => { warnings.add(message); };
        const styles = wordStyles(await archive.xml(internalTarget(mainPath, stylesRel) ?? posix.join(posix.dirname(mainPath), 'styles.xml')), warn);
        const images = new Map<string, string>();

        function imageBlock(node: XmlNode, align: Image['align']): Image | undefined {
            const picture = descendants(node, 'blip').next().value ?? descendants(node, 'imagedata').next().value;
            const id = attr(picture, 'embed') ?? attr(picture, 'id');
            const rel = id ? relationships.get(id) : undefined;
            if (!rel?.type.endsWith('/image')) {
                warn('일부 Word 그림은 로컬 이미지로 가져올 수 없습니다.');
                return;
            }
            const target = internalTarget(mainPath, rel);
            const extension = target && posix.extname(target).toLowerCase();
            if (!target || !extension || !['.jpg', '.jpeg', '.png', '.gif'].includes(extension)) {
                warn('외부 링크로 삽입했거나 JPG·PNG·GIF 형식이 아닌 그림은 첨부할 수 없습니다.');
                return;
            }
            if (!images.has(target)) images.set(target, `image-${images.size + 1}${extension}`);
            if (!descendants(node, 'anchor').next().done) warn('위치가 고정된 Word 그림은 본문 순서에 맞춰 삽입합니다.');
            if (!descendants(node, 'srcRect').next().done) warn('Word에서 잘라낸 그림은 원본 이미지로 들어갈 수 있습니다.');
            return {type: 'image', file: images.get(target)!, align};
        }

        function paragraph(node: XmlNode) {
            const {align, style} = styles.paragraph(child(node, 'pPr'));
            const items: Inline[] = [];
            let previousStyle = '';
            function addText(text: string, format: Omit<Run, 'text'>) {
                if (!text) return;
                const key = JSON.stringify(format);
                const previous = items.at(-1);
                if (key === previousStyle && previous && 'run' in previous) previous.run.text += text;
                else items.push({run: {text, ...format}});
                previousStyle = key;
            }
            function walk(item: XmlNode, format: Omit<Run, 'text'>) {
                switch (item.name) {
                    case 'pPr': case 'rPr': case 'instrText': return;
                    case 't': addText(item.text, format); return;
                    case 'tab': addText('\t', format); return;
                    case 'br': case 'cr':
                        if (attr(item, 'type') === 'page' || attr(item, 'type') === 'column') warn('페이지·단 나누기는 일반 줄바꿈으로 옮겼습니다.');
                        addText('\n', format); return;
                    case 'noBreakHyphen': addText('\u2011', format); return;
                    case 'softHyphen': addText('\u00ad', format); return;
                    case 'del': warn('변경 내용 추적은 삭제된 내용을 빼고 표시되는 본문을 옮깁니다.'); return;
                    case 'footnoteReference': case 'endnoteReference':
                        warn('각주와 미주는 본문으로 가져오지 않습니다.'); return;
                    case 'drawing': case 'pict': {
                        const image = imageBlock(item, align);
                        if (image) items.push({image});
                        return;
                    }
                    case 'object': case 'oMath':
                        warn('Word에 삽입된 개체나 수식은 별도로 확인해 주세요.'); return;
                    case 'r':
                        format = styles.run(child(item, 'rPr'), format);
                        break;
                    case 'hyperlink': {
                        const link = relationships.get(attr(item, 'id') ?? '');
                        const url = link?.external ? URL.parse(link.target) : undefined;
                        if (url?.protocol === 'http:' || url?.protocol === 'https:') format = {...format, link: url.href};
                        else warn('Word 문서 내부 링크는 표시 텍스트만 옮겼습니다.');
                        break;
                    }
                }
                for (const nested of item.children) walk(nested, format);
            }
            for (const item of node.children) walk(item, style);
            return {align, items};
        }

        function wordTable(node: XmlNode): Block[] {
            const rows: Table['rows'] = [], cellImages: Image[] = [];
            let active = new Map<number, TableCell>();
            const layout = attr(child(child(node, 'tblPr'), 'jc'));
            for (const tr of node.children.filter((item) => item.name === 'tr')) {
                const nextActive = new Map<number, TableCell>();
                const row: TableCell[] = [];
                const rowProperties = child(tr, 'trPr');
                const before = Number(attr(child(rowProperties, 'gridBefore')) ?? 0);
                const after = Number(attr(child(rowProperties, 'gridAfter')) ?? 0);
                if (![before, after].every((value) => Number.isInteger(value) && value >= 0 && value <= 20)) throw new Error('Word 표의 열 구성을 확인할 수 없습니다.');
                let column = before;
                for (let i = 0; i < before; i++) row.push({text: ''});
                for (const tc of tr.children.filter((item) => item.name === 'tc')) {
                    const props = child(tc, 'tcPr');
                    const span = Number(attr(child(props, 'gridSpan')) ?? 1);
                    if (!Number.isInteger(span) || span < 1 || column + span > 20) throw new Error('한 표에 최대 20열까지 가져올 수 있습니다.');
                    const vMerge = child(props, 'vMerge');
                    const p = [...descendants(tc, 'p')].map(paragraph);
                    if (p.some(({items}) => items.some((item) => 'image' in item))) warn('Word 표 안의 사진은 표 뒤에 넣었습니다.');
                    if (child(tc, 'tbl')) warn('Word 표 안의 하위 표는 셀 안의 텍스트로 옮겼습니다.');
                    const runs = p.flatMap(({items}, index) => [
                        ...(index ? [{text: '\n'}] : []), ...items.flatMap((item) => {
                            if ('run' in item) return [item.run];
                            cellImages.push(item.image);
                            return [];
                        }),
                    ]);
                    const visible = runs.some(({text}) => text.trim());
                    const color = wordColor(attr(child(props, 'shd'), 'fill'));
                    const continued = vMerge && attr(vMerge) !== 'restart' ? active.get(column) : undefined;
                    if (continued && (continued.colSpan ?? 1) === span) {
                        continued.rowSpan = (continued.rowSpan ?? 1) + 1;
                        nextActive.set(column, continued);
                        if (visible) {
                            const {text, runs: previous} = continued;
                            delete continued.text;
                            const prior = previous ?? (text ? [{text}] : []);
                            continued.runs = prior.length ? [...prior, {text: '\n'}, ...runs] : runs;
                        }
                    } else {
                        if (vMerge && attr(vMerge) !== 'restart') warn('Word 표의 일부 세로 병합은 그대로 옮기지 못했습니다.');
                        const cell = {
                            ...(runs.length ? {runs} : {text: ''}), ...(p[0] && {align: p[0].align}),
                            ...(span > 1 && {colSpan: span}), ...(color && {cellColor: color}),
                        };
                        row.push(cell);
                        if (vMerge) nextActive.set(column, cell);
                    }
                    column += span;
                }
                for (let i = 0; i < after; i++) row.push({text: ''});
                rows.push(row);
                active = nextActive;
            }
            const align = layout === 'left' || layout === 'center' || layout === 'right' ? layout : undefined;
            return [{type: 'table', rows, align}, ...cellImages];
        }

        const blocks: Block[] = [];
        function bodyItems(node: XmlNode) {
            for (const item of node.children) {
                if (item.name === 'p') {
                    const {items, align} = paragraph(item);
                    let runs: Run[] = [];
                    for (const entry of items) {
                        if ('run' in entry) runs.push(entry.run);
                        else {
                            if (runs.length) blocks.push({type: 'text', runs, align});
                            runs = [];
                            blocks.push(entry.image);
                        }
                    }
                    if (runs.length || !items.length) {
                        if (!runs.some(({text}) => text.trim())) runs = [...runs, {text: '\u200b'}];
                        blocks.push({type: 'text', runs, align});
                    }
                } else if (item.name === 'tbl') blocks.push(...wordTable(item));
                else if (bodyWrappers.has(item.name)) bodyItems(item);
                else if (item.name === 'sectPr') {
                    if (child(item, 'headerReference') || child(item, 'footerReference')) warn('머리글과 바닥글은 본문에 포함되지 않습니다.');
                } else if (item.name !== 'bookmarkStart' && item.name !== 'bookmarkEnd') {
                    warn('Word 본문의 일부 개체를 가져오지 못했습니다.');
                }
            }
        }
        bodyItems(body);
        if (blocks.filter(({type}) => type === 'image').length > 20) throw new Error('Word 사진은 한 원고에 최대 20장까지 가져올 수 있습니다.');
        const imageEntries = [...images];
        const imageBytes = imageEntries.reduce((total, [path]) => total + (archive.size(path) ?? 0), 0);
        if (imageBytes > maxTotalPhotoBytes) throw new Error('Word 사진의 전체 용량은 25 MiB 이하여야 합니다.');
        const assets = new Map<string, Buffer>();
        for (let i = 0; i < imageEntries.length; i += 4) {
            const batch = await Promise.allSettled(imageEntries.slice(i, i + 4).map(async ([path, file]) => {
                const asset = await archive.read(path, maxPhotoBytes);
                if (!asset?.length) throw new Error('Word 파일에 첨부된 사진을 읽지 못했습니다.');
                return [file, asset] as const;
            }));
            for (const result of batch) {
                if (result.status === 'rejected') throw result.reason;
                assets.set(...result.value);
            }
        }
        return {title: child(core, 'title')?.text.trim(), blocks, assets, warnings: [...warnings]};
    });
}
