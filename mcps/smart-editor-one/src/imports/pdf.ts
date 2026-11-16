import type {Block} from '../document.js';

export async function parsePdf(bytes: Buffer, range?: {from: number; to: number}) {
    const {getDocumentProxy} = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(bytes), {
        verbosity: 0, useSystemFonts: false, disableFontFace: true, useWasm: false, useWorkerFetch: false,
    });
    try {
        const from = range?.from ?? 1;
        const to = range?.to ?? pdf.numPages;
        if (from > to || to > pdf.numPages) throw new Error(`PDF 쪽 범위는 1~${pdf.numPages} 사이에서 지정하세요.`);
        if (to - from + 1 > 120) throw new Error('한 번에 최대 120쪽까지 처리할 수 있습니다. PDF 쪽 범위를 지정하세요.');
        const warnings = ['PDF는 텍스트를 가져옵니다. 원본 표, 그림, 다단 배치와 글자 서식은 별도로 확인하세요.'];
        const empty: number[] = [], pages: string[] = [];
        let length = 0;
        for (let first = from; first <= to; first += 4) {
            const batch = await Promise.all(Array.from({length: Math.min(to - first + 1, 4)}, async (_, index) => {
                const page = await pdf.getPage(first + index);
                try {
                    const {items} = await page.getTextContent();
                    return items.flatMap((item) => 'str' in item ? [item.str, ...(item.hasEOL ? ['\n'] : [])] : []).join('').trim();
                } finally { page.cleanup(); }
            }));
            for (const [index, text] of batch.entries()) {
                if (text) {
                    length += text.length + (pages.length ? 2 : 0);
                    if (length > 30_000) throw new Error('PDF 본문이 30,000자를 넘습니다. 가져올 쪽 범위를 줄이세요.');
                    pages.push(text);
                } else empty.push(first + index);
            }
        }
        if (!pages.length) throw new Error('PDF에서 선택 가능한 텍스트를 찾지 못했습니다. 스캔본은 먼저 OCR 처리해 주세요.');
        if (empty.length) warnings.push(`텍스트가 없는 PDF 쪽은 건너뛰었습니다 (${empty.join(', ')}쪽).`);
        const blocks: Block[] = [{type: 'text', runs: [{text: pages.join('\n\n')}]}];
        return {blocks, assets: new Map<string, Buffer>(), warnings};
    } finally {
        await pdf.loadingTask.destroy();
    }
}
