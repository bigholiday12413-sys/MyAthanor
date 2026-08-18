import { Router } from 'express';
import * as store from './store.js';

export const api = Router();

// 同期的な store の例外をそのまま JSON エラーに落とす。
function handle(fn) {
  return (req, res, next) => {
    try {
      fn(req, res);
    } catch (err) {
      next(err);
    }
  };
}

function id(req) {
  const value = Number(req.params.id);
  if (!Number.isInteger(value) || value <= 0) {
    const err = new Error('invalid id');
    err.status = 400;
    throw err;
  }
  return value;
}

// 開催日が来た定期イベントを、どのリクエストの処理よりも先にログ化しておく。
// 同期済みの日は空ループなので実質ただの SELECT で済む。
api.use((_req, _res, next) => {
  try {
    store.syncRecurrences();
    next();
  } catch (err) {
    next(err);
  }
});

/* ストリーム */
const STREAM_TYPES = ['all', 'idea', 'log', 'food', 'gear'];

function streamType(value, fallback = 'all') {
  const type = value ?? fallback;
  if (type !== null && !STREAM_TYPES.includes(type)) {
    const err = new Error(`type must be ${STREAM_TYPES.join(', ')}`);
    err.status = 400;
    throw err;
  }
  return type;
}

api.get('/stream', handle((req, res) => {
  const type = streamType(req.query.type);
  res.json(store.listStream({ type, limit: req.query.limit ?? 200 }));
}));

/* 新規追加（種別を選んでテキストのみ） */
api.post('/entries', handle((req, res) => {
  const { kind, title, money_spent } = req.body ?? {};
  if (kind === 'idea') return res.status(201).json(store.createIdea({ title }));
  if (kind === 'log') return res.status(201).json(store.createLog({ title }));
  // 糧と装備はログの器に入れ、買ったものの別と金額だけ添える。
  if (store.isGoods(kind)) {
    return res.status(201).json(store.createLog({ title, money_spent, goods: kind }));
  }
  const err = new Error('kind must be "idea", "log", "food" or "gear"');
  err.status = 400;
  throw err;
}));

/* アイデア */
api.post('/ideas', handle((req, res) => res.status(201).json(store.createIdea(req.body ?? {}))));
api.get('/ideas/:id', handle((req, res) => res.json(store.getIdea(id(req)))));
api.patch('/ideas/:id', handle((req, res) => res.json(store.updateIdea(id(req), req.body ?? {}))));

/* スペル（スペルブック） */
api.get('/spells', handle((_req, res) => res.json(store.listSpells())));
api.post('/spells', handle((req, res) => res.status(201).json(store.createSpell(req.body ?? {}))));
api.get('/spells/:id', handle((req, res) => res.json(store.getSpell(id(req)))));
api.patch('/spells/:id', handle((req, res) =>
  res.json(store.updateSpell(id(req), req.body ?? {}))));
api.delete('/spells/:id', handle((req, res) => res.json(store.deleteSpell(id(req)))));

/* ログ */
api.post('/logs', handle((req, res) => res.status(201).json(store.createLog(req.body ?? {}))));
api.get('/logs/:id', handle((req, res) => res.json(store.getLog(id(req)))));
api.patch('/logs/:id', handle((req, res) => res.json(store.updateLog(id(req), req.body ?? {}))));

/* ミッション */
api.get('/missions', handle((req, res) => {
  const { status, sort = 'recent' } = req.query;
  if (status !== undefined && !store.isMissionStatus(status)) {
    const err = new Error('status must be active, abandoned or done');
    err.status = 400;
    throw err;
  }
  if (!store.isMissionSort(sort)) {
    const err = new Error('sort must be due or recent');
    err.status = 400;
    throw err;
  }
  const repeat = req.query.repeat ?? 'once';
  if (!store.isRepeatFilter(repeat)) {
    const err = new Error('repeat must be once, seed or all');
    err.status = 400;
    throw err;
  }
  res.json(store.listMissions({ status, sort, repeat, due_by: req.query.due_by ?? null }));
}));

api.post('/missions', handle((req, res) =>
  res.status(201).json(store.createMission(req.body ?? {}))));

api.get('/missions/:id', handle((req, res) => res.json(store.getMission(id(req)))));

api.patch('/missions/:id', handle((req, res) =>
  res.json(store.updateMission(id(req), req.body ?? {}))));

api.post('/missions/:id/complete', handle((req, res) =>
  res.json(store.completeMission(id(req)))));

api.post('/missions/:id/abandon', handle((req, res) =>
  res.json(store.abandonMission(id(req)))));

api.post('/missions/:id/reopen', handle((req, res) =>
  res.json(store.reopenMission(id(req)))));

/* 設定（既定値） */
api.get('/settings', handle((_req, res) => res.json(store.getSettings())));
api.put('/settings', handle((req, res) => res.json(store.updateSettings(req.body ?? {}))));

// 週のタイムを表の塗りで決める。塗ったマスの数がそのまま時間になる。
api.put('/settings/time-grid', handle((req, res) => {
  const { grid } = req.body ?? {};
  res.json(grid === null ? store.clearTimeGrid() : store.setTimeGrid(grid));
}));

/* 金庫 */
api.get('/vault', handle((_req, res) => res.json(store.getVault())));

/* 期間ごとに使える量 */
api.get('/budgets', handle((req, res) => {
  const { kind, past, future } = req.query;
  res.json(store.listBudgets(kind, { past, future }));
}));

api.put('/budgets/:kind/:key', handle((req, res) => {
  const { amount } = req.body ?? {};
  if (amount === undefined) {
    const err = new Error('amount is required');
    err.status = 400;
    throw err;
  }
  res.json(store.setBudget(req.params.kind, req.params.key, amount));
}));

api.delete('/budgets/:kind/:key', handle((req, res) =>
  res.json(store.clearBudget(req.params.kind, req.params.key))));

/* 定期イベント */
api.get('/recurrences', handle((_req, res) => res.json(store.listRecurrences())));

api.post('/recurrences', handle((req, res) =>
  res.status(201).json(store.createRecurrence(req.body ?? {}))));

api.get('/recurrences/:id', handle((req, res) => {
  const recurrenceId = id(req);
  res.json({
    ...store.getRecurrence(recurrenceId),
    occurrences: store.listOccurrences(recurrenceId, {
      back: req.query.back ?? 4,
      ahead: req.query.ahead ?? 4,
    }),
  });
}));

api.patch('/recurrences/:id', handle((req, res) =>
  res.json(store.updateRecurrence(id(req), req.body ?? {}))));

api.delete('/recurrences/:id', handle((req, res) => res.json(store.deleteRecurrence(id(req)))));

/* 定期イベントの個別の回 */
api.patch('/recurrences/:id/occurrences/:date', handle((req, res) =>
  res.json(store.updateOccurrence(id(req), req.params.date, req.body ?? {}))));

api.delete('/recurrences/:id/occurrences/:date', handle((req, res) =>
  res.json(store.resetOccurrence(id(req), req.params.date))));

/* 大釜（ミッションのTODOリスト） */
api.post('/cauldrons', handle((req, res) =>
  res.status(201).json(store.createCauldron(req.body ?? {}))));

api.get('/cauldrons/:id', handle((req, res) => res.json(store.getCauldron(id(req)))));

api.patch('/cauldrons/:id', handle((req, res) =>
  res.json(store.updateCauldron(id(req), req.body ?? {}))));

api.delete('/cauldrons/:id', handle((req, res) => res.json(store.deleteCauldron(id(req)))));

// 素材をまとめて投入する。
api.post('/cauldrons/:id/materials', handle((req, res) =>
  res.status(201).json(store.addMaterials(id(req), req.body?.items))));

/* レガシー：盤の上で輝かせるかどうかだけの印。 */
api.put('/legacies/:kind/:id', handle((req, res) => {
  const value = req.body?.is_legacy;
  if (typeof value !== 'boolean') {
    const err = new Error('is_legacy must be a boolean');
    err.status = 400;
    throw err;
  }
  res.json(store.setLegacy(req.params.kind, id(req), value));
}));

/* ダンジョン：区画に割らない1枚の盤。
   since / until（YYYY-MM-DD）で載せる期間を切る。既定は直近1か月。 */
api.get('/dungeon', handle((req, res) =>
  res.json(store.getDungeon({
    since: req.query.since ?? null,
    until: req.query.until ?? null,
  }))));

/* ホームのサマリ */
api.get('/summary', handle((_req, res) => res.json(store.getSummary())));
