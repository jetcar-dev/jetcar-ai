import {McpServer} from '@modelcontextprotocol/server';
import {serveStdio} from '@modelcontextprotocol/server/stdio';
import {z} from 'zod';
import {captureVehicleSection, vehicleSections} from './capture.js';
import {getVehicleDetail} from './detail.js';
import {listVehicles} from './list.js';
import {categories, type VehicleCategory} from './site.js';

const readsPublicSite = {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true};
const vehicleUrlSchema = z.string().trim().min(1).max(2_048)
    .describe('제트카 공개 차량 상세 링크. 목록 조회 결과의 url도 사용할 수 있습니다.');

function createServer() {
    const server = new McpServer({name: 'jetcar-site', version: '0.1.0'});

    server.registerTool('get_jetcar_vehicle', {
        title: '제트카 차량 상세 조회',
        description: '제트카 공개 차량 링크에서 차량 정보, 가격표, 주요 정보, 옵션, 계약·보험 조건과 차량 사진 링크를 조회합니다.',
        inputSchema: z.object({vehicleUrl: vehicleUrlSchema}),
        annotations: readsPublicSite,
    }, async ({vehicleUrl}, {mcpReq: {signal}}) => {
        const detail = await getVehicleDetail(vehicleUrl, signal);
        return {content: [{type: 'text', text: '제트카 차량 상세를 조회했습니다.'}], structuredContent: detail};
    });

    server.registerTool('capture_jetcar_vehicle_section', {
        title: '제트카 차량 상세 영역 캡처',
        description: 'Playwright로 제트카 차량의 주요정보, 가격정보, 옵션 중 요청한 한 영역을 원래 PC 웹 화면 그대로 캡처해 PNG로 저장합니다.',
        inputSchema: z.object({vehicleUrl: vehicleUrlSchema, section: z.enum(vehicleSections)}),
        annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true},
    }, async ({vehicleUrl, section}, {mcpReq: {signal}}) => {
        const capture = await captureVehicleSection(vehicleUrl, section, signal);
        return {content: [{type: 'text', text: `${section} 영역을 PNG로 저장했습니다. ${capture.filePath}`}], structuredContent: capture};
    });

    server.registerTool('list_jetcar_vehicles', {
        title: '제트카 차량 목록 조회',
        description: '제트카 신차장기렌트, 중고장기렌트, 화물차구독의 공개 차량 목록을 조회합니다. 차량의 상세 링크가 포함됩니다.',
        inputSchema: z.object({
            category: z.enum(['all', 'new', 'used', 'truck']).default('all')
                .describe('all 전체, new 신차장기렌트, used 중고장기렌트, truck 화물차구독'),
            page: z.number().int().positive().default(1).describe('사이트 쪽 번호. 처음 조회할 때는 1입니다.'),
        }),
        annotations: readsPublicSite,
    }, async ({category, page}, {mcpReq: {signal}}) => {
        const selected = category === 'all' ? Object.keys(categories) as VehicleCategory[] : [category];
        const lists = await Promise.all(selected.map((name) => listVehicles(name, page, signal)));
        const summary = lists.map((list) => `${categories[list.category].label} ${list.vehicles.length}대`).join(', ');
        return {content: [{type: 'text', text: `${page}쪽에서 ${summary}를 조회했습니다.`}], structuredContent: {lists}};
    });

    return server;
}

serveStdio(createServer);
