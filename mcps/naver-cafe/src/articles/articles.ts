import type {CafeTarget} from '../boards/target.js';
import {cafeHeaders, type CafeRequest} from '../shared/naver-request.js';
import {articleBodyText} from './body-text.js';

type ArticleItem = {
    articleId: number;
    subject: string;
    writeDateTimestamp?: number;
    writerInfo?: {nickName?: string};
    readCount?: number;
    commentCount?: number;
    summary?: string;
};
type ListPayload = {
    result?: {
        articleList?: {type: string; item?: ArticleItem}[];
        pageInfo?: {lastNavigationPageNumber: number; visibleNextButton: boolean};
        errorCode?: string;
    };
    error?: {errorCode?: string};
};
type ArticleBody =
    | {bodyStatus: 'loaded'; bodyText: string}
    | {bodyStatus: 'access_denied' | 'unavailable'};

const bodyConcurrency = 8;
const listRoot = 'https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes';
const articleRoot = 'https://article.cafe.naver.com/gw/v4/cafes';

function isAccessDenied(response: Response, errorCode?: string) {
    return response.status === 401 || response.status === 403 || String(errorCode) === '10004';
}

export async function readArticlePage(board: CafeTarget, page: number, pageSize: number, request: CafeRequest) {
    const url = new URL(`${listRoot}/${board.cafeId}/menus/${board.menuId}/articles`);
    url.search = new URLSearchParams({page: String(page), pageSize: String(pageSize), sortBy: 'TIME', viewType: 'L'}).toString();
    const response = await request(url, {headers: cafeHeaders});
    const data: ListPayload | null = await response.json().catch(() => null);
    if (isAccessDenied(response, data?.error?.errorCode ?? data?.result?.errorCode)) return {status: 'access_denied'} as const;
    const result = data?.result;
    if (!response.ok || !Array.isArray(result?.articleList) || !result.pageInfo) {
        throw new Error(`네이버 카페의 게시글 목록을 가져오지 못했습니다 (HTTP ${response.status}).`);
    }

    const articles = result.articleList.flatMap(({type, item}) => type === 'ARTICLE' && item &&
        Number.isSafeInteger(item.articleId) && typeof item.subject === 'string' ? [{
            articleId: item.articleId,
            title: item.subject,
            writtenAt: item.writeDateTimestamp,
            author: item.writerInfo?.nickName,
            readCount: item.readCount,
            commentCount: item.commentCount,
            preview: item.summary,
            url: `https://cafe.naver.com/ca-fe/web/cafes/${board.cafeId}/articles/${item.articleId}`,
        }] : []);
    const {lastNavigationPageNumber, visibleNextButton} = result.pageInfo;
    const nextPage = page < lastNavigationPageNumber || visibleNextButton ? page + 1 : null;
    return {status: 'listed', articles, nextPage} as const;
}

async function readArticleBody(board: CafeTarget, articleId: number, request: CafeRequest, signal: AbortSignal): Promise<ArticleBody> {
    const url = new URL(`${articleRoot}/${board.cafeId}/articles/${articleId}`);
    url.search = new URLSearchParams({menuId: board.menuId, useCafeId: 'true'}).toString();
    let response: Response;
    try {
        response = await request(url, {headers: cafeHeaders});
    } catch {
        signal.throwIfAborted();
        return {bodyStatus: 'unavailable'};
    }
    const data = await response.json().catch(() => null);
    signal.throwIfAborted();
    const detail = data?.result;
    const article = detail?.article;
    if (isAccessDenied(response, data?.error?.errorCode ?? detail?.errorCode) || article?.isReadable === false) {
        return {bodyStatus: 'access_denied'};
    }
    if (!response.ok || String(detail?.menuId) !== board.menuId || article?.id !== articleId || typeof article.contentHtml !== 'string') {
        return {bodyStatus: 'unavailable'};
    }
    return {bodyStatus: 'loaded', bodyText: articleBodyText(article.contentHtml)};
}

export async function readArticleBodies(board: CafeTarget, ids: number[], request: CafeRequest, signal: AbortSignal) {
    const bodies = new Map<number, ArticleBody>();
    let next = 0;
    await Promise.all(Array.from({length: Math.min(bodyConcurrency, ids.length)}, async () => {
        while (next < ids.length) {
            signal.throwIfAborted();
            const id = ids[next++];
            bodies.set(id, await readArticleBody(board, id, request, signal));
        }
    }));
    return bodies;
}
