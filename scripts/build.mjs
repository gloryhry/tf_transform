import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function buildProject({ quiet = false } = {}) {
  const bundle = await build({
    entryPoints: [path.join(root, 'src/app.js')], bundle: true, write: false,
    platform: 'browser', format: 'iife', target: ['es2020'], minify: true, legalComments: 'none',
  });
  const template = await readFile(path.join(root, 'src/index.html'), 'utf8');
  const styles = await readFile(path.join(root, 'src/styles.css'), 'utf8');
  // Escape closing script tags before embedding, including any future user-facing examples.
  const script = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const html = template.replace('/* APP_STYLES */', () => styles).replace('/* APP_SCRIPT */', () => script);
  const handler = `const HTML = ${JSON.stringify(html)};
function handleRequest(request) {
  const headers = { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-cache' };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { 'content-type': 'text/plain; charset=utf-8', 'allow': 'GET, HEAD' } });
  }
  return new Response(request.method === 'HEAD' ? null : HTML, { status: 200, headers });
}
`;
  const cloudflare = handler + 'export default { fetch: handleRequest };\n';
  const edgeone = handler + "addEventListener('fetch', event => { event.respondWith(handleRequest(event.request)); });\n";
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await writeFile(path.join(root, 'dist/index.html'), html);
  await writeFile(path.join(root, 'dist/edgeone.js'), edgeone);
  await writeFile(path.join(root, 'dist/cloudflare.js'), cloudflare);
  if (!quiet) {
    for (const [name, data] of [['index.html', html], ['edgeone.js', edgeone], ['cloudflare.js', cloudflare]]) {
      console.log(`dist/${name} · ${(Buffer.byteLength(data) / 1024).toFixed(1)} KiB`);
    }
  }
  return html;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildProject();
