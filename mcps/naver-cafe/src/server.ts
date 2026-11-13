import {McpServer} from '@modelcontextprotocol/server';
import {serveStdio} from '@modelcontextprotocol/server/stdio';
import './shared/config.js';
import {registerCheckLogin} from './auth/check-login.js';
import {closeExtensionConnections} from './auth/playwright-extension.js';
import {registerListArticles} from './articles/list-articles.js';
import {registerListBoards} from './boards/list-boards.js';
import {registerListDrafts} from './drafts/list-drafts.js';
import {registerSaveDraft} from './drafts/save-draft.js';

function createServer() {
    const server = new McpServer({name: 'naver-cafe', version: '0.1.0'});
    registerCheckLogin(server);
    registerListBoards(server);
    registerListArticles(server);
    registerListDrafts(server);
    registerSaveDraft(server);
    return server;
}

serveStdio(createServer);
process.stdin.once('end', () => { void closeExtensionConnections(); });
