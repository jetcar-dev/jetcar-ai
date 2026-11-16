import {SaxesParser} from 'saxes';

export type XmlNode = {name: string; attributes: Record<string, string>; children: XmlNode[]; text: string; textParts?: (string | XmlNode)[]};

export const child = (node: XmlNode | undefined, name: string) => node?.children.find((item) => item.name === name);
export const attr = (node: XmlNode | undefined, name = 'val') => node?.attributes[name];

export function* descendants(node: XmlNode, name: string): Generator<XmlNode> {
    if (node.name === name) yield node;
    for (const item of node.children) yield* descendants(item, name);
}

export function parseWordXml(bytes: Buffer, mixedElement?: string) {
    const root: XmlNode = {name: '', attributes: {}, children: [], text: ''};
    const stack = [root];
    const parser = new SaxesParser({xmlns: true});
    parser.on('doctype', () => { throw new Error('Word 파일에 지원하지 않는 XML 선언이 있습니다.'); });
    parser.on('opentag', (tag) => {
        if (stack.length >= 160) throw new Error('Word 문서의 내부 구조가 너무 깊습니다.');
        const attributes = Object.fromEntries(Object.values(tag.attributes).map(({local, value}) => [local, value]));
        const item: XmlNode = {name: tag.local, attributes, children: [], text: ''};
        if (tag.local === mixedElement) item.textParts = [];
        const parent = stack.at(-1)!;
        parent.children.push(item);
        parent.textParts?.push(item);
        stack.push(item);
    });
    function appendText(text: string) {
        const node = stack.at(-1);
        if (!node?.name) return;
        node.text += text;
        node.textParts?.push(text);
    }
    parser.on('text', appendText);
    parser.on('cdata', appendText);
    parser.on('closetag', () => { stack.pop(); });
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
        : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    parser.write(new TextDecoder(encoding, {fatal: true}).decode(bytes)).close();
    return root.children[0];
}
