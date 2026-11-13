import {z} from 'zod';
import {cafeBoardUrl, cafeHomePath, cafeIdFromLink, resolveCafeTarget} from './target.js';
import type {CafeRequest} from '../shared/naver-request.js';

const cafeIdSchema = z.string().trim().regex(/^[1-9]\d*$/);
const menuSchema = z.object({
    menuId: z.union([z.number().int().positive(), cafeIdSchema]),
    name: z.string().optional(),
    menuName: z.string().optional(),
    menuType: z.string(),
    boardType: z.string().optional(),
    indent: z.boolean().optional(),
    hidden: z.boolean().optional(),
    badMenu: z.boolean().optional(),
});
const responseSchema = z.object({result: z.object({menus: z.array(menuSchema)})});
const boardMenuTypes = new Set(['B', 'E', 'M', '8']);

export function cafeReference(cafeUrl: string) {
    const cafeId = cafeIdFromLink(cafeUrl);
    if (cafeId) return {cafeId};
    const homePath = cafeHomePath(cafeUrl);
    if (homePath) return {homePath};
}

export async function resolveListingCafeId(request: CafeRequest, reference: NonNullable<ReturnType<typeof cafeReference>>) {
    if (reference?.cafeId) return reference.cafeId;
    if (reference?.homePath) {
        const response = await request(`https://cafe.naver.com${reference.homePath}`);
        if (response.ok) {
            return /\bvar\s+g_sClubId\s*=\s*["']([1-9]\d*)["']\s*;/.exec(await response.text())?.[1];
        }
        return;
    }
}

export function defaultListingCafeId() {
    return resolveCafeTarget()?.cafeId ?? cafeIdSchema.safeParse(process.env.NAVER_CAFE_ID).data;
}

type Board = {menuId: string; name: string; group?: string; boardUrl: string};
type Group = {menuId: string; name: string; boards: Board[]};

export async function listCafeBoards(cafeId: string, request: CafeRequest) {
    const response = await request(`https://apis.naver.com/cafe-web/cafe-cafemain-api/v1.0/cafes/${cafeId}/menus`, {
        headers: {'x-cafe-product': 'pc'},
    });
    if (!response.ok) throw new Error(`네이버 카페 게시판을 조회하지 못했습니다 (HTTP ${response.status}).`);
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('게시판 목록을 받지 못했습니다. 브라우저의 네이버 로그인 상태와 카페 접근 권한을 확인하세요.');

    let group: Group | undefined;
    const boards: Board[] = [];
    const menuTree: (Board | Group)[] = [];
    for (const menu of parsed.data.result.menus) {
        const name = (menu.menuName ?? menu.name)?.trim();
        if (menu.menuType === 'F') {
            group = !menu.hidden && name ? {menuId: String(menu.menuId), name, boards: []} : undefined;
            continue;
        }
        if (!name || menu.hidden || menu.badMenu || !boardMenuTypes.has(menu.menuType)) continue;
        const menuId = String(menu.menuId);
        const query = `search.clubid=${cafeId}&search.menuid=${menuId}`;
        let boardUrl = cafeBoardUrl({cafeId, menuId});
        if (menu.menuType === '8') boardUrl = `https://cafe.naver.com/StaffArticleList.nhn?${query}`;
        if (menu.menuType === 'M') boardUrl = `https://cafe.naver.com/MemoList.nhn?${query}&viewType=pc`;
        const parent = menu.indent ? group : undefined;
        const board = {menuId, name, ...(parent ? {group: parent.name} : {}), boardUrl};
        boards.push(board);
        if (parent) {
            if (!parent.boards.length) menuTree.push(parent);
            parent.boards.push(board);
        } else {
            menuTree.push(board);
        }
    }
    return {boards, menuTree};
}
