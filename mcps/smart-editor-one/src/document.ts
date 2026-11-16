import {z} from 'zod';
import {blockTextLength, editorBlock, type EditorBlock} from './editor-blocks.js';

export type Block = EditorBlock;
type TextBlock = Extract<Block, {type: 'text'}>;
export type Run = NonNullable<TextBlock['runs']>[number];

export const documentSchema = z.object({
    title: z.string().trim().min(1).max(300).describe('글 제목'),
    blocks: z.array(editorBlock).min(1).max(100).describe('원고 순서대로 문단, 표, 사진, 동영상, 인용구, 구분선을 넣습니다.'),
    representativeImage: z.number().int().positive().optional().describe('본문 사진 중 대표사진 순번. 첫 사진은 1번입니다.'),
});
export type Draft = z.infer<typeof documentSchema>;

function toRuns({type, text, runs, align, ...style}: TextBlock): Run[] {
    return runs ? runs.map((run) => ({...style, ...run})) : [{...style, text: text!}];
}

function groupTextBlocks(blocks: Block[]) {
    const output: Block[] = [];
    let group: TextBlock | undefined;
    for (const block of blocks) {
        const previous = output.at(-1);
        if (block.type === 'text' && previous?.type === 'text' && previous.align === block.align) {
            const before = group === previous ? group.runs! : toRuns(previous);
            const after = toRuns(block);
            if (before.length + after.length + 1 <= 200) {
                before.push({text: '\n'}, ...after);
                group = {type: 'text', align: block.align, runs: before};
                output[output.length - 1] = group;
                continue;
            }
        }
        group = undefined;
        output.push(block);
    }
    return output;
}

export function prepareDocument({title, blocks, representativeImage}: Draft, group = true): Draft {
    const groupedBlocks = group ? groupTextBlocks(blocks) : blocks;
    if (!groupedBlocks.length || groupedBlocks.length > 100) throw new Error('본문 블록은 1~100개여야 합니다.');
    const textLength = groupedBlocks.reduce((count, block) => count + blockTextLength(block), 0);
    if (textLength > 30_000) throw new Error('본문은 전체 30,000자 이하여야 합니다.');
    const imageCount = groupedBlocks.filter(({type}) => type === 'image').length;
    if (representativeImage !== undefined && representativeImage > imageCount) {
        throw new Error('대표사진은 원고에 들어 있는 사진의 순서로 지정하세요.');
    }
    return {title, blocks: groupedBlocks, ...(representativeImage !== undefined && {representativeImage})};
}
