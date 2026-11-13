import {Parser} from 'htmlparser2';

const lineTags = new Set(['div', 'p', 'li', 'blockquote', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'section']);
const hiddenTags = new Set(['head', 'script', 'style', 'template', 'noscript', 'svg', 'iframe']);

export function articleBodyText(html: string) {
    const parts: string[] = [];
    let hidden = 0;
    new Parser({
        onopentagname(name) {
            if (hiddenTags.has(name)) hidden++;
            if (!hidden && (lineTags.has(name) || name === 'br' || name === 'hr')) parts.push('\n');
        },
        onclosetag(name) {
            if (hiddenTags.has(name)) hidden--;
            if (hidden) return;
            if (lineTags.has(name)) parts.push('\n');
            if (name === 'td' || name === 'th') parts.push(' ');
        },
        ontext(value) {
            if (!hidden) parts.push(value.replace(/\s+/g, ' '));
        },
    }).end(html);

    return parts.join('').replace(/[\u200b\ufeff]/g, '').replace(/ +/g, ' ')
        .replace(/ *(\n *)+/g, '\n').trim();
}
