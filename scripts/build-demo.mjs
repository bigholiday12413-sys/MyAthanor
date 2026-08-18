/* GitHub Pages に置く見本版を組み立てる。
   本体のコードはそのまま持っていき、DB の1ファイルだけ差し替える。
   src/store.js は './db.js' を読むので、そこに WASM 版を置けば
   ロジックには一切手を入れずにブラウザで動く。 */

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const site = join(root, 'site');

await rm(site, { recursive: true, force: true });
await mkdir(join(site, 'src'), { recursive: true });
await mkdir(join(site, 'demo'), { recursive: true });

/* 画面。sw.js は見本版では使わないので持っていかない。 */
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
/* index.html は本体のものから組み立てる。写しを持つと、タブの名前を変えた時に
   片方だけ古いまま残る（実際にダンジョン／ミッションのまま出ていた）。
   違うのは「見本である断り」と、読み込む部品の3点だけなので、そこだけ差し替える。 */
const shell = await readFile(join(root, 'public', 'index.html'), 'utf8');
const banner = await readFile(join(root, 'demo', 'banner.html'), 'utf8');
const [bannerHead, bannerBody] = banner.split('<!-- body -->');

const demoIndex = shell
  // Pages はサブパスに置かれるので、絶対パスでは引けない。
  .replaceAll('href="/', 'href="./')
  .replaceAll('src="/', 'src="./')
  .replace('<title>MyAthanor</title>', '<title>MyAthanor（見本）</title>')
  .replace('</head>', `${bannerHead}  </head>`)
  .replace('    <div class="app">', `    <div class="app">\n${bannerBody.trimEnd()}`)
  // 更新の知らせとサービスワーカーは本体だけのもの。
  .replace(/ *<div class="update-badge"[\s\S]*?<\/div>\n/, '')
  .replace(/ *<script type="module" src="\.\/app\.js"><\/script>\n/, '')
  .replace(/ *<script>\n +if \('serviceWorker'[\s\S]*?<\/script>\n/, '')
  .replace('  </body>', `    <script src="./demo/sql-wasm.js"></script>
    <script type="importmap">
      { "imports": { "express": "./demo/express.js" } }
    </script>
    <script type="module" src="./demo/main.js"></script>
  </body>`);

for (const gone of ['update-badge', 'serviceWorker', 'src="/app.js"']) {
  if (demoIndex.includes(gone)) throw new Error(`index.html に ${gone} が残っている`);
}
for (const need of ['アストロラーベ', 'demo/main.js', 'demo-banner']) {
  if (!demoIndex.includes(need)) throw new Error(`index.html に ${need} が無い`);
}
await writeFile(join(site, 'index.html'), demoIndex);

/* WASM の SQLite */
const dist = join(root, 'node_modules', 'sql.js', 'dist');
for (const file of ['sql-wasm.js', 'sql-wasm.wasm']) {
  await cp(join(dist, file), join(site, 'demo', file));
}

/* Pages は _ で始まる名前を Jekyll に食わせようとするので、素通しにする。 */
await writeFile(join(site, '.nojekyll'), '');

console.log(`built ${site}`);
