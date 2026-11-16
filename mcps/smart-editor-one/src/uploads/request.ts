export type EditorRequest = (url: string | URL, options?: RequestInit) => Promise<Response>;

export function createEditorUploadRequest(origin: string, signal?: AbortSignal): EditorRequest {
    return async (input, options = {}) => {
        const url = new URL(input);
        if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.endsWith('.naver.com')) {
            throw new Error('스마트에디터 업로드 주소를 확인할 수 없습니다.');
        }
        const headers = new Headers(options.headers);
        headers.set('Origin', origin);
        headers.set('Referer', `${origin}/`);
        headers.delete('Cookie');
        const timeout = AbortSignal.timeout(30_000);
        return fetch(url, {...options, headers, redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout});
    };
}

export async function readEditorJson(request: EditorRequest, url: string | URL, headers: HeadersInit, step: string) {
    const response = await request(url, {headers}).catch(() => null);
    const data = await response?.json().catch(() => null);
    if (!response?.ok || !data || data.error) {
        throw new Error(`${step}에 실패했습니다${response ? `(HTTP ${response.status})` : ''}.`);
    }
    return data;
}
