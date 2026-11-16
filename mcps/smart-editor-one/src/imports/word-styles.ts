import type {Run} from '../document.js';
import {attr, child, type XmlNode} from './word-xml.js';

type Style = Omit<Run, 'text'>;
type Alignment = 'left' | 'center' | 'right';

const fontNames = new Map<string, NonNullable<Style['fontFamily']>>([
    ['나눔고딕', 'nanumgothic'], ['nanumgothic', 'nanumgothic'], ['나눔명조', 'nanummyeongjo'], ['nanummyeongjo', 'nanummyeongjo'],
    ['나눔바른고딕', 'nanumbarungothic'], ['nanumbarungothic', 'nanumbarungothic'], ['나눔스퀘어', 'nanumsquare'], ['nanumsquare', 'nanumsquare'],
    ['마루부리', 'nanummaruburi'], ['maruburi', 'nanummaruburi'], ['나눔마루부리', 'nanummaruburi'],
]);
const highlightColors: Record<string, string> = {
    black: '#000000', blue: '#0000FF', cyan: '#00FFFF', green: '#00FF00', magenta: '#FF00FF', red: '#FF0000', yellow: '#FFFF00',
    white: '#FFFFFF', darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000',
    darkYellow: '#808000', darkGray: '#808080', lightGray: '#C0C0C0',
};

export const wordColor = (value: string | undefined) => value && /^[a-fA-F0-9]{6}$/.test(value) ? `#${value}` : undefined;

function toggle(node: XmlNode | undefined) {
    if (node) return !['0', 'false', 'off', 'none'].includes(attr(node) ?? '');
}

export function wordStyles(root: XmlNode | undefined, warn: (message: string) => void) {
    const defaults = child(root, 'docDefaults');
    const styles = new Map((root?.children ?? []).flatMap((node) => {
        const id = attr(node, 'styleId');
        return node.name === 'style' && id ? [[id, node] as const] : [];
    }));
    const defaultParagraph = [...styles.values()].find((node) => attr(node, 'type') === 'paragraph' && attr(node, 'default') === '1');
    const chains = new Map<string, XmlNode[]>();
    function styleChain(id: string | undefined) {
        if (!id) return [];
        if (chains.has(id)) return chains.get(id)!;
        const chain: XmlNode[] = [], seen = new Set<XmlNode>();
        let current = styles.get(id);
        while (current && !seen.has(current)) {
            seen.add(current);
            chain.unshift(current);
            current = styles.get(attr(child(current, 'basedOn')) ?? '');
        }
        chains.set(id, chain);
        return chain;
    }

    function runProps(rPr: XmlNode | undefined): Style {
        const result: Style = {};
        const properties = [['b', 'bold'], ['i', 'italic'], ['u', 'underline'], ['strike', 'strikeThrough']] as const;
        for (const [tag, field] of properties) {
            const state = toggle(child(rPr, tag));
            if (state !== undefined) result[field] = state;
        }
        if (toggle(child(rPr, 'dstrike'))) result.strikeThrough = true;
        const size = Number(attr(child(rPr, 'sz')));
        if (Number.isFinite(size) && size > 0) {
            const pixels = Math.round(size * 2 / 3);
            result.fontSize = Math.min(40, Math.max(10, pixels));
            if (result.fontSize !== pixels) warn('10~40px 범위를 벗어나는 글자 크기를 범위 안으로 조정했습니다.');
        }
        const font = child(rPr, 'rFonts');
        const name = attr(font, 'eastAsia') ?? attr(font, 'ascii') ?? attr(font, 'hAnsi');
        if (name) {
            result.fontFamily = fontNames.get(name.replace(/\s/g, '').toLowerCase()) ?? 'system';
            if (result.fontFamily === 'system') warn('스마트에디터에 없는 Word 글꼴은 기본 글꼴로 표시됩니다.');
        }
        const color = child(rPr, 'color');
        const foreground = wordColor(attr(color));
        const background = highlightColors[attr(child(rPr, 'highlight')) ?? ''] ?? wordColor(attr(child(rPr, 'shd'), 'fill'));
        if (foreground) result.fontColor = foreground;
        if (background) result.backgroundColor = background;
        if (!foreground && attr(color, 'themeColor')) warn('일부 Word 테마 색상은 기본 색상으로 표시됩니다.');
        if (child(rPr, 'vertAlign') || child(rPr, 'spacing') || child(rPr, 'bdr')) {
            warn('위·아래 첨자, 글자 간격, 테두리 등 일부 Word 글자 서식은 적용되지 않습니다.');
        }
        return result;
    }

    function paragraph(pPr: XmlNode | undefined) {
        const id = attr(child(pPr, 'pStyle')) ?? attr(defaultParagraph, 'styleId');
        const chain = styleChain(id);
        const paragraphProps = [child(child(defaults, 'pPrDefault'), 'pPr'), ...chain.map((item) => child(item, 'pPr')), pPr];
        const mark = paragraphProps.findLast((item) => !!child(item, 'jc'));
        const alignment = attr(child(mark, 'jc'));
        const align: Alignment = alignment === 'center' ? 'center' : alignment === 'right' || alignment === 'end' ? 'right' : 'left';
        if (alignment && !['left', 'start', 'center', 'right', 'end'].includes(alignment)) warn('양쪽 맞춤 등 지원하지 않는 정렬은 왼쪽으로 표시됩니다.');
        if (paragraphProps.some((item) => child(item, 'numPr') && attr(child(child(item, 'numPr'), 'numId')) !== '0')) {
            warn('Word의 자동 목록 번호나 글머리 기호는 원문 텍스트와 별도로 확인해 주세요.');
        }
        if (pPr && ['ind', 'pageBreakBefore', 'tabs', 'pBdr'].some((name) => child(pPr, name))) {
            warn('Word 문단의 들여쓰기, 탭 위치, 테두리나 페이지 배치가 달라질 수 있습니다.');
        }
        const style = Object.assign({}, runProps(child(child(defaults, 'rPrDefault'), 'rPr')),
            ...chain.map((item) => runProps(child(item, 'rPr')))) as Style;
        return {align, style};
    }

    function run(rPr: XmlNode | undefined, base: Style) {
        const chain = styleChain(attr(child(rPr, 'rStyle')));
        return Object.assign({}, base, ...chain.map((item) => runProps(child(item, 'rPr'))), runProps(rPr)) as Style;
    }

    return {paragraph, run};
}
