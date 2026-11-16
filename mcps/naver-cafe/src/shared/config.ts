import {isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadEnvFile} from 'node:process';

try {
    loadEnvFile(fileURLToPath(new URL('../../../../.env', import.meta.url)));
} catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

function required(name: string) {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`.env에 ${name} 값을 설정하세요.`);
    return value;
}

export function imageDirectory() {
    const directory = required('NAVER_IMAGE_DIR');
    if (!isAbsolute(directory)) throw new Error('NAVER_IMAGE_DIR는 절대 경로여야 합니다.');
    return directory;
}
