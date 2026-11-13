export type CafeRequest = (url: string | URL, options?: RequestInit) => Promise<Response>;
export const cafeHeaders = {'X-Cafe-Product': 'pc'};

function requestHeaders(options: RequestInit) {
    const headers = new Headers(options.headers);
    headers.set('Origin', 'https://cafe.naver.com');
    headers.set('Referer', 'https://cafe.naver.com/');
    headers.delete('Cookie');
    return headers;
}

export function createCafeReadRequest(loginHeaderFor: (hostname: string) => string | undefined, signal?: AbortSignal): CafeRequest {
    return (input, options = {}) => {
        const url = new URL(input);
        const hosts = ['https://cafe.naver.com', 'https://apis.naver.com', 'https://apis.cafe.naver.com'];
        if (!hosts.includes(url.origin) || url.username || url.password) {
            throw new Error('네이버 카페 조회 주소를 확인할 수 없습니다.');
        }
        const headers = requestHeaders(options);
        const cookie = loginHeaderFor(url.hostname);
        if (cookie) headers.set('Cookie', cookie);
        const timeout = AbortSignal.timeout(20_000);
        return fetch(url, {headers, redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout});
    };
}

export function createEditorRequest(loginHeader: string, signal?: AbortSignal): CafeRequest {
    return async (input, options = {}) => {
        const url = new URL(input);
        if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.endsWith('.naver.com')) {
            throw new Error('네이버 에디터 요청 주소를 확인할 수 없습니다.');
        }
        const headers = requestHeaders(options);
        if (url.origin === 'https://apis.cafe.naver.com' && url.pathname.startsWith('/editor/v2/cafes/')) {
            headers.set('Cookie', loginHeader);
        }
        const timeout = AbortSignal.timeout(30_000);
        return fetch(url, {...options, headers, redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout});
    };
}
