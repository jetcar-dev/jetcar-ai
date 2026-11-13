export type CafeTarget = { cafeId: string; menuId: string };

const boardPath = /^\/(?:ca-fe\/(?:web\/)?|f-e\/)?cafes\/([1-9]\d*)\/menus\/([1-9]\d*)\/?$/i;
const cafePath = /^\/(?:ca-fe\/(?:web\/)?|f-e\/)?cafes\/([1-9]\d*)(?:\/|$)/i;
const cafeHosts = new Set(['cafe.naver.com', 'm.cafe.naver.com']);
const cafeKeys = ['search.clubid', 'clubid', 'cafeId'];
const menuKeys = ['search.menuid', 'menuid', 'menuId'];
const iframeKeys = ['iframe_url', 'iframe_url_utf8'];

function isCafeUrl(url: URL) {
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
        cafeHosts.has(url.hostname) && !url.username && !url.password && !url.port;
}

function uniqueId(values: string[]) {
    const [first] = values;
    return first && /^[1-9]\d*$/.test(first) && values.every((value) => value === first) ? first : undefined;
}

function idsFromLink(link: string, includeCafePaths = false) {
    const url = URL.parse(link);
    if (!url || !isCafeUrl(url)) return;

    const nestedLinks = iframeKeys.flatMap((key) => url.searchParams.getAll(key));
    if (nestedLinks.length > 1) return;
    const urls = [url];
    if (nestedLinks.length === 1) {
        let nestedLink = nestedLinks[0];
        if (!nestedLink.includes('?') && /%3f/i.test(nestedLink)) {
            try {
                nestedLink = decodeURIComponent(nestedLink);
            } catch {
                return;
            }
        }
        const nested = URL.parse(nestedLink, url);
        if (!nested || !isCafeUrl(nested) || iframeKeys.some((key) => nested.searchParams.has(key))) return;
        urls.push(nested);
    }

    const cafeIds: string[] = [];
    const menuIds: string[] = [];
    for (const item of urls) {
        const board = boardPath.exec(item.pathname);
        const path = includeCafePaths ? cafePath.exec(item.pathname) : board;
        if (path) cafeIds.push(path[1]);
        if (board) menuIds.push(board[2]);
        cafeIds.push(...cafeKeys.flatMap((key) => item.searchParams.getAll(key)));
        menuIds.push(...menuKeys.flatMap((key) => item.searchParams.getAll(key)));
    }
    return {cafeId: uniqueId(cafeIds), menuId: uniqueId(menuIds)};
}

export function cafeIdFromLink(link: string) {
    return idsFromLink(link, true)?.cafeId;
}

export function cafeHomePath(link: string) {
    const url = URL.parse(link);
    if (url && isCafeUrl(url) && /^\/[a-z\d][a-z\d_-]*\/?$/i.test(url.pathname)) return url.pathname.replace(/\/$/, '');
}

export function resolveCafeTarget(boardUrl?: string): CafeTarget | undefined {
    const link = boardUrl ?? process.env.NAVER_BOARD_URL?.trim();
    if (link) {
        const ids = idsFromLink(link);
        if (ids?.cafeId && ids.menuId) return {cafeId: ids.cafeId, menuId: ids.menuId};
        return;
    }

    const cafeId = process.env.NAVER_CAFE_ID?.trim();
    const menuId = process.env.NAVER_MENU_ID?.trim();
    if (cafeId && menuId && uniqueId([cafeId]) && uniqueId([menuId])) return {cafeId, menuId};
}

export function cafeBoardUrl({cafeId, menuId}: CafeTarget) {
    return `https://cafe.naver.com/ca-fe/web/cafes/${cafeId}/menus/${menuId}`;
}
