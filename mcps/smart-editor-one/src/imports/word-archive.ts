import {posix} from 'node:path';
import {fromBufferPromise, type Entry} from 'yauzl';
import {attr, parseWordXml} from './word-xml.js';

export type Relationship = {target: string; type: string; external: boolean};

export async function withWordArchive<T>(source: Buffer, use: (archive: Awaited<ReturnType<typeof indexWordArchive>>) => Promise<T>) {
    const zip = await fromBufferPromise(source, {autoClose: false, lazyEntries: true, validateEntrySizes: true});
    try {
        return await use(await indexWordArchive(zip));
    } finally {
        zip.close();
    }
}

async function indexWordArchive(zip: Awaited<ReturnType<typeof fromBufferPromise>>) {
    if (zip.entryCount > 4_000) throw new Error('Word 파일에 내부 항목이 너무 많습니다.');
    const entries = new Map<string, Entry>();
    for await (const entry of zip.eachEntry()) entries.set(entry.fileName, entry);

    async function read(name: string, maxBytes: number) {
        const entry = entries.get(name);
        if (!entry) return;
        if (entry.uncompressedSize > maxBytes) throw new Error(`Word 내부 항목이 허용 크기를 초과했습니다. (${name})`);
        const stream = await zip.openReadStreamPromise(entry);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk);
        return Buffer.concat(chunks, entry.uncompressedSize);
    }

    async function xml(name: string, mixedElement?: string) {
        const bytes = await read(name, 8 * 1024 * 1024);
        return bytes && parseWordXml(bytes, mixedElement);
    }

    async function relationships(sourcePath: string) {
        const path = sourcePath ? posix.join(posix.dirname(sourcePath), '_rels', `${posix.basename(sourcePath)}.rels`) : '_rels/.rels';
        const tree = await xml(path);
        const result = new Map<string, Relationship>();
        for (const rel of tree?.children ?? []) {
            const id = attr(rel, 'Id'), target = attr(rel, 'Target'), type = attr(rel, 'Type');
            if (id && target && type) result.set(id, {target, type, external: attr(rel, 'TargetMode') === 'External'});
        }
        return result;
    }

    const size = (name: string) => entries.get(name)?.uncompressedSize;
    return {read, xml, relationships, size};
}

export function internalTarget(sourcePath: string, relationship: Relationship | undefined) {
    if (!relationship || relationship.external) return;
    const target = decodeURIComponent(relationship.target);
    if (target.includes('\\') || /[\x00-\x1f?#:]/.test(target)) return;
    const path = target.startsWith('/') ? posix.normalize(target).slice(1) : posix.join(posix.dirname(sourcePath), target);
    if (path && path !== '..' && !path.startsWith('../')) return path;
}
