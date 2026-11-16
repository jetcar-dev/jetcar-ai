import {Lexer, type Token, type Tokens} from 'marked';
import type {Block, Run} from './document.js';

type TextStyle = Omit<Run, 'text'>;

function inlineRuns(tokens: Token[], style: TextStyle = {}): Run[] {
    return tokens.flatMap((token): Run[] => {
        if (token.type === 'strong') return inlineRuns((token as Tokens.Strong).tokens, {...style, bold: true});
        if (token.type === 'em') return inlineRuns((token as Tokens.Em).tokens, {...style, italic: true});
        if (token.type === 'del') return inlineRuns((token as Tokens.Del).tokens, {...style, strikeThrough: true});
        if (token.type === 'link') {
            const link = token as Tokens.Link;
            const url = URL.parse(link.href);
            if (url?.protocol === 'http:' || url?.protocol === 'https:') {
                return inlineRuns(link.tokens, {...style, link: url.href});
            }
        }
        if (token.type === 'text') {
            const text = token as Tokens.Text;
            if (text.tokens) return inlineRuns(text.tokens, style);
        }
        const text = token.type === 'br' ? '\n'
            : token.type === 'text' || token.type === 'escape' || token.type === 'codespan'
                ? (token as Tokens.Text | Tokens.Escape | Tokens.Codespan).text : token.raw;
        return text ? [{text, ...style}] : [];
    });
}

function headingSize(depth: number) {
    return [24, 22, 20, 18, 16, 16][depth - 1];
}

function localImage(token: Tokens.Image): Block | undefined {
    if (!/^[^\x00-\x1f\\/:*?"<>|]+\.(?:jpe?g|png|gif)$/i.test(token.href)) return;
    return {type: 'image', file: token.href, ...(token.text.trim() && {caption: token.text})};
}

export function sourceBlocks(source: string, format: 'text' | 'markdown'): Block[] {
    if (format === 'text') return [{type: 'text', runs: [{text: source}]}];

    const blocks: Block[] = [];
    let pendingBlankLines = 0;
    let previousTrailingLines = 0;
    for (const token of Lexer.lex(source, {gfm: true})) {
        if (token.type === 'space') {
            const lines = (token.raw.match(/\n/g) ?? []).length;
            pendingBlankLines += lines;
            continue;
        }
        let block: Block;
        switch (token.type) {
            case 'heading': {
                const {depth, tokens} = token as Tokens.Heading;
                block = {type: 'text', runs: inlineRuns(tokens, {bold: true, fontSize: headingSize(depth)})};
                break;
            }
            case 'paragraph': {
                const {tokens} = token as Tokens.Paragraph;
                const image = tokens.length === 1 && tokens[0].type === 'image' ? localImage(tokens[0] as Tokens.Image) : undefined;
                block = image ?? {type: 'text', runs: inlineRuns(tokens)};
                break;
            }
            case 'table': {
                const {header, rows} = token as Tokens.Table;
                block = {type: 'table', rows: [header, ...rows].map((row) => row.map(({tokens, align, header}) => {
                    const runs = inlineRuns(tokens, header ? {bold: true} : undefined);
                    return { ...(runs.length ? {runs} : {text: ''}), ...(align && {align}) };
                }))};
                break;
            }
            case 'blockquote':
                block = {type: 'quote', text: (token as Tokens.Blockquote).text};
                break;
            case 'hr':
                block = {type: 'divider'};
                break;
            case 'def':
                continue;
            default:
                block = {type: 'text', runs: [{text: token.raw.trimEnd()}]};
        }

        if (block.type === 'text' && blocks.at(-1)?.type === 'text') {
            const blankLines = Math.max(0, previousTrailingLines + pendingBlankLines - 1);
            if (blankLines) blocks.push({type: 'text', text: '\u200b' + '\n\u200b'.repeat(blankLines - 1)});
        }
        pendingBlankLines = 0;
        previousTrailingLines = token.raw.match(/\n+$/)?.[0].length ?? 0;
        blocks.push(block);
    }
    return blocks;
}
