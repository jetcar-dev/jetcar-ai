import {parse} from 'csv-parse/sync';
import type {Block, Run} from '../document.js';
import {internalTarget, withWordArchive} from './word-archive.js';
import {attr, child, type XmlNode} from './word-xml.js';

type Table = Extract<Block, {type: 'table'}>;
type Cell = Table['rows'][number][number];
type CellStyle = Omit<Exclude<Cell, string>, 'text' | 'runs' | 'rowSpan' | 'colSpan'>;
type Position = {row: number; column: number};
type Merge = {first: Position; last: Position};
type Rows = Map<number, Map<number, Cell>>;
type CellContent = Pick<Exclude<Cell, string>, 'text' | 'runs'>;
type TabularDocument = {title?: string; blocks: Block[]; assets: Map<string, Buffer>; warnings: string[]};

const rowsPerTable = 30;
const columnsPerTable = 20;
const maxTables = 100;

function tableBlocks(height: number, width: number, cellAt: (row: number, column: number) => Cell | undefined,
    merges: Merge[], warnings: Set<string>,
): Table[] {
    if (!height || !width) return [];
    const rowPanels = Math.ceil(height / rowsPerTable);
    const columnPanels = Math.ceil(width / columnsPerTable);
    if (rowPanels * columnPanels > maxTables) {
        throw new Error('표가 스마트에디터 본문 한도를 초과합니다. 가져올 행이나 열을 줄여 주세요.');
    }
    if (rowPanels > 1 || columnPanels > 1) {
        warnings.add('원본 표를 스마트에디터의 표 크기 한도(행 30개, 열 20개)에 맞춰 나눴습니다.');
    }

    const anchors = new Map<number, Merge>();
    const covered = new Set<number>();
    for (const merge of merges) {
        const {first, last} = merge;
        if (Math.floor(first.row / rowsPerTable) !== Math.floor(last.row / rowsPerTable)
            || Math.floor(first.column / columnsPerTable) !== Math.floor(last.column / columnsPerTable)) {
            warnings.add('나뉜 표의 경계를 가로지르는 셀 병합을 풀고 원래 위치에 값을 옮겼습니다.');
            continue;
        }
        const anchor = first.row * width + first.column;
        const cells: number[] = [];
        let conflict = false;
        for (let row = first.row; row <= last.row; row++) {
            for (let column = first.column; column <= last.column; column++) {
                const key = row * width + column;
                if (covered.has(key) || anchors.has(key)) conflict = true;
                if (key === anchor) continue;
                const cell = cellAt(row, column);
                if (typeof cell === 'string' ? cell !== '' : !!(cell?.text || cell?.runs?.length)) conflict = true;
                cells.push(key);
            }
        }
        if (conflict) {
            warnings.add('다른 셀과 겹치는 병합을 풀어 원래 위치에 값을 옮겼습니다.');
            continue;
        }
        anchors.set(anchor, merge);
        for (const cell of cells) covered.add(cell);
    }

    const blocks: Table[] = [];
    for (let rowStart = 0; rowStart < height; rowStart += rowsPerTable) {
        for (let columnStart = 0; columnStart < width; columnStart += columnsPerTable) {
            const tableRows: Cell[][] = [];
            for (let row = rowStart; row < Math.min(height, rowStart + rowsPerTable); row++) {
                const cells: Cell[] = [];
                for (let column = columnStart; column < Math.min(width, columnStart + columnsPerTable); column++) {
                    const key = row * width + column;
                    if (covered.has(key)) continue;
                    const value = cellAt(row, column) ?? '';
                    const merge = anchors.get(key);
                    cells.push(merge ? {
                        ...(typeof value === 'string' ? {text: value} : value),
                        rowSpan: merge.last.row - row + 1,
                        colSpan: merge.last.column - column + 1,
                    } : value);
                }
                tableRows.push(cells);
            }
            blocks.push({type: 'table', rows: tableRows});
        }
    }
    return blocks;
}

export function parseCsv(source: string, {delimiter = ','}: {delimiter?: ',' | ';' | '\t'} = {}): TabularDocument {
    let records: string[][];
    try {
        records = parse(source, {bom: true, delimiter, relax_column_count: true});
    } catch (error) {
        throw new Error('CSV 파일을 읽지 못했습니다. 구분 기호와 큰따옴표를 확인하세요.', {cause: error});
    }
    const warnings = new Set<string>();
    const width = records.reduce((maximum, record) => Math.max(maximum, record.length), 0);
    const blocks = tableBlocks(records.length, width, (row, column) => records[row][column], [], warnings);
    if (!blocks.length) throw new Error('CSV 파일에 가져올 데이터가 없습니다.');
    return {blocks, assets: new Map<string, Buffer>(), warnings: [...warnings]};
}

function cellPosition(reference: string): Position {
    const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/i.exec(reference);
    if (!match) throw new Error(`XLSX 셀 주소를 읽을 수 없습니다. (${reference})`);
    const column = [...match[1].toUpperCase()].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
    const row = Number(match[2]) - 1;
    if (column >= 16_384 || row >= 1_048_576) throw new Error(`XLSX 셀 주소가 범위를 벗어났습니다. (${reference})`);
    return {row, column};
}

function spreadsheetText(text: string) {
    return text.replace(/_x([0-9A-Fa-f]{4})_/g, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)));
}

function rgb(node: XmlNode | undefined) {
    const value = attr(node, 'rgb');
    if (value && /^(?:[0-9a-f]{2})?[0-9a-f]{6}$/i.test(value)) return `#${value.slice(-6)}`;
}

function fontStyle(node: XmlNode | undefined): Omit<Run, 'text'> {
    const style: Omit<Run, 'text'> = {};
    for (const [tag, key] of [['b', 'bold'], ['i', 'italic'], ['u', 'underline'], ['strike', 'strikeThrough']] as const) {
        const property = child(node, tag);
        if (property) style[key] = !['0', 'false', 'none'].includes(attr(property) ?? '');
    }
    const size = Math.round(Number(attr(child(node, 'sz'))));
    if (size >= 10 && size <= 40) style.fontSize = size;
    const color = rgb(child(node, 'color'));
    if (color) style.fontColor = color;
    return style;
}

function cellFormats(styles: XmlNode | undefined) {
    const fonts = child(styles, 'fonts')?.children.filter(({name}) => name === 'font').map(fontStyle) ?? [];
    const fills = child(styles, 'fills')?.children.filter(({name}) => name === 'fill') ?? [];
    const parents = child(styles, 'cellStyleXfs')?.children.filter(({name}) => name === 'xf') ?? [];
    return child(styles, 'cellXfs')?.children.filter(({name}) => name === 'xf').map((format) => {
        const parent = parents[Number(attr(format, 'xfId') ?? 0)];
        const formatId = (id: string, flag: string) => Number((attr(format, flag) === '0' || attr(format, flag) === 'false'
            ? attr(parent, id) : attr(format, id) ?? attr(parent, id)) ?? 0);
        const style: CellStyle = {...fonts[formatId('fontId', 'applyFont')]};
        const fill = child(fills[formatId('fillId', 'applyFill')], 'patternFill');
        const color = attr(fill, 'patternType') === 'solid' ? rgb(child(fill, 'fgColor')) : undefined;
        if (color) style.cellColor = color;
        const applyAlignment = attr(format, 'applyAlignment');
        const alignment = applyAlignment === '0' || applyAlignment === 'false' ? child(parent, 'alignment')
            : child(format, 'alignment') ?? child(parent, 'alignment');
        const align = attr(alignment, 'horizontal');
        if (align === 'left' || align === 'center' || align === 'right') style.align = align;
        return {style, numFmtId: formatId('numFmtId', 'applyNumberFormat')};
    }) ?? [];
}

function richText(node: XmlNode | undefined, warnings: Set<string>): CellContent {
    const runs: Run[] = [];
    for (const item of node?.children ?? []) {
        const value = item.name === 't' ? item : item.name === 'r' ? child(item, 't') : undefined;
        if (value?.text) runs.push({text: spreadsheetText(value.text), ...fontStyle(child(item, 'rPr'))});
    }
    if (runs.some((run) => Object.keys(run).length > 1)) {
        if (runs.length <= 200) return {runs};
        warnings.add('셀 하나의 글자 서식 구간이 한도를 초과해 해당 셀의 텍스트만 옮겼습니다.');
    }
    return {text: runs.map(({text}) => text).join('')};
}

export function parseXlsx(bytes: Buffer, {sheet: selection}: {sheet?: string} = {}): Promise<TabularDocument> {
    return withWordArchive(bytes, async (archive) => {
        const warnings = new Set<string>();
        const packageRels = await archive.relationships('');
        const workbookRel = [...packageRels.values()].find((rel) => rel.type.endsWith('/officeDocument'));
        const workbookPath = internalTarget('', workbookRel) ?? 'xl/workbook.xml';
        const [workbook, relationships] = await Promise.all([archive.xml(workbookPath), archive.relationships(workbookPath)]);
        if (workbook?.name !== 'workbook') throw new Error('XLSX 통합 문서를 읽지 못했습니다.');
        const locate = (kind: string) => internalTarget(workbookPath, [...relationships.values()].find((rel) => rel.type.endsWith(`/${kind}`)));
        const worksheets = (child(workbook, 'sheets')?.children ?? []).flatMap((sheet) => {
            const rel = relationships.get(attr(sheet, 'id') ?? '');
            const path = rel?.type.endsWith('/worksheet') ? internalTarget(workbookPath, rel) : undefined;
            const name = attr(sheet, 'name');
            return path && name ? [{path, name, state: attr(sheet, 'state') ?? 'visible'}] : [];
        });
        const sheet = selection === undefined ? worksheets.find(({state}) => state === 'visible')
            : worksheets.find(({name}) => name.toLowerCase() === selection.toLowerCase());
        if (!sheet) throw new Error(selection === undefined ? 'XLSX 파일에 표시된 워크시트가 없습니다.'
            : `XLSX 파일에 지정한 워크시트가 없습니다. (${selection})`);

        const sharedPath = locate('sharedStrings');
        const stylesPath = locate('styles');
        const [worksheet, sharedStrings, styles] = await Promise.all([
            archive.xml(sheet.path), sharedPath && archive.xml(sharedPath), stylesPath && archive.xml(stylesPath),
        ]);
        const sheetData = child(worksheet, 'sheetData');
        if (worksheet?.name !== 'worksheet' || !sheetData) throw new Error('XLSX 워크시트 데이터를 읽지 못했습니다.');
        const strings = (sharedStrings || undefined)?.children.filter(({name}) => name === 'si') ?? [];
        const sharedContent = new Map<number, CellContent>();
        const formats = cellFormats(styles || undefined);
        if (worksheet.children.some(({name}) => ['drawing', 'legacyDrawing', 'conditionalFormatting', 'tableParts'].includes(name))) {
            warnings.add('워크시트의 그림·차트·조건부 서식·표 디자인은 스마트에디터 표에 옮기지 못할 수 있습니다.');
        }

        const rows: Rows = new Map();
        let height = 0;
        let width = 0;
        let nextRow = 0;
        for (const row of sheetData.children.filter(({name}) => name === 'row')) {
            const cells = row.children.filter(({name}) => name === 'c');
            const rowReference = attr(row, 'r');
            const firstCellReference = attr(cells[0], 'r');
            const rowNumber = rowReference !== undefined ? Number(rowReference) - 1
                : firstCellReference ? cellPosition(firstCellReference).row : nextRow;
            if (!Number.isInteger(rowNumber) || rowNumber < 0 || rowNumber >= 1_048_576) throw new Error('XLSX 행 번호가 범위를 벗어났습니다.');
            nextRow = rowNumber + 1;
            let nextColumn = 0;
            for (const cell of cells) {
                const reference = attr(cell, 'r');
                const position = reference ? cellPosition(reference) : {row: rowNumber, column: nextColumn};
                if (position.column >= 16_384) throw new Error('XLSX 열 번호가 범위를 벗어났습니다.');
                nextColumn = position.column + 1;
                const value = child(cell, 'v')?.text;
                const formula = child(cell, 'f');
                const inline = child(cell, 'is');
                const type = attr(cell, 't');
                const format = formats[Number(attr(cell, 's') ?? 0)];
                const style = format?.style;
                const hasContent = value !== undefined || !!formula || !!inline;
                if (!hasContent && !style?.cellColor) continue;
                let content: CellContent;
                if (!hasContent) {
                    content = {text: ''};
                } else if (formula && !value && (type !== 'str' || value === undefined)) {
                    warnings.add('저장된 결과가 없는 수식은 확인할 수 있는 수식 텍스트로 옮겼습니다.');
                    content = {text: formula.text ? `=${formula.text}` : ''};
                } else if (type === 'inlineStr') {
                    content = richText(inline, warnings);
                } else if (type === 's') {
                    const index = value && /^\d+$/.test(value) ? Number(value) : -1;
                    const entry = strings[index];
                    if (!entry) throw new Error(`XLSX 공유 문자열을 찾지 못했습니다. (${reference ?? value ?? ''})`);
                    content = sharedContent.get(index) ?? richText(entry, warnings);
                    sharedContent.set(index, content);
                } else if (type === 'b') {
                    content = {text: value === '1' || value === 'true' ? 'TRUE' : value === '0' || value === 'false' ? 'FALSE' : value};
                } else {
                    if (value && (!type || type === 'n') && format?.numFmtId) {
                        warnings.add('날짜, 통화 등 셀에 지정된 숫자 표시 형식은 저장된 원시 값으로 옮겼습니다.');
                    }
                    content = {text: spreadsheetText(value ?? '')};
                }
                const data = content.runs || (style && Object.keys(style).length) ? {...content, ...style} : content.text ?? '';
                const target = rows.get(position.row) ?? new Map<number, Cell>();
                if (target.has(position.column)) throw new Error(`XLSX 셀 주소가 중복됩니다. (${reference ?? ''})`);
                target.set(position.column, data);
                rows.set(position.row, target);
                if (hasContent) {
                    // A fill on an empty cell should not expand the worksheet's imported data range.
                    height = Math.max(height, position.row + 1);
                    width = Math.max(width, position.column + 1);
                }
            }
        }

        const merges: Merge[] = [];
        for (const merge of child(worksheet, 'mergeCells')?.children ?? []) {
            const range = attr(merge, 'ref');
            if (!range) continue;
            const [start, end = start, invalid] = range.split(':');
            const first = cellPosition(start), last = cellPosition(end);
            if (invalid !== undefined || first.row > last.row || first.column > last.column) {
                throw new Error(`XLSX 셀 병합 범위를 읽을 수 없습니다. (${range})`);
            }
            merges.push({first, last});
            height = Math.max(height, last.row + 1);
            width = Math.max(width, last.column + 1);
        }
        const blocks = tableBlocks(height, width, (row, column) => rows.get(row)?.get(column), merges, warnings);
        if (!blocks.length) throw new Error(`XLSX 워크시트에 가져올 데이터가 없습니다. (${sheet.name})`);
        return {blocks, assets: new Map<string, Buffer>(), warnings: [...warnings]};
    });
}
