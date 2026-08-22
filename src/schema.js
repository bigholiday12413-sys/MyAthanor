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
  /* ログの出どころ。どのアイデア（またはログ）から来たか。
     プロセスは「予定」、ログは「行ったこと」で、同じものの前後の姿。
     完了するとプロセスはログに移るので、出どころもログ側が持つ。 */
  ['log', 'source_type', 'TEXT'],
  ['log', 'source_id', 'INTEGER'],
  // どの循環の種から来たか。固定費として先に引いてあるので、消費済みには数えない。
  ['log', 'repeat_of', 'INTEGER'],
  /* アイデアそのものの終わり。子のプロセスではなく、アイデア自体を完了したという印。
     完了すると金色の宝石としてログに残る。 */
  ['mission', 'is_conclusion', 'INTEGER NOT NULL DEFAULT 0'],
  ['log', 'is_conclusion', 'INTEGER NOT NULL DEFAULT 0'],
  /* 入ってきた額。出ていく額（money_spent）と同じ列に入れると、
     消費済みを数えている場所すべてが収入を出費として拾ってしまう。
     列を分けておけば、今までの合計は何も直さなくても正しいままになる。 */
  ['log', 'money_gained', 'INTEGER NOT NULL DEFAULT 0'],
  /* 装備を失った日時。NULL なら手元にある。
     糧は食べれば消え、祭事は見聞が残るだけなので、失えるのは装備だけ。 */
  ['log', 'lost_at', 'TEXT'],
  /* 見積ウォレットの向き。1 なら出ていくのではなく入ってくる。
     収入は「買ったものの別」ではなくプロセスの結果なので、額の向きは
     プロセスが持ち、完了したときログの入ってくる側へ移る。 */
  ['mission', 'money_is_gain', 'INTEGER NOT NULL DEFAULT 0'],
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

  /* プロセス（予定）とログ（行ったこと）を、同じものの前後の姿に揃えた。
     完了したプロセスは、ログに移ってからは要らない。

     いまは完了のたびにログを作りつつプロセスも残していたので、同じ1件が
     2つの器に居る。ログ側へ出どころと輝きを写してから、残ったプロセスを畳む。
     写してから消すので、どのアイデアから来たかは失われない。 */
  db.exec(`
    UPDATE log SET
      source_type = COALESCE(source_type,
        (SELECT m.source_type FROM mission m WHERE m.id = log.source_mission_id)),
      source_id = COALESCE(source_id,
        (SELECT m.source_id FROM mission m WHERE m.id = log.source_mission_id))
    WHERE source_mission_id IS NOT NULL AND source_type IS NULL
  `);
  db.exec(`
    UPDATE log SET repeat_of = (
      SELECT m.repeat_of FROM mission m WHERE m.id = log.source_mission_id
    )
    WHERE source_mission_id IS NOT NULL AND repeat_of IS NULL
  `);
  db.exec(`
    UPDATE log SET is_legacy = 1
    WHERE is_legacy = 0 AND source_mission_id IN (SELECT id FROM mission WHERE is_legacy = 1)
  `);
  db.exec(`
    DELETE FROM mission WHERE status = 'done'
      AND id IN (SELECT source_mission_id FROM log WHERE source_mission_id IS NOT NULL)
  `);

  /* 収入を「別」として持つのをやめた。入ってくる額はプロセスの結果で、
     糧・装備・祭事のような買ったものの別とは並ばない。
     印だけ外して、入ってきた額（money_gained）はそのまま残す。
     こうすると別を付けていないログ＝プロセスの顔に戻り、
     額は＋付きで出たまま、集計も何も変わらない。 */
  db.exec(`UPDATE log SET goods = NULL WHERE goods = 'income'`);

  /* 30分刻みへ揃えるのは記録の見た目を整えるだけの直しで、
     これができないからといって起動を止める理由が無い。
     applySchema は db.js の読み込みで走るため、ここで投げると
     サーバごと立ち上がらなくなる。見送っても他の直しと列は入っている。 */
  try {
    alignToHalfHour(db);
  } catch (err) {
    console.warn('30分刻みへの整えを見送りました:', err.message);
  }
}

/* 入力を30分刻みの選択式にし、刻み外れの選択肢を出さないことにしたので、
   既存の値のほうを刻みに揃える。最寄りの30分へ丸める
   （切り捨てだと最大29分ずれる）。
   揃っている行は WHERE で弾かれるので、毎起動でも実質何もしない。 */
function alignToHalfHour(db) {
  /* 日時。丸めた先が SQLite で表せない日付（年9999の直前など）になる行は、
     strftime が NULL を返す。日時の列は NOT NULL なので、そのまま入れると
     起動が落ちる。COALESCE で元の値に落とし、その行だけ揃えないでおく。 */
  for (const [table, column] of [['idea', 'created_at'], ['log', 'occurred_at']]) {
    db.exec(`
      UPDATE ${table} SET ${column} = COALESCE(strftime(
        '%Y-%m-%dT%H:%M:00.000Z',
        ((CAST(strftime('%s', ${column}) AS INTEGER) + 900) / 1800) * 1800,
        'unixepoch'
      ), ${column})
      WHERE CAST(strftime('%s', ${column}) AS INTEGER) % 1800 != 0
    `);
  }

  /* 分の列（見積・消費・タイム予算）。CAST で整数に落としてから掛ける。
     SQLite の / は片方が小数だと小数のままなので、落とさないと
     丸めた値がまた刻みから外れ、起動のたびに増え続ける。 */
  for (const [table, column] of [
    ['mission', 'estimated_time'],
    ['log', 'time_spent'],
    ['settings', 'weekly_time'],
  ]) {
    db.exec(`
      UPDATE ${table} SET ${column} = CAST((${column} + 15) / 30 AS INTEGER) * 30
      WHERE ${column} % 30 != 0
    `);
  }
  db.exec(`
    UPDATE budget SET amount = CAST((amount + 15) / 30 AS INTEGER) * 30
    WHERE kind = 'time' AND amount % 30 != 0
  `);
}
