import {readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const directory = process.argv[2] ?? fileURLToPath(new URL('../', import.meta.url));
const requireFromPackage = createRequire(resolve(directory, 'package.json'));
const requireFromPlaywright = createRequire(requireFromPackage.resolve('@playwright/mcp/package.json'));
const bundle = join(dirname(requireFromPlaywright.resolve('playwright-core/package.json')), 'lib', 'coreBundle.js');
const source = await readFile(bundle, 'utf8');
const anchor = '        if (this._results.length)\n          addSection("Result", this._results);';
const patch = `${anchor}
        // Raw cookie results do not need a snapshot or metadata from the selected tab.
        if (this._raw && this.toolName === "browser_cookie_list")
          return sections;`;

if (!source.includes(patch)) {
    const index = source.indexOf(anchor);
    if (index === -1 || index !== source.lastIndexOf(anchor)) {
        throw new Error('Playwright 응답 처리 코드가 바뀌었습니다. 쿠키 응답 호환 코드를 확인하세요.');
    }
    await writeFile(bundle, source.replace(anchor, patch));
}
