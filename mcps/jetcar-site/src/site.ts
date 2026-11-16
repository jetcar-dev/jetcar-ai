export const categories = {
    new: {path: 'sub0201', label: '신차장기렌트'},
    used: {path: 'sub0301', label: '중고장기렌트'},
    truck: {path: 'sub0701', label: '화물차구독'},
} as const;

export type VehicleCategory = keyof typeof categories;

const origin = 'https://jetcar.co.kr';

export function parseVehicleUrl(vehicleUrl: string) {
    let url: URL;
    try { url = new URL(vehicleUrl); } catch { throw new Error('유효한 제트카 차량 상세 URL을 입력하세요.'); }
    const match = /^\/([^/]+)\/(\d+)\/?$/.exec(url.pathname);
    if (url.origin !== origin || url.username || url.password || !match) throw new Error('제트카 차량 상세 URL만 사용할 수 있습니다.');
    const category = (Object.keys(categories) as VehicleCategory[]).find((key) => categories[key].path === match[1]);
    if (!category) throw new Error('지원하지 않는 차량 분류입니다.');
    return {url: `${origin}/${match[1]}/${match[2]}`, id: match[2], category, categoryLabel: categories[category].label};
}

export async function requestJetcar(path: string | URL, init?: RequestInit) {
    const url = new URL(path, origin);
    if (url.origin !== origin || url.username || url.password) throw new Error('제트카 공개 홈페이지 주소를 사용하세요.');

    const signal = AbortSignal.timeout(15_000);
    const response = await fetch(url, {...init, redirect: 'error',
        signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal});
    if (response.ok) return response;
    await response.body?.cancel();
    if (response.status === 404) throw new Error('제트카 홈페이지에서 요청한 공개 차량이나 목록을 찾을 수 없습니다.');
    throw new Error(`제트카 홈페이지에서 정보를 가져오지 못했습니다 (HTTP ${response.status}).`);
}
