/* プレビュー版の入口。
   /api への fetch を横取りして、本体と同じ src/routes.js に渡す。
   サーバが無いだけで、通る道は本番とまったく同じ。 */

import { api } from '../src/routes.js';
import { resetDemo } from '../src/db.js';

const passthrough = window.fetch.bind(window);

function reply(status, payload) {
  return new Response(payload === undefined ? '' : JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('/api')) return passthrough(input, init);

  const parsed = new URL(url, location.origin);
  const path = parsed.pathname.replace(/^\/api/, '') || '/';

  try {
    const result = api.handle(
      (init.method ?? 'GET').toUpperCase(),
      path,
      Object.fromEntries(parsed.searchParams),
      init.body ? JSON.parse(init.body) : undefined,
    );
    return reply(result.status, result.payload);
  } catch (err) {
    // server.js の誤りの返し方に合わせる。app.js はこの形を読む。
    return reply(err.status ?? 500, { error: err.message ?? 'internal error' });
  }
};

// 見本であることを断り、元に戻す手立てを置く。
const banner = document.getElementById('demo-banner');
banner.querySelector('button').addEventListener('click', () => {
  if (confirm('入れたものを消して、最初の見本に戻します。よろしいですか？')) resetDemo();
});

await import('../app.js');
