/* スキーマだけを切り出しておく。
   本体（node:sqlite）とプレビュー版（ブラウザの sql.js）で同じものを使うため。
   ここが1つなら、片方だけ列が増えて食い違うことがない。 */

export const SCHEMA = `
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

-- 期間ごとに使える量。行が無い期間は settings の既定値を使う。
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
`;

export const SETTINGS_ROW =
  `INSERT OR IGNORE INTO settings (id, weekly_time, monthly_money) VALUES (1, 0, 0)`;

// 後から足した列。CREATE TABLE IF NOT EXISTS では列は増えないので、個別に足す。
export const ADDED_COLUMNS = [
  ['log', 'source_recurrence_id', 'INTEGER'],
  // レガシー：大事な出来事・成し遂げたことの印。
  ['log', 'is_legacy', 'INTEGER NOT NULL DEFAULT 0'],
  ['mission', 'is_legacy', 'INTEGER NOT NULL DEFAULT 0'],
  // アイデアの温度（K）。273K を常温＝基準とし、設定時点から基準へ向けて冷めていく。
  ['idea', 'temperature', 'INTEGER NOT NULL DEFAULT 320'],
  ['idea', 'temperature_at', 'TEXT'],
  // 冷却の半減期（日）。0 なら冷めない。
  ['settings', 'cooling_half_life_days', 'INTEGER NOT NULL DEFAULT 30'],
  // 大釜に入っている素材（ミッション）。NULL なら単独のミッション。
  ['mission', 'cauldron_id', 'INTEGER'],
  // いつから／いつまで。どちらも任意で、YYYY-MM-DD のローカル日付。
  ['mission', 'start_date', 'TEXT'],
  ['mission', 'due_date', 'TEXT'],
  // スペル（インゴット）だった頃の印。いまは使っていないが、列は消さない決まり。
  ['idea', 'is_spell', 'INTEGER NOT NULL DEFAULT 0'],
  // アイデアの本文。題だけでは足りないときに書き足す。
  ['idea', 'body', 'TEXT'],
  // 金庫：月が終わったときのウォレットの余りが積まれていく。初期残高も持てる。
  ['settings', 'vault_initial', 'INTEGER NOT NULL DEFAULT 0'],
  // 週のタイムを表で選んだときの塗り。168文字（曜日×24時間）の 0/1。
  ['settings', 'time_grid', 'TEXT'],
  // 大釜の期日。素材が自分の期限を持たなければ、これを引き継ぐ。
  ['cauldron', 'start_date', 'TEXT'],
  ['cauldron', 'due_date', 'TEXT'],
  // 買ったものの別。'food'＝消え物（糧）、'gear'＝残るもの（装備）。
  // NULL は出来事としてのログで、ここまでの記録はすべてこれに当たる。
  // 買ったものの別。食べれば消える糧、残る装備、その場限りの祭事。
  // NULL は物の出入りを伴わないただの出来事。
  ['log', 'goods', 'TEXT'],
  // 繰り返すプロセス。周期（日）を持つものが種で、そこから一回きりのプロセスが
  // 生えてくる。種そのものは棚にも一覧にも出さず、周期だけを持っている。
  ['mission', 'repeat_days', 'INTEGER'],
  // 種から生えたものが、どの種から来たか。NULL は自分で立てたもの。
  ['mission', 'repeat_of', 'INTEGER'],
  // 種がどの日付ぶんまで生やし終えたか（YYYY-MM-DD）。
  ['mission', 'repeat_through', 'TEXT'],
];

// 列を足す。pragma_table_info が使えない環境のために、重複エラーは握りつぶす。
export function applySchema(db) {
  db.exec(SCHEMA);
  db.exec(SETTINGS_ROW);
  for (const [table, column, definition] of ADDED_COLUMNS) {
    const exists = db
      .prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`)
      .get(table, column);
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  applyRewrites(db);
}

/* 列を足すだけでは済まない直し。何度走っても同じ結果になる形で書く。
   起動のたびに通るので、条件に合う行が無ければ実質ただの SELECT で済む。 */
function applyRewrites(db) {
  /* インゴットをやめ、アイデアに一本化した。同じ器に入っているので、
     印を外せばそのままアイデアになる。本文の列は残すので、書いたものは失われない。 */
  db.exec(`UPDATE idea SET is_spell = 0 WHERE is_spell = 1`);
}
