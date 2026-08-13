/* GitHub Pages に置く見本版を組み立てる。
   本体のコードはそのまま持っていき、DB の1ファイルだけ差し替える。
   src/store.js は './db.js' を読むので、そこに WASM 版を置けば
   ロジックには一切手を入れずにブラウザで動く。 */

import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const site = join(root, 'site');

await rm(site, { recursive: true, force: true });
await mkdir(join(site, 'src'), { recursive: true });
await mkdir(join(site, 'demo'), { recursive: true });

/* 画面。index.html と sw.js は見本版のものに差し替えるので持っていかない。 */
for (const file of ['app.js', 'icons.js', 'styles.css']) {
  await cp(join(root, 'public', file), join(site, file));
}

/* 書体。styles.css からは相対で引いているので、同じ並びのまま置く。 */
await cp(join(root, 'public', 'fonts'), join(site, 'fonts'), { recursive: true });

/* サーバ側のロジック。db.js だけは持っていかない。 */
for (const file of ['store.js', 'routes.js', 'period.js', 'schema.js']) {
  await cp(join(root, 'src', file), join(site, 'src', file));
}

/* 見本版の部品。db.js は src/db.js の位置へ置く。 */
await cp(join(root, 'demo', 'db.js'), join(site, 'src', 'db.js'));
for (const file of ['sqlite.js', 'express.js', 'seed.js', 'main.js']) {
  await cp(join(root, 'demo', file), join(site, 'demo', file));
}
await cp(join(root, 'demo', 'index.html'), join(site, 'index.html'));

/* WASM の SQLite */
const dist = join(root, 'node_modules', 'sql.js', 'dist');
for (const file of ['sql-wasm.js', 'sql-wasm.wasm']) {
  await cp(join(dist, file), join(site, 'demo', file));
}

/* Pages は _ で始まる名前を Jekyll に食わせようとするので、素通しにする。 */
await writeFile(join(site, '.nojekyll'), '');

console.log(`built ${site}`);
