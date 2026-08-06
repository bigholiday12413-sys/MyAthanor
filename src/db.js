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

CREATE INDEX IF NOT EXISTS idx_log_occurred_at ON log (occurred_at);
CREATE INDEX IF NOT EXISTS idx_mission_source ON mission (source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_mission_status ON mission (status);
`);

db.exec(`INSERT OR IGNORE INTO settings (id, weekly_time, monthly_money) VALUES (1, 0, 0)`);

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
