import { db, transaction } from './db.js';
import {
  periods,
  addDays,
  dateKey,
  parseDateKey,
  daysInMonth,
  weekdayIndex,
  weeklyShare,
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
    cauldrons: listCauldronsBySource('idea', id),
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

/* ---------- spell（スペルブック） ---------- */

function spellRow(id) {
  const row = db.prepare(`SELECT * FROM idea WHERE id = ? AND is_spell = 1`).get(id);
  if (!row) throw notFound('spell');
  return row;
}

export function listSpells() {
  return db
    .prepare(`
      SELECT i.*,
             (SELECT COUNT(*) FROM mission m
               WHERE m.source_type = 'idea' AND m.source_id = i.id) AS mission_count,
             (SELECT COUNT(*) FROM mission m
               WHERE m.source_type = 'idea' AND m.source_id = i.id
                 AND m.status = 'active') AS active_mission_count
      FROM idea i WHERE i.is_spell = 1
      ORDER BY i.created_at DESC, i.id DESC
    `)
    .all()
    .map((row) => ({ ...row }));
}

export function getSpell(id) {
  const row = spellRow(id);
  return {
    ...row,
    kind: 'spell',
    missions: listMissionsBySource('idea', id),
  };
}

export function createSpell({ title, body }) {
  const { lastInsertRowid } = db
    .prepare(`
      INSERT INTO idea (title, created_at, is_spell, body) VALUES (?, ?, 1, ?)
    `)
    .run(requireTitle(title), nowIso(), body ? String(body) : null);
  return getSpell(Number(lastInsertRowid));
}

export function updateSpell(id, { title, body }) {
  const row = spellRow(id);
  db.prepare(`UPDATE idea SET title = ?, body = ? WHERE id = ?`).run(
    title === undefined ? row.title : requireTitle(title),
    body === undefined ? row.body : body === null || body === '' ? null : String(body),
    id,
  );
  return getSpell(id);
}

// ミッションを抱えたままのスペルは消させない。道が切れてしまうため。
export function deleteSpell(id) {
  spellRow(id);
  const missions = listMissionsBySource('idea', id);
  if (missions.length > 0) {
    const err = new Error('spell still has missions');
    err.status = 409;
    throw err;
  }
  return transaction(() => {
    db.prepare(`DELETE FROM idea WHERE id = ?`).run(id);
    return { id, deleted: true };
  });
}

/* ---------- log ---------- */

/* 買ったものの別。糧は食べれば消え、装備は残る。
   出来事としてのログは NULL のまま。 */
export const GOODS = ['food', 'gear'];

export const isGoods = (value) => GOODS.includes(value);

function goodsOf(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!isGoods(value)) throw badRequest('goods must be "food" or "gear"');
  return value;
}

export function createLog({
  title, occurred_at, time_spent, money_spent, source_mission_id, goods,
}) {
  const stmt = db.prepare(`
    INSERT INTO log (title, occurred_at, time_spent, money_spent, source_mission_id, goods)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const { lastInsertRowid } = stmt.run(
    requireTitle(title),
    occurred_at || nowIso(),
    int(time_spent),
    int(money_spent),
    source_mission_id ?? null,
    goodsOf(goods),
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
    cauldrons: listCauldronsBySource('log', id),
    missions: listMissionsBySource('log', id),
  };
}

export function updateLog(id, { title, occurred_at, time_spent, money_spent, goods }) {
  const row = db.prepare(`SELECT * FROM log WHERE id = ?`).get(id);
  if (!row) throw notFound('log');

  db.prepare(`
    UPDATE log SET title = ?, occurred_at = ?, time_spent = ?, money_spent = ?, goods = ?
    WHERE id = ?
  `).run(
    title === undefined ? row.title : requireTitle(title),
    occurred_at === undefined ? row.occurred_at : occurred_at,
    time_spent === undefined ? row.time_spent : int(time_spent),
    money_spent === undefined ? row.money_spent : int(money_spent),
    goods === undefined ? row.goods : goodsOf(goods),
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
             0 AS time_spent, 0 AS money_spent, 0 AS from_mission, 0 AS from_recurrence,
             i.temperature, i.temperature_at, NULL AS goods
      FROM idea i WHERE i.is_spell = 0
    `);
  }
  // 糧と装備もログの器に入っているので、別で絞り込むだけでよい。
  if (type === 'all' || type === 'log' || isGoods(type)) {
    const where = isGoods(type)
      ? `WHERE l.goods = '${type}'`
      : type === 'log' ? `WHERE l.goods IS NULL` : '';
    parts.push(`
      SELECT 'log' AS kind, l.id, l.title, l.occurred_at AS at,
             l.time_spent, l.money_spent,
             CASE WHEN l.source_mission_id IS NULL THEN 0 ELSE 1 END AS from_mission,
             CASE WHEN l.source_recurrence_id IS NULL THEN 0 ELSE 1 END AS from_recurrence,
             NULL AS temperature, NULL AS temperature_at, l.goods
      FROM log l ${where}
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

  const now = new Date();
  const halfLife = getSettings().cooling_half_life_days;

  return rows
    .map((row) => {
      const c = byKey.get(`${row.kind}:${row.id}`);
      return {
        ...row,
        from_mission: Boolean(row.from_mission),
        from_recurrence: Boolean(row.from_recurrence),
        current_temperature:
          row.kind === 'idea'
            ? coolTemperature(row.temperature, row.temperature_at ?? row.at, now, halfLife)
            : null,
        mission_count: c ? c.total : 0,
        active_mission_count: c ? c.active : 0,
      };
    });
}

/* ---------- mission ---------- */

const MISSION_STATUSES = new Set(['active', 'abandoned', 'done']);

// 期日は任意。空文字と null はどちらも「無し」として扱う。
function optionalDate(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const date = parseDateKey(value);
  if (!date) throw badRequest(`${label} must be YYYY-MM-DD`);
  return dateKey(date);
}

function checkDateOrder(startKey, dueKey) {
  if (startKey && dueKey && dueKey < startKey) {
    throw badRequest('due_date must not be before start_date');
  }
}

function sourceTitle(type, id) {
  const table = type === 'idea' ? 'idea' : 'log';
  const row = db.prepare(`SELECT title FROM ${table} WHERE id = ?`).get(id);
  return row ? row.title : null;
}

// 素材は自分の期限を持たなければ大釜の期限を引き継ぐ。並び替えもこれで行う。
const MISSION_SELECT = `
  SELECT m.*,
         COALESCE(m.due_date, c.due_date) AS effective_due_date,
         CASE WHEN m.due_date IS NULL AND c.due_date IS NOT NULL THEN 1 ELSE 0 END
           AS due_inherited
  FROM mission m LEFT JOIN cauldron c ON c.id = m.cauldron_id
`;

function decorate(mission) {
  const cauldron = mission.cauldron_id
    ? db
        .prepare(`SELECT id, title, start_date, due_date FROM cauldron WHERE id = ?`)
        .get(mission.cauldron_id) ?? null
    : null;
  return {
    ...mission,
    due_inherited: Boolean(mission.due_inherited),
    source_title: sourceTitle(mission.source_type, mission.source_id),
    cauldron,
  };
}

export function createMission({
  title,
  source_type,
  source_id,
  estimated_time,
  estimated_money,
  cauldron_id,
  start_date,
  due_date,
}) {
  // 大釜に入れる場合は、器と同じ元エントリに揃える。
  let sourceType = source_type;
  let sourceId = source_id;
  if (cauldron_id) {
    const cauldron = cauldronRow(cauldron_id);
    sourceType = cauldron.source_type;
    sourceId = cauldron.source_id;
  }

  if (sourceType !== 'idea' && sourceType !== 'log') {
    const err = new Error('source_type must be "idea" or "log"');
    err.status = 400;
    throw err;
  }
  if (sourceTitle(sourceType, sourceId) === null) throw notFound(sourceType);

  const startKey = optionalDate(start_date, 'start_date');
  const dueKey = optionalDate(due_date, 'due_date');
  checkDateOrder(startKey, dueKey);

  const { lastInsertRowid } = db
    .prepare(`
      INSERT INTO mission
        (title, source_type, source_id, status, estimated_time, estimated_money,
         created_at, cauldron_id, start_date, due_date)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
    `)
    .run(
      requireTitle(title),
      sourceType,
      int(sourceId),
      int(estimated_time),
      int(estimated_money),
      nowIso(),
      cauldron_id ?? null,
      startKey,
      dueKey,
    );
  refreshCauldron(cauldron_id);
  return getMission(Number(lastInsertRowid));
}

export function getMission(id) {
  const row = db.prepare(`${MISSION_SELECT} WHERE m.id = ?`).get(id);
  if (!row) throw notFound('mission');
  return decorate(row);
}

// 期限順は「期限のあるものを近い順に、無いものは後ろへ」。
const MISSION_ORDER = {
  due: `ORDER BY (effective_due_date IS NULL), effective_due_date ASC, m.created_at ASC, m.id ASC`,
  recent: `ORDER BY COALESCE(m.completed_at, m.created_at) DESC, m.id DESC`,
};

export function listMissions({ status, sort = 'recent' } = {}) {
  const order = MISSION_ORDER[sort] ?? MISSION_ORDER.recent;
  const rows = status
    ? db.prepare(`${MISSION_SELECT} WHERE m.status = ? ${order}`).all(status)
    : db.prepare(`${MISSION_SELECT} ${order}`).all();
  return rows.map(decorate);
}

export function isMissionSort(sort) {
  return Object.hasOwn(MISSION_ORDER, sort);
}

export function listMissionsBySource(source_type, source_id) {
  return db
    .prepare(`
      ${MISSION_SELECT} WHERE m.source_type = ? AND m.source_id = ?
      ${MISSION_ORDER.due}
    `)
    .all(source_type, source_id)
    .map(decorate);
}

export function updateMission(
  id,
  { title, estimated_time, estimated_money, start_date, due_date },
) {
  const row = db.prepare(`SELECT * FROM mission WHERE id = ?`).get(id);
  if (!row) throw notFound('mission');

  const startKey =
    start_date === undefined ? row.start_date : optionalDate(start_date, 'start_date');
  const dueKey = due_date === undefined ? row.due_date : optionalDate(due_date, 'due_date');
  checkDateOrder(startKey, dueKey);

  db.prepare(`
    UPDATE mission
       SET title = ?, estimated_time = ?, estimated_money = ?, start_date = ?, due_date = ?
     WHERE id = ?
  `).run(
    title === undefined ? row.title : requireTitle(title),
    estimated_time === undefined ? row.estimated_time : int(estimated_time),
    estimated_money === undefined ? row.estimated_money : int(estimated_money),
    startKey,
    dueKey,
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

    refreshCauldron(mission.cauldron_id);
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
  refreshCauldron(row.cauldron_id);
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
  refreshCauldron(row.cauldron_id);
  return getMission(id);
}

export function isMissionStatus(status) {
  return MISSION_STATUSES.has(status);
}

/* ---------- settings ---------- */

export function getSettings() {
  return db
    .prepare(`
      SELECT weekly_time, monthly_money, cooling_half_life_days, vault_initial, time_grid
      FROM settings WHERE id = 1
    `)
    .get();
}

export function updateSettings({
  weekly_time,
  monthly_money,
  cooling_half_life_days,
  vault_initial,
}) {
  const current = getSettings();
  db.prepare(`
    UPDATE settings
       SET weekly_time = ?, monthly_money = ?, cooling_half_life_days = ?, vault_initial = ?
     WHERE id = 1
  `).run(
    weekly_time === undefined ? current.weekly_time : int(weekly_time),
    monthly_money === undefined ? current.monthly_money : int(monthly_money),
    cooling_half_life_days === undefined
      ? current.cooling_half_life_days
      : int(cooling_half_life_days),
    vault_initial === undefined ? current.vault_initial : Math.round(Number(vault_initial) || 0),
  );
  return getSettings();
}

/* ---------- 週のタイムを表で選ぶ ---------- */

// 曜日×24時間の 168 マス。index = 曜日(0=月) * 24 + 時。
export const GRID_CELLS = 7 * 24;

export function setTimeGrid(grid) {
  const value = String(grid ?? '');
  if (!new RegExp(`^[01]{${GRID_CELLS}}$`).test(value)) {
    throw badRequest(`time_grid must be ${GRID_CELLS} characters of 0 or 1`);
  }
  const hours = [...value].filter((cell) => cell === '1').length;
  db.prepare(`UPDATE settings SET time_grid = ?, weekly_time = ? WHERE id = 1`)
    .run(value, hours * 60);
  return getSettings();
}

// 表をやめて数字で持ちたいときのために、塗りだけ消せるようにする。
export function clearTimeGrid() {
  db.prepare(`UPDATE settings SET time_grid = NULL WHERE id = 1`).run();
  return getSettings();
}

/* ---------- 金庫 ---------- */

// 週が終わると、その週のウォレットの余り（全体 − 消費済み）が金庫に積まれる。
// 進行中の今月はまだ積まない。使いすぎた月は目減りする。
export function getVault(now = new Date()) {
  const settings = getSettings();
  const current = periods.money.of(now);
  const firstLog = db.prepare(`SELECT MIN(occurred_at) AS at FROM log`).get().at;

  const weeks = [];
  if (firstLog) {
    let period = periods.money.of(new Date(firstLog));
    let guard = 0;
    while (period && period.key < current.key && guard < 600) {
      const budget = resolveBudget('money', period.key);
      const consumed = consumedIn('money', period);
      weeks.push({
        ...period,
        budget: budget.amount,
        budget_source: budget.source,
        consumed,
        surplus: budget.amount - consumed,
      });
      period = periods.money.shift(period.key, 1);
      guard += 1;
    }
  }

  const deposited = weeks.reduce((sum, week) => sum + week.surplus, 0);
  const currentBudget = resolveBudget('money', current.key).amount;

  return {
    initial: settings.vault_initial,
    deposited,
    balance: settings.vault_initial + deposited,
    // 今週が終わったら積まれる見込み。
    pending: currentBudget - consumedIn('money', current),
    current_period: current,
    weeks: weeks.reverse(),
  };
}

/* ---------- budget（期間ごとに使える量） ---------- */

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

// その期間に使える量。個別設定があればそれを、無ければ既定値を返す。
// ウォレットの既定値は月あたりの報酬なので、1週ぶんに均してから返す。
export function resolveBudget(kind, periodKey) {
  requireKind(kind);
  const row = db
    .prepare(`SELECT amount FROM budget WHERE kind = ? AND period_key = ?`)
    .get(kind, periodKey);
  if (row) return { amount: row.amount, source: 'override' };
  const stored = getSettings()[DEFAULT_COLUMN[kind]];
  return { amount: kind === 'money' ? weeklyShare(stored) : stored, source: 'default' };
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

/* ---------- 大釜（ミッションのTODOリスト） ---------- */

function cauldronRow(id) {
  const row = db.prepare(`SELECT * FROM cauldron WHERE id = ?`).get(id);
  if (!row) throw notFound('cauldron');
  return row;
}

// 素材（＝この大釜に入っているミッション）。
export function listMaterials(cauldronId) {
  return db
    .prepare(`${MISSION_SELECT} WHERE m.cauldron_id = ? ORDER BY m.id ASC`)
    .all(cauldronId)
    .map(decorate);
}

// 断念した素材は「要らなくなった」とみなし、必要数から外す。
function cauldronProgress(materials) {
  const needed = materials.filter((m) => m.status !== 'abandoned');
  const done = needed.filter((m) => m.status === 'done');
  return {
    total: materials.length,
    needed: needed.length,
    done: done.length,
    abandoned: materials.length - needed.length,
    remaining_time: needed
      .filter((m) => m.status === 'active')
      .reduce((sum, m) => sum + m.estimated_time, 0),
    remaining_money: needed
      .filter((m) => m.status === 'active')
      .reduce((sum, m) => sum + m.estimated_money, 0),
    spent_time: done.reduce((sum, m) => sum + m.estimated_time, 0),
    spent_money: done.reduce((sum, m) => sum + m.estimated_money, 0),
  };
}

// 素材の状態が変わるたびに錬成の完了を判定し直す。
// 素材が1つ以上あって、断念を除く全部が完了していれば錬成完了。
function refreshCauldron(cauldronId) {
  if (!cauldronId) return;
  const row = db.prepare(`SELECT * FROM cauldron WHERE id = ?`).get(cauldronId);
  if (!row) return;

  const progress = cauldronProgress(listMaterials(cauldronId));
  const complete = progress.needed > 0 && progress.done === progress.needed;

  if (complete && !row.completed_at) {
    db.prepare(`UPDATE cauldron SET completed_at = ? WHERE id = ?`).run(nowIso(), cauldronId);
  } else if (!complete && row.completed_at) {
    db.prepare(`UPDATE cauldron SET completed_at = NULL WHERE id = ?`).run(cauldronId);
  }
}

export function getCauldron(id) {
  const row = cauldronRow(id);
  const materials = listMaterials(id);
  return {
    ...row,
    source_title: sourceTitle(row.source_type, row.source_id),
    materials,
    progress: cauldronProgress(materials),
  };
}

export function listCauldronsBySource(sourceType, sourceId) {
  return db
    .prepare(`
      SELECT * FROM cauldron WHERE source_type = ? AND source_id = ?
      ORDER BY completed_at IS NOT NULL, id ASC
    `)
    .all(sourceType, sourceId)
    .map((row) => {
      const materials = listMaterials(row.id);
      return { ...row, materials, progress: cauldronProgress(materials) };
    });
}

export function createCauldron({ title, source_type, source_id, start_date, due_date }) {
  if (source_type !== 'idea' && source_type !== 'log') {
    throw badRequest('source_type must be "idea" or "log"');
  }
  if (sourceTitle(source_type, source_id) === null) throw notFound(source_type);

  const startKey = optionalDate(start_date, 'start_date');
  const dueKey = optionalDate(due_date, 'due_date');
  checkDateOrder(startKey, dueKey);

  const { lastInsertRowid } = db
    .prepare(`
      INSERT INTO cauldron (title, source_type, source_id, created_at, start_date, due_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(requireTitle(title), source_type, int(source_id), nowIso(), startKey, dueKey);
  return getCauldron(Number(lastInsertRowid));
}

export function updateCauldron(id, { title, start_date, due_date }) {
  const row = cauldronRow(id);
  const startKey =
    start_date === undefined ? row.start_date : optionalDate(start_date, 'start_date');
  const dueKey = due_date === undefined ? row.due_date : optionalDate(due_date, 'due_date');
  checkDateOrder(startKey, dueKey);

  db.prepare(`UPDATE cauldron SET title = ?, start_date = ?, due_date = ? WHERE id = ?`).run(
    title === undefined ? row.title : requireTitle(title),
    startKey,
    dueKey,
    id,
  );
  return getCauldron(row.id);
}

// 大釜を捨てても素材は残す。単独のミッションに戻すだけ。
export function deleteCauldron(id) {
  cauldronRow(id);
  return transaction(() => {
    db.prepare(`UPDATE mission SET cauldron_id = NULL WHERE cauldron_id = ?`).run(id);
    db.prepare(`DELETE FROM cauldron WHERE id = ?`).run(id);
    return { id, deleted: true };
  });
}

// 素材をまとめて投入する。1行1素材で受け取る想定。
export function addMaterials(cauldronId, items) {
  const cauldron = cauldronRow(cauldronId);
  if (!Array.isArray(items) || items.length === 0) {
    throw badRequest('items must be a non-empty array');
  }

  return transaction(() => {
    for (const item of items) {
      const values = typeof item === 'string' ? { title: item } : item ?? {};
      const { lastInsertRowid } = db
        .prepare(`
          INSERT INTO mission
            (title, source_type, source_id, status, estimated_time, estimated_money,
             created_at, cauldron_id)
          VALUES (?, ?, ?, 'active', ?, ?, ?, ?)
        `)
        .run(
          requireTitle(values.title),
          cauldron.source_type,
          cauldron.source_id,
          int(values.estimated_time),
          int(values.estimated_money),
          nowIso(),
          cauldronId,
        );
      void lastInsertRowid;
    }
    refreshCauldron(cauldronId);
    return getCauldron(cauldronId);
  });
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

/* ---------- ダンジョン（たまった情報を道として見る） ----------

   部屋   = アイデア／ログ。実際に起きたこと・思いついたこと。
   通路   = ミッション。部屋から次の部屋へ掘った道。
            完了した通路の先には、生成されたログの部屋がある。
            進行中の通路は掘りかけ、断念した通路は崩れて行き止まり。
   大釜   = ひとつの部屋から出る通路のうち、同じ器に入っているものの束。
   深さ   = 道を進んだ順。子は必ず親より後に生まれるので、深さは時間の順序でもある。
   宝箱   = レガシー。盤の上で輝かせるかどうかだけの印。

   区画には割らない。何と何が関わっているかは、派生したミッションだけが決める。  */

const DUNGEON_MAX_DEPTH = 12;

function corridorFrom(mission, depth) {
  const generated =
    mission.status === 'done' && depth < DUNGEON_MAX_DEPTH
      ? db.prepare(`SELECT * FROM log WHERE source_mission_id = ?`).get(mission.id) ?? null
      : null;
  return {
    mission: {
      id: mission.id,
      title: mission.title,
      status: mission.status,
      time: mission.estimated_time,
      money: mission.estimated_money,
      is_legacy: Boolean(mission.is_legacy),
      at: mission.completed_at ?? mission.created_at,
    },
    room: generated ? dungeonRoom('log', generated, depth + 1) : null,
  };
}

function dungeonRoom(type, row, depth) {
  const missions = depth >= DUNGEON_MAX_DEPTH ? [] : listMissionsBySource(type, row.id);

  // 大釜に入っている通路は束ねて、器ごとにまとめて出す。
  const loose = [];
  const bundles = new Map();
  for (const mission of missions) {
    const corridor = corridorFrom(mission, depth);
    if (!mission.cauldron_id) {
      loose.push(corridor);
      continue;
    }
    if (!bundles.has(mission.cauldron_id)) {
      const cauldron = db
        .prepare(`SELECT id, title, completed_at, due_date FROM cauldron WHERE id = ?`)
        .get(mission.cauldron_id);
      bundles.set(mission.cauldron_id, {
        cauldron: cauldron
          ? { ...cauldron, complete: Boolean(cauldron.completed_at) }
          : { id: mission.cauldron_id, title: '大釜', complete: false },
        corridors: [],
      });
    }
    bundles.get(mission.cauldron_id).corridors.push(corridor);
  }

  return {
    // 表示は spell と分けるが、ミッションやタグの引き当ては idea のまま。
    type: type === 'idea' && row.is_spell ? 'spell' : type,
    id: row.id,
    title: row.title,
    at: type === 'idea' ? row.created_at : row.occurred_at,
    time: type === 'log' ? row.time_spent : 0,
    money: type === 'log' ? row.money_spent : 0,
    is_legacy: Boolean(row.is_legacy),
    from_recurrence: type === 'log' ? Boolean(row.source_recurrence_id) : false,
    temperature: type === 'idea' ? withTemperature(row).current_temperature : null,
    corridors: loose,
    cauldrons: [...bundles.values()],
  };
}

function eachCorridor(room) {
  return [...room.corridors, ...room.cauldrons.flatMap((bundle) => bundle.corridors)];
}

// 道ぜんたいの合計。消費済みはログ側だけ数える（完了ミッションの消費はログになっている）。
function accumulate(room) {
  const totals = {
    rooms: 1,
    corridors: 0,
    cauldrons: room.cauldrons.length,
    legacies: room.is_legacy ? 1 : 0,
    consumed_time: room.time,
    consumed_money: room.money,
    planned_time: 0,
    planned_money: 0,
    depth: 1,
  };

  for (const corridor of eachCorridor(room)) {
    totals.corridors += 1;
    if (corridor.mission.is_legacy) totals.legacies += 1;
    if (corridor.mission.status === 'active') {
      totals.planned_time += corridor.mission.time;
      totals.planned_money += corridor.mission.money;
    }
    if (!corridor.room) {
      totals.depth = Math.max(totals.depth, 2); // 掘りかけ・行き止まりも一歩ぶん
      continue;
    }
    const sub = accumulate(corridor.room);
    totals.rooms += sub.rooms;
    totals.corridors += sub.corridors;
    totals.cauldrons += sub.cauldrons;
    totals.legacies += sub.legacies;
    totals.consumed_time += sub.consumed_time;
    totals.consumed_money += sub.consumed_money;
    totals.planned_time += sub.planned_time;
    totals.planned_money += sub.planned_money;
    totals.depth = Math.max(totals.depth, sub.depth + 1);
  }
  return totals;
}

// 探索の入口＝アイデア全部と、ミッション由来ではないログ。
// 区画には割らない。ひとつの盤に全部載せて、関わりは派生したミッションだけが決める。
export function getDungeon() {
  const roads = [
    ...db.prepare(`SELECT * FROM idea`).all().map((row) => dungeonRoom('idea', row, 0)),
    ...db
      .prepare(`SELECT * FROM log WHERE source_mission_id IS NULL`)
      .all()
      .map((row) => dungeonRoom('log', row, 0)),
  ]
    .map((room) => ({ ...room, totals: accumulate(room) }))
    // 深い道から。同じ深さなら新しい順。盤の並びをここで決めておく。
    .sort((a, b) =>
      b.totals.depth !== a.totals.depth
        ? b.totals.depth - a.totals.depth
        : String(b.at).localeCompare(String(a.at)),
    );

  const totals = roads.reduce(
    (sum, road) => ({
      roads: sum.roads + 1,
      rooms: sum.rooms + road.totals.rooms,
      corridors: sum.corridors + road.totals.corridors,
      cauldrons: sum.cauldrons + road.totals.cauldrons,
      legacies: sum.legacies + road.totals.legacies,
      consumed_time: sum.consumed_time + road.totals.consumed_time,
      consumed_money: sum.consumed_money + road.totals.consumed_money,
      planned_time: sum.planned_time + road.totals.planned_time,
      planned_money: sum.planned_money + road.totals.planned_money,
      depth: Math.max(sum.depth, road.totals.depth),
    }),
    {
      roads: 0,
      rooms: 0,
      corridors: 0,
      cauldrons: 0,
      legacies: 0,
      consumed_time: 0,
      consumed_money: 0,
      planned_time: 0,
      planned_money: 0,
      depth: 0,
    },
  );

  return { totals, roads };
}

/* ---------- summary（ホームのタンク） ---------- */

export function getSummary(now = new Date()) {
  // どちらも同じ週。刻みが揃ったので、期間はひとつだけ取ればよい。
  const week = periods.time.of(now);
  const moneyWeek = periods.money.of(now);
  const timeBudget = resolveBudget('time', week.key);
  const moneyBudget = resolveBudget('money', moneyWeek.key);

  const spent = (period) =>
    db
      .prepare(`
        SELECT COALESCE(SUM(time_spent), 0) AS time, COALESCE(SUM(money_spent), 0) AS money
        FROM log WHERE occurred_at >= ? AND occurred_at < ?
      `)
      .get(period.start, period.end);

  // 消費予定は期限で絞る。期限が期間の終わりまでに来る進行中ミッションが対象。
  // 期限切れのものも含める。過ぎていても払う／やるぶんなので、視界から消すと危ない。
  const plannedMissions = (period) =>
    db
      .prepare(`
        SELECT COALESCE(SUM(m.estimated_time), 0) AS time,
               COALESCE(SUM(m.estimated_money), 0) AS money,
               COUNT(*) AS count
        FROM mission m LEFT JOIN cauldron c ON c.id = m.cauldron_id
        WHERE m.status = 'active'
          AND COALESCE(m.due_date, c.due_date) IS NOT NULL
          AND COALESCE(m.due_date, c.due_date) <= ?
      `)
      .get(dateKey(new Date(new Date(period.end).getTime() - 1)));

  // 期限を持たないミッション。試験管には乗らないので、別枠で見せて見落としを防ぐ。
  const undated = db
    .prepare(`
      SELECT COALESCE(SUM(m.estimated_time), 0) AS time,
             COALESCE(SUM(m.estimated_money), 0) AS money,
             COUNT(*) AS count
      FROM mission m LEFT JOIN cauldron c ON c.id = m.cauldron_id
      WHERE m.status = 'active' AND COALESCE(m.due_date, c.due_date) IS NULL
    `)
    .get();

  const activeCount = db
    .prepare(`SELECT COUNT(*) AS count FROM mission WHERE status = 'active'`)
    .get().count;

  // 今週のウォレットが何に出ていったか。糧・装備・出来事の3つに割る。
  const spendByGoods = db
    .prepare(`
      SELECT COALESCE(goods, 'event') AS goods,
             COALESCE(SUM(money_spent), 0) AS money,
             COUNT(*) AS count
      FROM log
      WHERE occurred_at >= ? AND occurred_at < ? AND money_spent <> 0
      GROUP BY COALESCE(goods, 'event')
    `)
    .all(moneyWeek.start, moneyWeek.end);

  const plannedWeek = plannedMissions(week);
  const plannedMoney = plannedMissions(moneyWeek);

  // 定期イベントのこれから起きる回も消費予定に含める。
  const recurringWeek = plannedRecurring(week, now);
  const recurringMoney = plannedRecurring(moneyWeek, now);

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
      ...build(timeBudget.amount, spent(week).time, plannedWeek.time, recurringWeek.time, week),
      budget_source: timeBudget.source,
      due_mission_count: plannedWeek.count,
    },
    money: {
      unit: 'jpy',
      ...build(
        moneyBudget.amount,
        spent(moneyWeek).money,
        plannedMoney.money,
        recurringMoney.money,
        moneyWeek,
      ),
      budget_source: moneyBudget.source,
      due_mission_count: plannedMoney.count,
    },
    // 今週のウォレットの内訳。何に出ていったかを家計簿として見るためのもの。
    wallet_by_goods: ['food', 'gear', 'event'].map((goods) => {
      const row = spendByGoods.find((item) => item.goods === goods);
      return { goods, money: row?.money ?? 0, count: row?.count ?? 0 };
    }),
    // 期限を持たないぶん。運用上ここは 0 のはずで、増えていたら取りこぼしの合図。
    undated: undated,
    active_mission_count: activeCount,
    recurrence_count: db
      .prepare(`SELECT COUNT(*) AS total FROM recurrence WHERE active = 1`)
      .get().total,
  };
}
