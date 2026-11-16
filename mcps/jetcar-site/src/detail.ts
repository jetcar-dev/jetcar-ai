import {parseDocument, DomUtils} from 'htmlparser2';
import {parseVehicleUrl, requestJetcar} from './site.js';

type Node = ReturnType<typeof parseDocument>['children'][number];
type Tag = Extract<Node, {attribs: Record<string, string>}>;
const isTag = (n: Node): n is Tag => 'attribs' in n;
const hasClass = (n: Tag, cls: string) => (n.attribs.class ?? '').split(/\s+/).includes(cls);
const all = (n: Node, pred: (x: Tag) => boolean): Tag[] => DomUtils.findAll((x): x is Tag => isTag(x) && pred(x), [n]);
const first = (n: Node, pred: (x: Tag) => boolean) => DomUtils.findOne(pred, [n]) ?? undefined;
const byClass = (n: Node, cls: string) => first(n, x => hasClass(x, cls));
const clean = (n?: Node) => n ? DomUtils.textContent(n).replace(/\s+/g, ' ').trim() : '';
const tags = (n: Node, name: string) => all(n, x => x.name === name);
const textTags = (n: Node, name: string) => tags(n, name).map(clean);
const absolute = (value: string) => new URL(value, 'https://jetcar.co.kr').href;

function pairedTables(root?: Node) {
    const result: Record<string, string> = {};
    if (!root) return result;
    for (const table of tags(root, 'table')) {
        const headers = textTags(table, 'th');
        const values = textTags(table, 'td');
        headers.forEach((key, i) => { if (key && values[i]) result[key] = values[i]; });
    }
    return result;
}

/** Reads the public, server-rendered vehicle page; monetary values remain as displayed. */
export async function getVehicleDetail(vehicleUrl: string, signal?: AbortSignal) {
    const vehicle = parseVehicleUrl(vehicleUrl);
    const response = await requestJetcar(vehicle.url, {signal});
    const html = await response.text();
    const doc = parseDocument(html);
    const top = byClass(doc, 'view-top');
    if (!top) {
        const alert = /alert\s*\(\s*["']([^"']+)/.exec(html)?.[1]?.replace(/\\n/g, ' ').trim();
        if (alert?.includes('존재하지 않습니다') || alert?.includes('삭제되었거나 이동')) throw new Error(`차량을 찾을 수 없습니다: ${alert}`);
        if (alert) throw new Error(`차량에 접근할 수 없습니다: ${alert}`);
        throw new Error('차량 상세를 확인할 수 없습니다. 페이지 구조 또는 공개 상태를 확인하세요.');
    }
    const title = clean(byClass(top, 'title'));
    if (!title) throw new Error('차량 상세 제목을 확인할 수 없습니다.');
    const info = all(top, x => hasClass(x, 'info-item')).map(clean).filter(Boolean);
    const gallery = first(doc, x => x.attribs.id === 'thumbs');
    const images = gallery ? all(gallery, x => x.name === 'a' && hasClass(x, 'thumb') && !!x.attribs.href).map(x => {
        const thumbnail = first(x, n => n.name === 'img' && !!n.attribs.src)?.attribs.src;
        return {url: absolute(x.attribs.href), thumbnailUrl: thumbnail ? absolute(thumbnail) : undefined};
    }) : [];
    const priceSection = byClass(doc, 'd1');
    const quote = byClass(doc, 'rent-quote-wrap');
    const table = quote ? byClass(quote, 'rent-quote-table') : priceSection && first(priceSection, x => x.name === 'table');
    const prices = table ? tags(table, 'tr').map(row => textTags(row, 'td')).filter(row => row.length >= 3 && row.some(Boolean)).map(row => ({
        deposit: row[0], period: row[1], monthlyRent: row[2], mileage: row[3] || undefined, additional: row.slice(4).filter(Boolean),
    })) : [];
    const priceNotes = quote ? all(quote, x => hasClass(x, 'rent-quote-desc')).map(clean) : priceSection ? all(priceSection, x => hasClass(x, 'cap')).map(clean) : [];
    const quoteOptions = quote ? all(quote, x => hasClass(x, 'rent-quote-row')).map(row => ({
        label: clean(byClass(row, 'rent-quote-title')),
        choices: all(row, x => hasClass(x, 'rent-quote-input')).map(choice => {
            const input = first(choice, x => x.name === 'input');
            const adjustment = Number(input?.attribs['data-eff']);
            return {label: clean(first(choice, x => x.name === 'label')),
                monthlyAdjustmentWon: Number.isFinite(adjustment) ? adjustment : undefined,
                selected: !!input && Object.hasOwn(input.attribs, 'checked')};
        }).filter(choice => choice.label),
        displayedDepositManwon: first(row, x => x.name === 'input' && x.attribs.id === 'deposit')?.attribs.value,
    })).filter(row => row.label) : [];
    const optionsRoot = byClass(doc, 'd3');
    const pc = optionsRoot && byClass(optionsRoot, 'pc_ver');
    const options: Record<string, string[]> = {};
    if (pc) {
        const headers = textTags(pc, 'th');
        const cells = tags(pc, 'td');
        headers.forEach((header, i) => { if (header && cells[i]) options[header] = textTags(cells[i], 'li').filter(Boolean); });
    }
    const contractRoot = byClass(doc, 'contract-ul');
    const contract: Record<string, string> = {};
    if (contractRoot) for (const li of tags(contractRoot, 'li')) {
        const right = byClass(li, 'right');
        if (!right) continue;
        const key = clean(first(right, x => x.name === 'span'));
        const value = clean(first(right, x => x.name === 'p'));
        if (key && value) contract[key] = value;
    }
    const insurance = byClass(doc, 'd5');
    const insuranceSections = insurance ? all(insurance, x => hasClass(x, 'tt')).map(section => ({
        title: clean(first(section, x => x.name === 'h3')),
        values: pairedTables(section),
        notes: textTags(section, 'p').filter(Boolean),
        driverScope: tags(section, 'li').map(li => ({label: clean(first(li, x => x.name === 'h4')), value: clean(first(li, x => x.name === 'span'))})).filter(item => item.label || item.value),
    })) : [];
    return {...vehicle, title, additionalInfo: info,
        images, currency: 'KRW', prices, priceHeaders: table ? textTags(table, 'th') : [], priceNotes, quoteOptions,
        keyInformation: pairedTables(byClass(doc, 'd2')), options, contract, insurance: insuranceSections,
        notice: '표시된 가격과 조건은 조회 시점의 기본 조건이며, 선택 조건 및 실제 계약에 따라 달라질 수 있습니다.'};
}
