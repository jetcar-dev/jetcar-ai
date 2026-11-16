import {randomUUID} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {parseVehicleUrl} from './site.js';

export const vehicleSections = ['주요정보', '가격정보', '옵션'] as const;
type VehicleSection = typeof vehicleSections[number];

const sections = {
    주요정보: {name: 'key-info', selector: '.d2'},
    가격정보: {name: 'price', selector: '.rent-quote-wrap:visible, .d1:visible'},
    옵션: {name: 'options', selector: '.d3'},
} satisfies Record<VehicleSection, {name: string; selector: string}>;

async function launchBrowser(signal?: AbortSignal) {
    const {chromium} = await import('playwright-core');
    const options = {headless: true, timeout: 10_000};
    signal?.throwIfAborted();
    try {
        return await chromium.launch({...options, channel: 'chrome'});
    } catch {
        signal?.throwIfAborted();
        try { return await chromium.launch({...options, channel: 'msedge'}); }
        catch (cause) { throw new Error('백그라운드 브라우저를 시작하지 못했습니다. Chrome 또는 Edge 설치 상태를 확인하세요.', {cause}); }
    }
}

export async function captureVehicleSection(vehicleUrl: string, section: VehicleSection, signal?: AbortSignal) {
    const vehicle = parseVehicleUrl(vehicleUrl);
    const {name, selector} = sections[section];
    const browser = await launchBrowser(signal);
    const cancel = () => { void browser.close().catch(() => {}); };
    signal?.addEventListener('abort', cancel, {once: true});
    try {
        signal?.throwIfAborted();
        const page = await browser.newPage({viewport: {width: 1872, height: 959}, deviceScaleFactor: 1, locale: 'ko-KR'});
        const response = await page.goto(vehicle.url, {waitUntil: 'domcontentloaded', timeout: 15_000});
        if (!response?.ok() || parseVehicleUrl(page.url()).url !== vehicle.url) throw new Error('제트카 차량의 공개 페이지를 열지 못했습니다.');

        const target = page.locator('#bo_v_con').locator(selector);
        const png = await target.screenshot({type: 'png', timeout: 12_000}).catch((cause) => {
            signal?.throwIfAborted();
            throw new Error(`차량 페이지에서 ${section} 영역을 캡처하지 못했습니다.`, {cause});
        });

        const directory = join(homedir(), 'Downloads', 'Jetcar');
        const filePath = join(directory, `jetcar-${vehicle.category}-${vehicle.id}-${name}-${randomUUID()}.png`);
        await mkdir(directory, {recursive: true});
        signal?.throwIfAborted();
        await writeFile(filePath, png, {flag: 'wx'});
        return {...vehicle, section, filePath};
    } finally {
        signal?.removeEventListener('abort', cancel);
        await browser.close().catch(() => {});
    }
}
