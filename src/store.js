import { db, transaction } from './db.js';
import { periods } from './period.js';

// タイムは分、ウォレットは円。どちらも整数で保持する。
const nowIso = () => new Date().toISOString();

function int(value, { min = 0 } = {}) {
  const n = Math.round(Number(value ?? 0));
  if (!Number.isFinite(n)) return min;
  return n < min ? min : n;
}

function requireTitle(title) {
  const trimmed = String(title ?? '').trim();
  if (!trimmed) {
    const err = new Error('title is required');
    err.status = 400;
    throw err;
  }
  return trimmed;
}

function notFound(what) {
  const err = new Error(`${what} not found`);
  err.status = 404;
  return err;
}

/* ---------- idea ---------- */

export function createIdea({ title, created_at }) {
  const stmt = db.prepare(`INSERT INTO idea (title, created_at) VALUES (?, ?)`);
  const { lastInsertRowid } = stmt.run(requireTitle(title), created_at || nowIso());
  return getIdea(Number(lastInsertRowid));
}

export function getIdea(id) {
  const row = db.prepare(`SELECT * FROM idea WHERE id = ?`).get(id);
  if (!row) throw notFound('idea');
  return { ...row, kind: 'idea', missions: listMissionsBySource('idea', id) };
}

export function updateIdea(id, { title }) {
  const row = db.prepare(`SELECT id FROM idea WHERE id = ?`).get(id);
  if (!row) throw notFound('idea');
  if (title !== undefined) {
    db.prepare(`UPDATE idea SET title = ? WHERE id = ?`).run(requireTitle(title), id);
  }
  return getIdea(id);
}

/* ---------- log ---------- */

export function createLog({ title, occurred_at, time_spent, money_spent, source_mission_id }) {
  const stmt = db.prepare(`
    INSERT INTO log (title, occurred_at, time_spent, money_spent, source_mission_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  const { lastInsertRowid } = stmt.run(
    requireTitle(title),
    occurred_at || nowIso(),
    int(time_spent),
    int(money_spent),
    source_mission_id ?? null,
  );
  return getLog(Number(lastInsertRowid));
}

export function getLog(id) {
  const row = db.prepare(`SELECT * FROM log WHERE id = ?`).get(id);
  if (!row) throw notFound('log');
  const source = row.source_mission_id
    ? db.prepare(`SELECT id, title, source_type, source_id FROM mission WHERE id = ?`)
        .get(row.source_mission_id) ?? null
    : null;
  return {
    ...row,
    kind: 'log',
    source_mission: source,
    missions: listMissionsBySource('log', id),
  };
}

export function updateLog(id, { title, occurred_at, time_spent, money_spent }) {
  const row = db.prepare(`SELECT * FROM log WHERE id = ?`).get(id);
  if (!row) throw notFound('log');

  db.prepare(`
    UPDATE log SET title = ?, occurred_at = ?, time_spent = ?, money_spent = ? WHERE id = ?
  `).run(
    title === undefined ? row.title : requireTitle(title),
    occurred_at === undefined ? row.occurred_at : occurred_at,
    time_spent === undefined ? row.time_spent : int(time_spent),
    money_spent === undefined ? row.money_spent : int(money_spent),
    id,
  );
  return getLog(id);
}

/* ---------- stream ---------- */

// アイデアとログを時系列で混ぜて返す。
export function listStream({ type = 'all', limit = 200 } = {}) {
  const parts = [];
  if (type === 'all' || type === 'idea') {
    parts.push(`
      SELECT 'idea' AS kind, i.id, i.title, i.created_at AS at,
             0 AS time_spent, 0 AS money_spent, 0 AS from_mission
      FROM idea i
    `);
  }
  if (type === 'all' || type === 'log') {
    parts.push(`
      SELECT 'log' AS kind, l.id, l.title, l.occurred_at AS at,
             l.time_spent, l.money_spent,
             CASE WHEN l.source_mission_id IS NULL THEN 0 ELSE 1 END AS from_mission
      FROM log l
    `);
  }
  if (parts.length === 0) return [];

  const rows = db
    .prepare(`${parts.join(' UNION ALL ')} ORDER BY at DESC, kind ASC, id DESC LIMIT ?`)
    .all(int(limit, { min: 1 }));

  const counts = db
    .prepare(`
      SELECT source_type, source_id, COUNT(*) AS total,
             SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active
      FROM mission GROUP BY source_type, source_id
    `)
    .all();
  const byKey = new Map(counts.map((c) => [`${c.source_type}:${c.source_id}`, c]));

  return rows.map((row) => {
    const c = byKey.get(`${row.kind}:${row.id}`);
    return {
      ...row,
      from_mission: Boolean(row.from_mission),
      mission_count: c ? c.total : 0,
      active_mission_count: c ? c.active : 0,
    };
  });
}

/* ---------- mission ---------- */

const MISSION_STATUSES = new Set(['active', 'abandoned', 'done']);

function sourceTitle(type, id) {
  const table = type === 'idea' ? 'idea' : 'log';
  const row = db.prepare(`SELECT title FROM ${table} WHERE id = ?`).get(id);
  return row ? row.title : null;
}

function decorate(mission) {
  return { ...mission, source_title: sourceTitle(mission.source_type, mission.source_id) };
}

export function createMission({ title, source_type, source_id, estimated_time, estimated_money }) {
  if (source_type !== 'idea' && source_type !== 'log') {
    const err = new Error('source_type must be "idea" or "log"');
    err.status = 400;
    throw err;
  }
  if (sourceTitle(source_type, source_id) === null) throw notFound(source_type);

  const { lastInsertRowid } = db
    .prepare(`
      INSERT INTO mission
        (title, source_type, source_id, status, estimated_time, estimated_money, created_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?)
    `)
    .run(
      requireTitle(title),
      source_type,
      int(source_id),
      int(estimated_time),
      int(estimated_money),
      nowIso(),
    );
  return getMission(Number(lastInsertRowid));
}

export function getMission(id) {
  const row = db.prepare(`SELECT * FROM mission WHERE id = ?`).get(id);
  if (!row) throw notFound('mission');
  return decorate(row);
}

export function listMissions({ status } = {}) {
  const rows = status
    ? db.prepare(`
        SELECT * FROM mission WHERE status = ?
        ORDER BY COALESCE(completed_at, created_at) DESC, id DESC
      `).all(status)
    : db.prepare(`
        SELECT * FROM mission
        ORDER BY COALESCE(completed_at, created_at) DESC, id DESC
      `).all();
  return rows.map(decorate);
}

export function listMissionsBySource(source_type, source_id) {
  return db
    .prepare(`
      SELECT * FROM mission WHERE source_type = ? AND source_id = ?
      ORDER BY created_at ASC, id ASC
    `)
    .all(source_type, source_id);
}

export function updateMission(id, { title, estimated_time, estimated_money }) {
  const row = db.prepare(`SELECT * FROM mission WHERE id = ?`).get(id);
  if (!row) throw notFound('mission');

  db.prepare(`UPDATE mission SET title = ?, estimated_time = ?, estimated_money = ? WHERE id = ?`)
    .run(
      title === undefined ? row.title : requireTitle(title),
      estimated_time === undefined ? row.estimated_time : int(estimated_time),
      estimated_money === undefined ? row.estimated_money : int(estimated_money),
      id,
    );
  return getMission(id);
}

// 完了：ログを自動生成し、見積もりを消費済みとして確定する。
export function completeMission(id) {
  return transaction(() => {
    const mission = db.prepare(`SELECT * FROM mission WHERE id = ?`).get(id);
    if (!mission) throw notFound('mission');
    if (mission.status === 'done') {
      const log = db.prepare(`SELECT * FROM log WHERE source_mission_id = ?`).get(id);
      return { mission: decorate(mission), log: log ?? null };
    }

    const at = nowIso();
    db.prepare(`UPDATE mission SET status = 'done', completed_at = ? WHERE id = ?`).run(at, id);

    const { lastInsertRowid } = db
      .prepare(`
        INSERT INTO log (title, occurred_at, time_spent, money_spent, source_mission_id)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(mission.title, at, mission.estimated_time, mission.estimated_money, id);

    return {
      mission: decorate(db.prepare(`SELECT * FROM mission WHERE id = ?`).get(id)),
      log: db.prepare(`SELECT * FROM log WHERE id = ?`).get(Number(lastInsertRowid)),
    };
  });
}

// 断念：消費予定から外す。ログは生成しない。
export function abandonMission(id) {
  const row = db.prepare(`SELECT * FROM mission WHERE id = ?`).get(id);
  if (!row) throw notFound('mission');
  if (row.status === 'done') {
    const err = new Error('completed mission cannot be abandoned');
    err.status = 409;
    throw err;
  }
  db.prepare(`UPDATE mission SET status = 'abandoned', completed_at = NULL WHERE id = ?`).run(id);
  return getMission(id);
}

// 進行中に戻す（断念の取り消し）。
export function reopenMission(id) {
  const row = db.prepare(`SELECT * FROM mission WHERE id = ?`).get(id);
  if (!row) throw notFound('mission');
  if (row.status === 'done') {
    const err = new Error('completed mission cannot be reopened');
    err.status = 409;
    throw err;
  }
  db.prepare(`UPDATE mission SET status = 'active', completed_at = NULL WHERE id = ?`).run(id);
  return getMission(id);
}

export function isMissionStatus(status) {
  return MISSION_STATUSES.has(status);
}

/* ---------- settings ---------- */

export function getSettings() {
  return db.prepare(`SELECT weekly_time, monthly_money FROM settings WHERE id = 1`).get();
}

export function updateSettings({ weekly_time, monthly_money }) {
  const current = getSettings();
  db.prepare(`UPDATE settings SET weekly_time = ?, monthly_money = ? WHERE id = 1`).run(
    weekly_time === undefined ? current.weekly_time : int(weekly_time),
    monthly_money === undefined ? current.monthly_money : int(monthly_money),
  );
  return getSettings();
}

/* ---------- budget（期間ごとの可処分量） ---------- */

// 既定値（settings）のどの列が、どちらのリソースに対応するか。
const DEFAULT_COLUMN = { time: 'weekly_time', money: 'monthly_money' };
const SPENT_COLUMN = { time: 'time_spent', money: 'money_spent' };

export function isBudgetKind(kind) {
  return kind === 'time' || kind === 'money';
}

function requireKind(kind) {
  if (!isBudgetKind(kind)) {
    const err = new Error('kind must be "time" or "money"');
    err.status = 400;
    throw err;
  }
  return kind;
}

// 期間キーを正規化した上で検証する。週キーは月曜日でなければ受け付けない。
function requirePeriod(kind, periodKey) {
  const period = periods[kind].fromKey(periodKey);
  if (!period || period.key !== periodKey) {
    const err = new Error('invalid period key');
    err.status = 400;
    throw err;
  }
  return period;
}

// その期間の可処分量。個別設定があればそれを、無ければ既定値を返す。
export function resolveBudget(kind, periodKey) {
  requireKind(kind);
  const row = db
    .prepare(`SELECT amount FROM budget WHERE kind = ? AND period_key = ?`)
    .get(kind, periodKey);
  if (row) return { amount: row.amount, source: 'override' };
  return { amount: getSettings()[DEFAULT_COLUMN[kind]], source: 'default' };
}

function consumedIn(kind, period) {
  return db
    .prepare(`
      SELECT COALESCE(SUM(${SPENT_COLUMN[kind]}), 0) AS total
      FROM log WHERE occurred_at >= ? AND occurred_at < ?
    `)
    .get(period.start, period.end).total;
}

// 直近の期間に、個別設定を持つ期間を足して一覧にする。
export function listBudgets(kind, { past = 5, future = 1 } = {}) {
  requireKind(kind);
  const scale = periods[kind];
  const current = scale.of();
  const back = Math.min(Math.max(int(past), 0), 60);
  const ahead = Math.min(Math.max(int(future), 0), 12);

  const found = new Map();
  for (let offset = -back; offset <= ahead; offset += 1) {
    const period = scale.shift(current.key, offset);
    if (period) found.set(period.key, period);
  }
  for (const row of db.prepare(`SELECT period_key FROM budget WHERE kind = ?`).all(kind)) {
    const period = scale.fromKey(row.period_key);
    if (period) found.set(period.key, period);
  }

  return [...found.values()]
    .sort((a, b) => b.start.localeCompare(a.start))
    .map((period) => {
      const budget = resolveBudget(kind, period.key);
      return {
        ...period,
        amount: budget.amount,
        source: budget.source,
        consumed: consumedIn(kind, period),
        is_current: period.key === current.key,
      };
    });
}

export function setBudget(kind, periodKey, amount) {
  requireKind(kind);
  const period = requirePeriod(kind, periodKey);
  db.prepare(`
    INSERT INTO budget (kind, period_key, amount) VALUES (?, ?, ?)
    ON CONFLICT (kind, period_key) DO UPDATE SET amount = excluded.amount
  `).run(kind, period.key, int(amount));
  return { kind, ...period, ...resolveBudget(kind, period.key) };
}

// 個別設定を消して既定値に戻す。
export function clearBudget(kind, periodKey) {
  requireKind(kind);
  const period = requirePeriod(kind, periodKey);
  db.prepare(`DELETE FROM budget WHERE kind = ? AND period_key = ?`).run(kind, period.key);
  return { kind, ...period, ...resolveBudget(kind, period.key) };
}

/* ---------- summary（ホームのタンク） ---------- */

export function getSummary(now = new Date()) {
  const week = periods.time.of(now);
  const month = periods.money.of(now);
  const timeBudget = resolveBudget('time', week.key);
  const moneyBudget = resolveBudget('money', month.key);

  const spent = (period) =>
    db
      .prepare(`
        SELECT COALESCE(SUM(time_spent), 0) AS time, COALESCE(SUM(money_spent), 0) AS money
        FROM log WHERE occurred_at >= ? AND occurred_at < ?
      `)
      .get(period.start, period.end);

  // 消費予定は「これからやること」なので期間で絞らず、進行中ミッション全体を対象にする。
  const planned = db
    .prepare(`
      SELECT COALESCE(SUM(estimated_time), 0) AS time,
             COALESCE(SUM(estimated_money), 0) AS money,
             COUNT(*) AS count
      FROM mission WHERE status = 'active'
    `)
    .get();

  const build = (budget, consumed, plannedValue, period) => ({
    budget,
    consumed,
    planned: plannedValue,
    // 進行中ミッションを全て完了した場合の残量
    remaining: budget - consumed - plannedValue,
    remaining_now: budget - consumed,
    over: consumed + plannedValue > budget,
    period,
  });

  return {
    time: {
      unit: 'minutes',
      ...build(timeBudget.amount, spent(week).time, planned.time, week),
      budget_source: timeBudget.source,
    },
    money: {
      unit: 'jpy',
      ...build(moneyBudget.amount, spent(month).money, planned.money, month),
      budget_source: moneyBudget.source,
    },
    active_mission_count: planned.count,
  };
}
