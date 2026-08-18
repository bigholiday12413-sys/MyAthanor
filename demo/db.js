/* プレビュー版の DB。組み立て時に src/db.js の位置へ置き換わるので、
   src/store.js の `import { db } from './db.js'` がそのままここに繋がる。
   ロジックは本体と同じものが動き、下に敷くのが WASM の SQLite になるだけ。 */

import { applySchema } from './schema.js';
import { BrowserDatabase } from '../demo/sqlite.js';
import { seed } from '../demo/seed.js';

const STORE_KEY = 'myathanor.demo.db';

const toBase64 = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

const SQL = await window.initSqlJs({ locateFile: (file) => `./demo/${file}` });

// 前に触ったぶんが残っていれば読み直す。壊れていたら作り直す。
let saved = null;
try {
  const stored = localStorage.getItem(STORE_KEY);
  if (stored) saved = fromBase64(stored);
} catch {
  saved = null;
}

let raw;
let fresh = false;
try {
  raw = saved ? new SQL.Database(saved) : new SQL.Database();
} catch {
  raw = new SQL.Database();
  fresh = true;
}
if (!saved) fresh = true;

export const db = new BrowserDatabase(raw);

db.exec('PRAGMA foreign_keys = ON');
applySchema(db);

export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// 書き込みのたびに丸ごと保存する。見本ぶんの大きさなら気にならない。
let saveTimer = null;
db.onChange = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, toBase64(db.export()));
    } catch {
      // 入りきらないときは諦める。プレビューなので消えても困らない。
    }
  }, 150);
};

// 初回だけ見本を入れる。空の画面では手ざわりが分からないため。
if (fresh) seed(db, transaction);

export function resetDemo() {
  localStorage.removeItem(STORE_KEY);
  location.reload();
}
