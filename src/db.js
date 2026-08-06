import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DB_PATH = resolve(process.env.DB_PATH ?? 'data/myathanor.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS idea (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  title             TEXT NOT NULL,
  occurred_at       TEXT NOT NULL,
  time_spent        INTEGER NOT NULL DEFAULT 0,
  money_spent       INTEGER NOT NULL DEFAULT 0,
  source_mission_id INTEGER
);

CREATE TABLE IF NOT EXISTS mission (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  source_type     TEXT NOT NULL CHECK (source_type IN ('idea', 'log')),
  source_id       INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'abandoned', 'done')),
  estimated_time  INTEGER NOT NULL DEFAULT 0,
  estimated_money INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  completed_at    TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  weekly_time   INTEGER NOT NULL DEFAULT 0,
  monthly_money INTEGER NOT NULL DEFAULT 0
);

-- 期間ごとの可処分量。行が無い期間は settings の既定値を使う。
-- period_key は kind='time' なら週の月曜日 (YYYY-MM-DD)、
-- kind='money' なら月 (YYYY-MM)。
CREATE TABLE IF NOT EXISTS budget (
  kind       TEXT NOT NULL CHECK (kind IN ('time', 'money')),
  period_key TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  PRIMARY KEY (kind, period_key)
);

-- 定期イベントの定義。日付が来た回は自動でログになる。
CREATE TABLE IF NOT EXISTS recurrence (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  title                 TEXT NOT NULL,
  freq                  TEXT NOT NULL CHECK (freq IN ('daily', 'weekly', 'monthly')),
  weekday               INTEGER,  -- weekly: 0=月 … 6=日
  month_day             INTEGER,  -- monthly: 1..31（無い日はその月の末日に寄せる）
  time_spent            INTEGER NOT NULL DEFAULT 0,
  money_spent           INTEGER NOT NULL DEFAULT 0,
  start_date            TEXT NOT NULL,
  end_date              TEXT,
  active                INTEGER NOT NULL DEFAULT 1,
  materialized_through  TEXT,     -- ここまでの日付はログ化を試行済み
  created_at            TEXT NOT NULL
);

-- 個別の回。定義と違う回だけ行を持つ（値の上書き・スキップ）。
-- ログ化済みの回は log_id を持つ。
CREATE TABLE IF NOT EXISTS occurrence (
  recurrence_id INTEGER NOT NULL,
  date          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled', 'skipped')),
  title         TEXT,     -- NULL は定義を継承
  time_spent    INTEGER,  -- NULL は定義を継承
  money_spent   INTEGER,  -- NULL は定義を継承
  log_id        INTEGER,
  PRIMARY KEY (recurrence_id, date)
);

-- 大釜：ひとつの大きなイベントに必要なミッション（素材）をまとめる器。
-- 素材が全部そろうと錬成が終わる。
CREATE TABLE IF NOT EXISTS cauldron (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  source_type  TEXT NOT NULL CHECK (source_type IN ('idea', 'log')),
  source_id    INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_cauldron_source ON cauldron (source_type, source_id);

CREATE TABLE IF NOT EXISTS tag (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

-- アイデア／ログとタグの結び付き。
CREATE TABLE IF NOT EXISTS entry_tag (
  kind     TEXT NOT NULL CHECK (kind IN ('idea', 'log')),
  entry_id INTEGER NOT NULL,
  tag_id   INTEGER NOT NULL,
  PRIMARY KEY (kind, entry_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_entry_tag_tag ON entry_tag (tag_id);
CREATE INDEX IF NOT EXISTS idx_log_occurred_at ON log (occurred_at);
CREATE INDEX IF NOT EXISTS idx_mission_source ON mission (source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_mission_status ON mission (status);
`);

db.exec(`INSERT OR IGNORE INTO settings (id, weekly_time, monthly_money) VALUES (1, 0, 0)`);

// 既存 DB 向けの追加。CREATE TABLE IF NOT EXISTS では列は増えないため。
function addColumn(table, column, definition) {
  const exists = db
    .prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`)
    .get(table, column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumn('log', 'source_recurrence_id', 'INTEGER');
// レガシー：大事な出来事・成し遂げたことの印。
addColumn('log', 'is_legacy', 'INTEGER NOT NULL DEFAULT 0');
addColumn('mission', 'is_legacy', 'INTEGER NOT NULL DEFAULT 0');
// アイデアの温度（K）。273K を常温＝基準とし、設定時点から基準へ向けて冷めていく。
addColumn('idea', 'temperature', 'INTEGER NOT NULL DEFAULT 320');
addColumn('idea', 'temperature_at', 'TEXT');
// 冷却の半減期（日）。0 なら冷めない。
addColumn('settings', 'cooling_half_life_days', 'INTEGER NOT NULL DEFAULT 30');
// 大釜に入っている素材（ミッション）。NULL なら単独のミッション。
addColumn('mission', 'cauldron_id', 'INTEGER');
// いつから／いつまで。どちらも任意で、YYYY-MM-DD のローカル日付。
addColumn('mission', 'start_date', 'TEXT');
addColumn('mission', 'due_date', 'TEXT');
// 大釜の期日。素材が自分の期限を持たなければ、これを引き継ぐ。
addColumn('cauldron', 'start_date', 'TEXT');
addColumn('cauldron', 'due_date', 'TEXT');

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
