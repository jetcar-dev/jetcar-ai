export type CafeTarget = { cafeId: string; menuId: string };

const boardPath = /^\/(?:ca-fe\/(?:web\/)?|f-e\/)?cafes\/([1-9]\d*)\/menus\/([1-9]\d*)\/?$/i;
const cafeHosts = new Set(['cafe.naver.com', 'm.cafe.naver.com']);
const cafeKeys = ['search.clubid', 'clubid', 'cafeId'];
const menuKeys = ['search.menuid', 'menuid', 'menuId'];

function isCafeUrl(url: URL) {
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
        cafeHosts.has(url.hostname) && !url.username && !url.password && !url.port;
}

function uniqueId(values: string[]) {
    const [first] = values;
    return first && /^[1-9]\d*$/.test(first) && values.every((value) => value === first) ? first : undefined;
}

function targetFromLink(link: string): CafeTarget | undefined {
    const url = URL.parse(link);
    if (!url || !isCafeUrl(url)) return;

    const nestedLinks = url.searchParams.getAll('iframe_url');
    if (nestedLinks.length > 1) return;
    const urls = [url];
    if (nestedLinks.length === 1) {
        const nested = URL.parse(nestedLinks[0], url);
        if (!nested || !isCafeUrl(nested) || nested.searchParams.has('iframe_url')) return;
        urls.push(nested);
    }

    const cafeIds: string[] = [];
    const menuIds: string[] = [];
    for (const item of urls) {
        const path = boardPath.exec(item.pathname);
        if (path) {
            cafeIds.push(path[1]);
            menuIds.push(path[2]);
        }
        cafeIds.push(...cafeKeys.flatMap((key) => item.searchParams.getAll(key)));
        menuIds.push(...menuKeys.flatMap((key) => item.searchParams.getAll(key)));
    }
    const cafeId = uniqueId(cafeIds);
    const menuId = uniqueId(menuIds);
    if (cafeId && menuId) return {cafeId, menuId};
}

export function resolveCafeTarget(boardUrl?: string): CafeTarget | undefined {
    const link = boardUrl ?? process.env.NAVER_BOARD_URL?.trim();
    if (link) return targetFromLink(link);

    const cafeId = process.env.NAVER_CAFE_ID?.trim();
    const menuId = process.env.NAVER_MENU_ID?.trim();
    if (cafeId && menuId && uniqueId([cafeId]) && uniqueId([menuId])) return {cafeId, menuId};
}

export function cafeBoardUrl({cafeId, menuId}: CafeTarget) {
    return `https://cafe.naver.com/ca-fe/web/cafes/${cafeId}/menus/${menuId}`;
}
