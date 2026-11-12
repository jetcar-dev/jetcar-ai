import {homedir} from 'node:os';
import {isAbsolute, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadEnvFile} from 'node:process';
import {createHash} from 'node:crypto';

try {
    loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

function required(name: string) {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`.env에 ${name} 값을 설정하세요.`);
    return value;
}

export function oauthConfig() {
    const clientId = required('NAVER_CLIENT_ID');
    const port = Number(process.env.NAVER_CALLBACK_PORT ?? '43127');
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new Error('NAVER_CALLBACK_PORT는 1024~65535 사이의 정수여야 합니다.');
    }
    const appKey = createHash('sha256').update(clientId).digest('hex');
    const dataDirectory = join(homedir(), '.naver-cafe-mcp');
    return {
        clientId,
        clientSecret: required('NAVER_CLIENT_SECRET'),
        callback: new URL(`http://127.0.0.1:${port}/oauth/naver/callback`),
        tokenPath: join(dataDirectory, `${appKey}.json`),
    };
}

export function imageDirectory() {
    const directory = required('NAVER_IMAGE_DIR');
    if (!isAbsolute(directory)) throw new Error('NAVER_IMAGE_DIR는 절대 경로여야 합니다.');
    return directory;
}
