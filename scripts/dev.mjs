import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildProject } from './build.mjs';

const root = new URL('../', import.meta.url);
const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || 8787);
let page = await buildProject({ quiet: true });
let buildTimer;
let pending = false;
let rebuilding = false;
async function rebuild() {
  if (rebuilding) { pending = true; return; }
  rebuilding = true;
  try { page = await buildProject({ quiet: true }); console.log('页面已重新构建，刷新浏览器查看。'); }
  catch (error) { console.error('构建失败，继续提供上次有效版本。', error.message); }
  finally { rebuilding = false; if (pending) { pending = false; await rebuild(); } }
}
const watcher = watch(fileURLToPath(new URL('src/', root)), { recursive: true }, () => {
  clearTimeout(buildTimer); buildTimer = setTimeout(rebuild, 120);
});
const server = createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' });
    response.end('Method Not Allowed'); return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
  response.end(request.method === 'HEAD' ? undefined : page);
});
server.listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));
server.on('error', (error) => { console.error(error.message); watcher.close(); process.exitCode = 1; });
function close() { clearTimeout(buildTimer); watcher.close(); server.close(); }
process.on('SIGINT', close); process.on('SIGTERM', close);
