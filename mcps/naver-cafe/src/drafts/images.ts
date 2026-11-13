import {readFile, realpath, stat} from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';
import {imageDirectory} from '../shared/config.js';

export const maxImages = 20;
const maxImageBytes = 5 * 1024 * 1024;
const maxTotalImageBytes = 25 * 1024 * 1024;
const imageTypes = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
} as const;

export async function loadImages(names: string[]) {
    if (names.length === 0) return [];
    const directory = await realpath(imageDirectory());
    const files = await Promise.all(names.map(async (name) => {
        const extension = name.slice(name.lastIndexOf('.')).toLowerCase();
        if (name !== basename(name) || /[\\/:\x00-\x1f]/.test(name) || !Object.hasOwn(imageTypes, extension)) {
            throw new Error('이미지는 지정 폴더에 있는 JPG, PNG, GIF 파일의 이름만 입력하세요.');
        }
        const file = await realpath(join(directory, name));
        if (dirname(file) !== directory) throw new Error('지정 폴더 안의 이미지 파일을 사용하세요.');
        const info = await stat(file);
        if (!info.isFile() || info.size === 0 || info.size > maxImageBytes) {
            throw new Error('지정 폴더에 있는 5 MiB 이하의 이미지 파일을 사용하세요.');
        }
        return {name, file, size: info.size, type: imageTypes[extension as keyof typeof imageTypes]};
    }));
    if (files.reduce((total, file) => total + file.size, 0) > maxTotalImageBytes) {
        throw new Error('사진 전체 용량은 25 MiB 이하여야 합니다.');
    }
    const images = await Promise.all(files.map(async ({name, file, type}) => {
        const bytes = await readFile(file);
        const validSignature = type === 'image/jpeg' ? bytes.subarray(0, 3).toString('hex') === 'ffd8ff'
            : type === 'image/png' ? bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
            : ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'));
        if (bytes.length > maxImageBytes || !validSignature) {
            throw new Error('이미지 파일 형식 또는 크기를 확인하세요.');
        }
        return {name, blob: new Blob([bytes], {type})};
    }));
    if (images.reduce((total, image) => total + image.blob.size, 0) > maxTotalImageBytes) {
        throw new Error('사진 전체 용량은 25 MiB 이하여야 합니다.');
    }
    return images;
}
