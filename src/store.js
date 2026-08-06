import { db, transaction } from './db.js';
import {
  periods,
  addDays,
  dateKey,
  parseDateKey,
  daysInMonth,
  weekdayIndex,
} from './period.js';

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

/* ---------- tag ---------- */

const ENTRY_KINDS = new Set(['idea', 'log']);

function requireEntryKind(kind) {
  if (!ENTRY_KINDS.has(kind)) {
    const err = new Error('kind must be "idea" or "log"');
    err.status = 400;
    throw err;
  }
  return kind;
}

// 表記ゆれで別タグにならないよう、前後の空白と連続空白を潰す。
function normalizeTagName(name) {
  const trimmed = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) {
    const err = new Error('tag name is required');
    err.status = 400;
    throw err;
  }
  if (trimmed.length > 24) {
    const err = new Error('tag name must be 24 characters or fewer');
    err.status = 400;
    throw err;
  }
  return trimmed;
}

function findOrCreateTag(name) {
  const normalized = normalizeTagName(name);
  const existing = db.prepare(`SELECT * FROM tag WHERE name = ?`).get(normalized);
  if (existing) return existing;
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO tag (name, created_at) VALUES (?, ?)`)
    .run(normalized, nowIso());
  return db.prepare(`SELECT * FROM tag WHERE id = ?`).get(Number(lastInsertRowid));
}

export function listTags() {
  return db
    .prepare(`
      SELECT t.id, t.name,
             COALESCE(SUM(CASE WHEN e.kind = 'idea' THEN 1 ELSE 0 END), 0) AS idea_count,
             COALESCE(SUM(CASE WHEN e.kind = 'log' THEN 1 ELSE 0 END), 0) AS log_count,
             COUNT(e.tag_id) AS total
      FROM tag t
      LEFT JOIN entry_tag e ON e.tag_id = t.id
      GROUP BY t.id
      ORDER BY total DESC, t.name ASC
    `)
    .all();
}

export function createTag({ name }) {
  return findOrCreateTag(name);
}

export function renameTag(id, { name }) {
  const row = db.prepare(`SELECT * FROM tag WHERE id = ?`).get(id);
  if (!row) throw notFound('tag');
  const normalized = normalizeTagName(name);
  const clash = db.prepare(`SELECT id FROM tag WHERE name = ? AND id <> ?`).get(normalized, id);
  if (clash) {
    const err = new Error('a tag with that name already exists');
    err.status = 409;
    throw err;
  }
  db.prepare(`UPDATE tag SET name = ? WHERE id = ?`).run(normalized, id);
  return db.prepare(`SELECT * FROM tag WHERE id = ?`).get(id);
}

export function deleteTag(id) {
  const row = db.prepare(`SELECT * FROM tag WHERE id = ?`).get(id);
  if (!row) throw notFound('tag');
  return transaction(() => {
    db.prepare(`DELETE FROM entry_tag WHERE tag_id = ?`).run(id);
    db.prepare(`DELETE FROM tag WHERE id = ?`).run(id);
    return { id, deleted: true };
  });
}

export function tagsFor(kind, entryId) {
  return db
    .prepare(`
      SELECT t.id, t.name FROM entry_tag e
      JOIN tag t ON t.id = e.tag_id
      WHERE e.kind = ? AND e.entry_id = ?
      ORDER BY t.name ASC
    `)
    .all(kind, entryId);
}

// 名前の配列でまるごと置き換える。無い名前は作る。
export function setEntryTags(kind, entryId, names) {
  requireEntryKind(kind);
  if (kind === 'idea') getIdea(entryId);
  else getLog(entryId);
  if (!Array.isArray(names)) {
    const err = new Error('tags must be an array of names');
    err.status = 400;
    throw err;
  }

  return transaction(() => {
    const ids = new Set(names.map((name) => findOrCreateTag(name).id));
    db.prepare(`DELETE FROM entry_tag WHERE kind = ? AND entry_id = ?`).run(kind, entryId);
    const insert = db.prepare(
      `INSERT OR IGNORE INTO entry_tag (kind, entry_id, tag_id) VALUES (?, ?, ?)`,
    );
    for (const tagId of ids) insert.run(kind, entryId, tagId);
    return tagsFor(kind, entryId);
  });
}

/* ---------- アイデアの温度 ---------- */

// 273K（水の凝固点）を常温＝基準とする。設定した熱は基準へ向かって指数的に冷める。
export const AMBIENT_K = 273;
export const MAX_K = 373;

// 半減期ぶんの日数が経つごとに、基準からの差が半分になる。
// halfLife を渡さなければ設定から読む（一覧では読み直しを避けるため渡す）。
export function coolTemperature(setK, setAt, now = new Date(), halfLifeDays = null) {
  const halfLife = halfLifeDays ?? getSettings().cooling_half_life_days;
  const excess = setK - AMBIENT_K;
  if (halfLife <= 0 || excess <= 0) return setK;

  const elapsedDays = (now.getTime() - new Date(setAt).getTime()) / 86_400_000;
  if (!Number.isFinite(elapsedDays) || elapsedDays <= 0) return setK;

  return Math.round(AMBIENT_K + excess * 0.5 ** (elapsedDays / halfLife));
}

function withTemperature(idea, now = new Date()) {
  const setAt = idea.temperature_at ?? idea.created_at;
  return {
    ...idea,
    temperature_at: setAt,
    current_temperature: coolTemperature(idea.temperature, setAt, now),
  };
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
  return {
    ...withTemperature(row),
    kind: 'idea',
    tags: tagsFor('idea', id),
    missions: listMissionsBySource('idea', id),
  };
}

export function updateIdea(id, { title, temperature }) {
  const row = db.prepare(`SELECT * FROM idea WHERE id = ?`).get(id);
  if (!row) throw notFound('idea');
  if (title !== undefined) {
    db.prepare(`UPDATE idea SET title = ? WHERE id = ?`).run(requireTitle(title), id);
  }
  if (temperature !== undefined) {
    // 熱を入れ直したら冷却の起点も今にする。
    const kelvin = Math.min(Math.max(int(temperature), AMBIENT_K), MAX_K);
    db.prepare(`UPDATE idea SET temperature = ?, temperature_at = ? WHERE id = ?`)
      .run(kelvin, nowIso(), id);
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
  const recurrence = row.source_recurrence_id
    ? db.prepare(`SELECT id, title FROM recurrence WHERE id = ?`).get(row.source_recurrence_id) ??
      null
    : null;
  return {
    ...row,
    kind: 'log',
    source_mission: source,
    source_recurrence: recurrence,
    tags: tagsFor('log', id),
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
export function listStream({ type = 'all', limit = 200, tag = null } = {}) {
  const parts = [];
  if (type === 'all' || type === 'idea') {
    parts.push(`
      SELECT 'idea' AS kind, i.id, i.title, i.created_at AS at,
             0 AS time_spent, 0 AS money_spent, 0 AS from_mission, 0 AS from_recurrence,
             i.temperature, i.temperature_at
      FROM idea i
    `);
  }
  if (type === 'all' || type === 'log') {
    parts.push(`
      SELECT 'log' AS kind, l.id, l.title, l.occurred_at AS at,
             l.time_spent, l.money_spent,
             CASE WHEN l.source_mission_id IS NULL THEN 0 ELSE 1 END AS from_mission,
             CASE WHEN l.source_recurrence_id IS NULL THEN 0 ELSE 1 END AS from_recurrence,
             NULL AS temperature, NULL AS temperature_at
      FROM log l
    `);
  }
  if (parts.length === 0) return [];

  const rows = db
    .prepare(`${parts.join(' UNION ALL ')} ORDER BY at DESC, kind ASC, id DESC LIMIT ?`)
    .all(int(limit, { min: 1 }));

  const links = db
    .prepare(`
      SELECT e.kind, e.entry_id, t.id, t.name FROM entry_tag e
      JOIN tag t ON t.id = e.tag_id
      ORDER BY t.name ASC
    `)
    .all();
  const tagsByEntry = new Map();
  for (const link of links) {
    const key = `${link.kind}:${link.entry_id}`;
    if (!tagsByEntry.has(key)) tagsByEntry.set(key, []);
    tagsByEntry.get(key).push({ id: link.id, name: link.name });
  }

  const counts = db
    .prepare(`
      SELECT source_type, source_id, COUNT(*) AS total,
             SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active
      FROM mission GROUP BY source_type, source_id
    `)
    .all();
  const byKey = new Map(counts.map((c) => [`${c.source_type}:${c.source_id}`, c]));

  const now = new Date();
  const halfLife = getSettings().cooling_half_life_days;
  const tagId = tag === null || tag === undefined || tag === '' ? null : int(tag);

  return rows
    .map((row) => {
      const c = byKey.get(`${row.kind}:${row.id}`);
      const tags = tagsByEntry.get(`${row.kind}:${row.id}`) ?? [];
      return {
        ...row,
        from_mission: Boolean(row.from_mission),
        from_recurrence: Boolean(row.from_recurrence),
        tags,
        current_temperature:
          row.kind === 'idea'
            ? coolTemperature(row.temperature, row.temperature_at ?? row.at, now, halfLife)
            : null,
        mission_count: c ? c.total : 0,
        active_mission_count: c ? c.active : 0,
      };
    })
    .filter((row) => tagId === null || row.tags.some((t) => t.id === tagId));
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
  return db
    .prepare(`SELECT weekly_time, monthly_money, cooling_half_life_days FROM settings WHERE id = 1`)
    .get();
}

export function updateSettings({ weekly_time, monthly_money, cooling_half_life_days }) {
  const current = getSettings();
  db.prepare(`
    UPDATE settings SET weekly_time = ?, monthly_money = ?, cooling_half_life_days = ?
    WHERE id = 1
  `).run(
    weekly_time === undefined ? current.weekly_time : int(weekly_time),
    monthly_money === undefined ? current.monthly_money : int(monthly_money),
    cooling_half_life_days === undefined
      ? current.cooling_half_life_days
      : int(cooling_half_life_days),
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

/* ---------- recurrence（定期イベント） ---------- */

// 初回同期で遡る上限。開始日をうんと過去にしても大量生成にならないようにする。
const BACKFILL_LIMIT_DAYS = 366;

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function requireDateKey(value, label) {
  const date = parseDateKey(value);
  if (!date) throw badRequest(`${label} must be YYYY-MM-DD`);
  return date;
}

// 定義の妥当性を確認し、DB に入れる形に正規化する。
function normalizeRecurrence(input, base = null) {
  const freq = input.freq ?? base?.freq;
  if (!['daily', 'weekly', 'monthly'].includes(freq)) {
    throw badRequest('freq must be daily, weekly or monthly');
  }

  let weekday = null;
  if (freq === 'weekly') {
    const value = input.weekday ?? base?.weekday;
    weekday = int(value);
    if (value === undefined || value === null || weekday < 0 || weekday > 6) {
      throw badRequest('weekday must be 0 (Mon) .. 6 (Sun)');
    }
  }

  let monthDay = null;
  if (freq === 'monthly') {
    const value = input.month_day ?? base?.month_day;
    monthDay = int(value);
    if (value === undefined || value === null || monthDay < 1 || monthDay > 31) {
      throw badRequest('month_day must be 1..31');
    }
  }

  const startKey = input.start_date ?? base?.start_date ?? dateKey(new Date());
  const start = requireDateKey(startKey, 'start_date');

  const endInput = input.end_date === undefined ? base?.end_date ?? null : input.end_date;
  const endKey = endInput === null || endInput === '' ? null : endInput;
  if (endKey !== null) {
    const end = requireDateKey(endKey, 'end_date');
    if (end < start) throw badRequest('end_date must not be before start_date');
  }

  return {
    title: requireTitle(input.title ?? base?.title),
    freq,
    weekday,
    month_day: monthDay,
    time_spent: int(input.time_spent ?? base?.time_spent ?? 0),
    money_spent: int(input.money_spent ?? base?.money_spent ?? 0),
    start_date: dateKey(start),
    end_date: endKey,
    active: (input.active ?? base?.active ?? 1) ? 1 : 0,
  };
}

// [from, to]（両端含む・ローカル日付）に含まれる開催日を列挙する。
function scheduleDates(recurrence, from, to) {
  const start = parseDateKey(recurrence.start_date);
  const end = recurrence.end_date ? parseDateKey(recurrence.end_date) : null;
  if (!start) return [];

  const first = from > start ? from : start;
  const last = end && end < to ? end : to;
  if (first > last) return [];

  const dates = [];
  const guard = 2000;

  if (recurrence.freq === 'daily') {
    for (let d = first; d <= last && dates.length < guard; d = addDays(d, 1)) {
      dates.push(dateKey(d));
    }
    return dates;
  }

  if (recurrence.freq === 'weekly') {
    const shift = (recurrence.weekday - weekdayIndex(first) + 7) % 7;
    for (let d = addDays(first, shift); d <= last && dates.length < guard; d = addDays(d, 7)) {
      dates.push(dateKey(d));
    }
    return dates;
  }

  // monthly: 無い日付（2月31日など）はその月の末日に寄せる
  let cursor = new Date(first.getFullYear(), first.getMonth(), 1);
  while (cursor <= last && dates.length < guard) {
    const day = Math.min(
      recurrence.month_day,
      daysInMonth(cursor.getFullYear(), cursor.getMonth()),
    );
    const date = new Date(cursor.getFullYear(), cursor.getMonth(), day);
    if (date >= first && date <= last) dates.push(dateKey(date));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return dates;
}

function isScheduled(recurrence, key) {
  const date = parseDateKey(key);
  if (!date) return false;
  return scheduleDates(recurrence, date, date).length === 1;
}

function getOccurrenceRow(recurrenceId, key) {
  return db
    .prepare(`SELECT * FROM occurrence WHERE recurrence_id = ? AND date = ?`)
    .get(recurrenceId, key);
}

// 定義の値に、その回の上書きを重ねた実効値。
function effectiveValues(recurrence, occurrence) {
  return {
    title: occurrence?.title ?? recurrence.title,
    time_spent: occurrence?.time_spent ?? recurrence.time_spent,
    money_spent: occurrence?.money_spent ?? recurrence.money_spent,
  };
}

function writeLogForOccurrence(recurrence, key, occurrence) {
  const values = effectiveValues(recurrence, occurrence);
  const occurredAt = parseDateKey(key).toISOString();
  const { lastInsertRowid } = db
    .prepare(`
      INSERT INTO log (title, occurred_at, time_spent, money_spent, source_recurrence_id)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(values.title, occurredAt, values.time_spent, values.money_spent, recurrence.id);

  db.prepare(`
    INSERT INTO occurrence (recurrence_id, date, status, log_id) VALUES (?, ?, 'scheduled', ?)
    ON CONFLICT (recurrence_id, date) DO UPDATE SET log_id = excluded.log_id
  `).run(recurrence.id, key, Number(lastInsertRowid));

  return Number(lastInsertRowid);
}

// 開催日が来た回をログにする。スキップ済み・ログ化済みは触らない。
export function syncRecurrences(now = new Date()) {
  const active = db.prepare(`SELECT * FROM recurrence WHERE active = 1`).all();
  if (active.length === 0) return 0;

  const todayKey = dateKey(now);
  const today = parseDateKey(todayKey);
  const floor = addDays(today, -BACKFILL_LIMIT_DAYS);

  return transaction(() => {
    let created = 0;
    for (const recurrence of active) {
      const resume = recurrence.materialized_through
        ? addDays(parseDateKey(recurrence.materialized_through), 1)
        : parseDateKey(recurrence.start_date);
      const from = resume > floor ? resume : floor;
      if (from > today) continue;

      for (const key of scheduleDates(recurrence, from, today)) {
        const occurrence = getOccurrenceRow(recurrence.id, key);
        if (occurrence?.status === 'skipped' || occurrence?.log_id) continue;
        writeLogForOccurrence(recurrence, key, occurrence);
        created += 1;
      }
      db.prepare(`UPDATE recurrence SET materialized_through = ? WHERE id = ?`)
        .run(todayKey, recurrence.id);
    }
    return created;
  });
}

function decorateRecurrence(recurrence, now = new Date()) {
  const today = parseDateKey(dateKey(now));
  const horizon = addDays(today, 400);
  const next = scheduleDates(recurrence, addDays(today, 1), horizon).find(
    (key) => getOccurrenceRow(recurrence.id, key)?.status !== 'skipped',
  );
  return { ...recurrence, active: Boolean(recurrence.active), next_date: next ?? null };
}

export function listRecurrences() {
  return db
    .prepare(`SELECT * FROM recurrence ORDER BY active DESC, id DESC`)
    .all()
    .map((row) => decorateRecurrence(row));
}

export function getRecurrence(id) {
  const row = db.prepare(`SELECT * FROM recurrence WHERE id = ?`).get(id);
  if (!row) throw notFound('recurrence');
  return decorateRecurrence(row);
}

export function createRecurrence(input) {
  const values = normalizeRecurrence(input ?? {});
  const { lastInsertRowid } = db
    .prepare(`
      INSERT INTO recurrence
        (title, freq, weekday, month_day, time_spent, money_spent,
         start_date, end_date, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      values.title,
      values.freq,
      values.weekday,
      values.month_day,
      values.time_spent,
      values.money_spent,
      values.start_date,
      values.end_date,
      values.active,
      new Date().toISOString(),
    );
  syncRecurrences();
  return getRecurrence(Number(lastInsertRowid));
}

export function updateRecurrence(id, input) {
  const current = db.prepare(`SELECT * FROM recurrence WHERE id = ?`).get(id);
  if (!current) throw notFound('recurrence');
  const values = normalizeRecurrence(input ?? {}, current);

  db.prepare(`
    UPDATE recurrence
       SET title = ?, freq = ?, weekday = ?, month_day = ?, time_spent = ?,
           money_spent = ?, start_date = ?, end_date = ?, active = ?
     WHERE id = ?
  `).run(
    values.title,
    values.freq,
    values.weekday,
    values.month_day,
    values.time_spent,
    values.money_spent,
    values.start_date,
    values.end_date,
    values.active,
    id,
  );
  syncRecurrences();
  return getRecurrence(id);
}

// 定義を消しても、生成済みのログは記録として残す。
export function deleteRecurrence(id) {
  const current = db.prepare(`SELECT * FROM recurrence WHERE id = ?`).get(id);
  if (!current) throw notFound('recurrence');
  return transaction(() => {
    db.prepare(`DELETE FROM occurrence WHERE recurrence_id = ?`).run(id);
    db.prepare(`DELETE FROM recurrence WHERE id = ?`).run(id);
    return { id, deleted: true };
  });
}

// 直近の回を、過去 back 回・先 ahead 回ぶん並べる。
export function listOccurrences(recurrenceId, { back = 4, ahead = 4 } = {}) {
  const recurrence = db.prepare(`SELECT * FROM recurrence WHERE id = ?`).get(recurrenceId);
  if (!recurrence) throw notFound('recurrence');

  const backCount = Math.min(Math.max(int(back), 0), 60);
  const aheadCount = Math.min(Math.max(int(ahead), 0), 60);
  const todayKey = dateKey(new Date());
  const today = parseDateKey(todayKey);

  // 頻度に応じて十分広い範囲を取ってから、今日の前後で切り出す。
  const span = { daily: 1, weekly: 7, monthly: 31 }[recurrence.freq];
  const all = scheduleDates(
    recurrence,
    addDays(today, -span * (backCount + 2)),
    addDays(today, span * (aheadCount + 2)),
  );
  const past = all.filter((key) => key <= todayKey).slice(-backCount);
  const future = all.filter((key) => key > todayKey).slice(0, aheadCount);

  return [...past, ...future]
    .reverse()
    .map((key) => {
      const occurrence = getOccurrenceRow(recurrenceId, key);
      const values = effectiveValues(recurrence, occurrence);
      return {
        recurrence_id: recurrenceId,
        date: key,
        status: occurrence?.status ?? 'scheduled',
        ...values,
        log_id: occurrence?.log_id ?? null,
        is_overridden: Boolean(
          occurrence &&
            (occurrence.title !== null ||
              occurrence.time_spent !== null ||
              occurrence.money_spent !== null),
        ),
        is_past: key <= todayKey,
      };
    });
}

// その回だけ値を変える／スキップする。ログ化済みならログにも反映する。
export function updateOccurrence(recurrenceId, key, input) {
  const recurrence = db.prepare(`SELECT * FROM recurrence WHERE id = ?`).get(recurrenceId);
  if (!recurrence) throw notFound('recurrence');
  if (!isScheduled(recurrence, key)) throw badRequest('date is not a scheduled occurrence');

  const status = input.status ?? undefined;
  if (status !== undefined && !['scheduled', 'skipped'].includes(status)) {
    throw badRequest('status must be scheduled or skipped');
  }

  return transaction(() => {
    const current = getOccurrenceRow(recurrenceId, key);
    const next = {
      status: status ?? current?.status ?? 'scheduled',
      title:
        input.title === undefined
          ? current?.title ?? null
          : input.title === null || input.title === ''
            ? null
            : requireTitle(input.title),
      time_spent:
        input.time_spent === undefined
          ? current?.time_spent ?? null
          : input.time_spent === null
            ? null
            : int(input.time_spent),
      money_spent:
        input.money_spent === undefined
          ? current?.money_spent ?? null
          : input.money_spent === null
            ? null
            : int(input.money_spent),
    };

    db.prepare(`
      INSERT INTO occurrence (recurrence_id, date, status, title, time_spent, money_spent, log_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (recurrence_id, date) DO UPDATE
        SET status = excluded.status, title = excluded.title,
            time_spent = excluded.time_spent, money_spent = excluded.money_spent
    `).run(
      recurrenceId,
      key,
      next.status,
      next.title,
      next.time_spent,
      next.money_spent,
      current?.log_id ?? null,
    );

    const logId = current?.log_id ?? null;
    const values = effectiveValues(recurrence, next);

    if (next.status === 'skipped') {
      // 行かなかった回。生成済みのログは取り消す。
      if (logId) {
        db.prepare(`DELETE FROM log WHERE id = ?`).run(logId);
        db.prepare(`UPDATE occurrence SET log_id = NULL WHERE recurrence_id = ? AND date = ?`)
          .run(recurrenceId, key);
      }
    } else if (logId) {
      db.prepare(`UPDATE log SET title = ?, time_spent = ?, money_spent = ? WHERE id = ?`)
        .run(values.title, values.time_spent, values.money_spent, logId);
    } else if (key <= dateKey(new Date())) {
      // スキップを取り消した過去の回は、その場でログに戻す。
      writeLogForOccurrence(recurrence, key, getOccurrenceRow(recurrenceId, key));
    }

    return listOccurrences(recurrenceId).find((row) => row.date === key) ?? null;
  });
}

// その回の個別変更を取り消し、定義どおりに戻す。
export function resetOccurrence(recurrenceId, key) {
  const recurrence = db.prepare(`SELECT * FROM recurrence WHERE id = ?`).get(recurrenceId);
  if (!recurrence) throw notFound('recurrence');
  if (!isScheduled(recurrence, key)) throw badRequest('date is not a scheduled occurrence');

  return updateOccurrence(recurrenceId, key, {
    status: 'scheduled',
    title: null,
    time_spent: null,
    money_spent: null,
  });
}

// 期間内のこれから起きる回（明日以降）の合計。今日ぶんは既にログなので数えない。
function plannedRecurring(period, now) {
  const today = parseDateKey(dateKey(now));
  const from = addDays(today, 1);
  const to = new Date(new Date(period.end).getTime() - 1);
  const totals = { time: 0, money: 0 };
  if (from > to) return totals;

  for (const recurrence of db.prepare(`SELECT * FROM recurrence WHERE active = 1`).all()) {
    for (const key of scheduleDates(recurrence, from, to)) {
      const occurrence = getOccurrenceRow(recurrence.id, key);
      if (occurrence?.status === 'skipped') continue;
      const values = effectiveValues(recurrence, occurrence);
      totals.time += values.time_spent;
      totals.money += values.money_spent;
    }
  }
  return totals;
}

/* ---------- レガシー ---------- */

// 大事なものに印をつける。ミッションは完了したものだけ。
export function setLegacy(kind, id, value) {
  if (kind !== 'log' && kind !== 'mission') {
    throw badRequest('kind must be "log" or "mission"');
  }
  const row = db.prepare(`SELECT * FROM ${kind} WHERE id = ?`).get(id);
  if (!row) throw notFound(kind);
  if (kind === 'mission' && row.status !== 'done' && value) {
    const err = new Error('only completed missions can be marked as legacy');
    err.status = 409;
    throw err;
  }
  db.prepare(`UPDATE ${kind} SET is_legacy = ? WHERE id = ?`).run(value ? 1 : 0, id);
  return kind === 'log' ? getLog(id) : getMission(id);
}

export function listLegacies() {
  const logs = db
    .prepare(`SELECT * FROM log WHERE is_legacy = 1 ORDER BY occurred_at DESC`)
    .all()
    .map((row) => ({ ...row, type: 'log', at: row.occurred_at }));
  const missions = db
    .prepare(`SELECT * FROM mission WHERE is_legacy = 1 ORDER BY completed_at DESC`)
    .all()
    .map((row) => ({
      ...row,
      type: 'mission',
      at: row.completed_at ?? row.created_at,
      source_title: sourceTitle(row.source_type, row.source_id),
    }));
  return [...logs, ...missions].sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/* ---------- ダンジョン（つながりの探索） ---------- */

const DUNGEON_MAX_DEPTH = 12;

// ミッションを1本の通路として見る。完了していれば、その先に生成されたログの部屋がある。
function dungeonMission(mission, depth) {
  const generated =
    depth >= DUNGEON_MAX_DEPTH
      ? null
      : db.prepare(`SELECT * FROM log WHERE source_mission_id = ?`).get(mission.id) ?? null;
  return {
    type: 'mission',
    id: mission.id,
    title: mission.title,
    status: mission.status,
    time: mission.estimated_time,
    money: mission.estimated_money,
    is_legacy: Boolean(mission.is_legacy),
    at: mission.completed_at ?? mission.created_at,
    children: generated ? [dungeonEntry('log', generated, depth + 1)] : [],
  };
}

// アイデア／ログを1つの部屋として見る。切り出したミッションが次への通路になる。
function dungeonEntry(type, row, depth) {
  const children =
    depth >= DUNGEON_MAX_DEPTH
      ? []
      : listMissionsBySource(type, row.id).map((mission) => dungeonMission(mission, depth + 1));
  return {
    type,
    id: row.id,
    title: row.title,
    at: type === 'idea' ? row.created_at : row.occurred_at,
    time: type === 'log' ? row.time_spent : 0,
    money: type === 'log' ? row.money_spent : 0,
    is_legacy: Boolean(row.is_legacy),
    from_recurrence: type === 'log' ? Boolean(row.source_recurrence_id) : false,
    children,
  };
}

// 枝の合計。消費済みはログ側だけを数える（完了ミッションの消費はログになっているため）。
function accumulate(node) {
  const totals = {
    consumed_time: 0,
    consumed_money: 0,
    planned_time: 0,
    planned_money: 0,
    rooms: 0,
    missions: 0,
    legacies: node.is_legacy ? 1 : 0,
    depth: 1,
  };

  if (node.type === 'mission') {
    totals.missions = 1;
    if (node.status === 'active') {
      totals.planned_time += node.time;
      totals.planned_money += node.money;
    }
  } else {
    totals.rooms = 1;
    totals.consumed_time += node.time;
    totals.consumed_money += node.money;
  }

  for (const child of node.children) {
    const sub = accumulate(child);
    totals.consumed_time += sub.consumed_time;
    totals.consumed_money += sub.consumed_money;
    totals.planned_time += sub.planned_time;
    totals.planned_money += sub.planned_money;
    totals.rooms += sub.rooms;
    totals.missions += sub.missions;
    totals.legacies += sub.legacies;
    totals.depth = Math.max(totals.depth, sub.depth + 1);
  }
  return totals;
}

// 探索の入口＝アイデア全部と、ミッション由来ではないログ。
export function getDungeon({ onlyLegacy = false } = {}) {
  const roots = [
    ...db.prepare(`SELECT * FROM idea`).all().map((row) => dungeonEntry('idea', row, 0)),
    ...db
      .prepare(`SELECT * FROM log WHERE source_mission_id IS NULL`)
      .all()
      .map((row) => dungeonEntry('log', row, 0)),
  ].map((node) => ({ ...node, totals: accumulate(node) }));

  const filtered = onlyLegacy ? roots.filter((node) => node.totals.legacies > 0) : roots;

  return filtered.sort((a, b) => {
    // 奥が深い順、同じなら新しい順。探索しがいのある枝を上に出す。
    if (b.totals.depth !== a.totals.depth) return b.totals.depth - a.totals.depth;
    return String(b.at).localeCompare(String(a.at));
  });
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

  // 定期イベントのこれから起きる回も消費予定に含める。
  const recurringWeek = plannedRecurring(week, now);
  const recurringMonth = plannedRecurring(month, now);

  const build = (budget, consumed, fromMissions, fromRecurring, period) => {
    const plannedValue = fromMissions + fromRecurring;
    return {
      budget,
      consumed,
      planned: plannedValue,
      planned_missions: fromMissions,
      planned_recurring: fromRecurring,
      // 進行中ミッションを全て完了した場合の残量
      remaining: budget - consumed - plannedValue,
      remaining_now: budget - consumed,
      over: consumed + plannedValue > budget,
      period,
    };
  };

  return {
    time: {
      unit: 'minutes',
      ...build(timeBudget.amount, spent(week).time, planned.time, recurringWeek.time, week),
      budget_source: timeBudget.source,
    },
    money: {
      unit: 'jpy',
      ...build(moneyBudget.amount, spent(month).money, planned.money, recurringMonth.money, month),
      budget_source: moneyBudget.source,
    },
    active_mission_count: planned.count,
    recurrence_count: db
      .prepare(`SELECT COUNT(*) AS total FROM recurrence WHERE active = 1`)
      .get().total,
  };
}
