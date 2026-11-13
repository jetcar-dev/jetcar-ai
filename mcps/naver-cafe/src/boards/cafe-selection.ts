import type {BrowserName} from '../auth/browser-connection.js';
import {isNaverLoggedIn, needsNaverLogin} from '../auth/check-login.js';
import {readExtensionSession} from '../auth/playwright-extension.js';
import {createCafeReadRequest} from '../shared/naver-request.js';
import {cafeReference, defaultListingCafeId, resolveListingCafeId} from './boards.js';

export async function resolveCafeSelection(cafeUrl: string | undefined, browser: BrowserName | undefined, signal: AbortSignal,
    verifyLogin = false,
) {
    const target = cafeUrl ? cafeReference(cafeUrl) : undefined;
    const needsCafe = {status: 'needs_cafe_url', question: '조회할 네이버 카페 홈이나 게시판 링크를 보내주세요.'};
    if (cafeUrl && !target) return needsCafe;
    const defaultCafeId = target ? undefined : defaultListingCafeId();
    const session = await readExtensionSession(browser, !target && !defaultCafeId, signal);
    if (!('loginHeaderFor' in session) || !session.loginHeaderFor) return session;

    const request = createCafeReadRequest(session.loginHeaderFor, signal);
    if (!session.loginHeaderFor('apis.naver.com') || (verifyLogin && !await isNaverLoggedIn(request))) {
        return needsNaverLogin(session.name);
    }
    let cafeId = target ? await resolveListingCafeId(request, target) : defaultCafeId;
    if (!target && !cafeId) {
        const references = new Map<string, NonNullable<ReturnType<typeof cafeReference>>>();
        for (const url of session.urls) {
            const reference = cafeReference(url);
            if (reference) references.set(reference.cafeId ?? reference.homePath, reference);
        }
        const resolved = await Promise.all([...references.values()].map((reference) => resolveListingCafeId(request, reference)));
        const cafeIds = new Set(resolved.filter(Boolean));
        if (cafeIds.size === 1) cafeId = cafeIds.values().next().value;
    }
    if (!cafeId) return needsCafe;
    return {cafeId, browser: session.name, request};
}
