/* MyAthanor — フロントエンド（ビルドなしの ES モジュール） */

import { icon, iconBody, toRects, KIND_ICON } from './icons.js';

/* いったん伏せてあるもの。表と API と保存済みの値はそのまま残してあるので、
   true に戻せば元通り出る。伏せている間も、大釜に入っているプロセスは
   ふつうのプロセスとして扱う（隠したせいで触れなくなるのが一番まずい）。 */
const SHOW = { temperature: false, cauldron: false };

const viewEl = document.getElementById('view');
const topbarEl = document.getElementById('topbar');
const tabsEl = document.getElementById('tabs');
const toastEl = document.getElementById('toast');

/* ---------- utilities ---------- */

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data;
}

let toastTimer = null;
function toast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.classList.toggle('is-error', isError);
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 2600);
}

/* タイムは分で保持し、UI では時間で表示・入力する。 */
const minutesToHours = (min) => Math.round((min / 60) * 100) / 100;
const hoursToMinutes = (hours) => Math.round(Number(hours || 0) * 60);

function fmtTime(min) {
  const sign = min < 0 ? '-' : '';
  const abs = Math.abs(min);
  const hours = abs / 60;
  const text = hours >= 10 ? hours.toFixed(1) : hours.toFixed(hours % 1 === 0 ? 0 : 1);
  return `${sign}${text.replace(/\.0$/, '')}h`;
}

function fmtMoney(yen) {
  const sign = yen < 0 ? '-' : '';
  return `${sign}¥${Math.abs(yen).toLocaleString('ja-JP')}`;
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS_LABEL = { active: '進行中', abandoned: '断念', done: '完了' };
const KIND_LABEL = { idea: 'アイデア', log: 'ログ', food: '糧', gear: '装備' };

/* 糧と装備はログの器に入っている。見た目の別だけここで引き直す。 */
const GOODS = ['food', 'gear'];
const isGoods = (kind) => GOODS.includes(kind);
const faceOf = (item) => item.goods ?? item.kind;
const toYen = (value) => Math.max(0, Math.round(Number(value) || 0));

/* アイデアの温度。273K（＝0℃）を常温とし、そこへ向かって冷めていく。 */
const AMBIENT_K = 273;
const MAX_K = 373;

const HEAT_LEVELS = [
  { min: 350, key: 'boiling', label: '沸騰', flame: '#d95d13', core: '#f0a860' },
  { min: 320, key: 'hot', label: '熱い', flame: '#b07f14', core: '#e0bf6a' },
  { min: 295, key: 'warm', label: 'ぬるい', flame: '#96703c', core: '#c4a678' },
  { min: 276, key: 'cooling', label: '冷めかけ', flame: '#7d7458', core: '#a89d7c' },
];
const FROZEN = { key: 'frozen', label: '凍結' };

const heat = (kelvin) => HEAT_LEVELS.find((level) => kelvin >= level.min) ?? FROZEN;

function heatIcon(kelvin) {
  const level = heat(kelvin);
  return level.key === 'frozen'
    ? icon('frost')
    : icon('flame', '', { f: level.flame, c: level.core });
}

function tempChip(kelvin) {
  const level = heat(kelvin);
  return `<span class="temp temp-${level.key}">${heatIcon(kelvin)}<span>${kelvin}K</span></span>`;
}

const toCelsius = (kelvin) => kelvin - AMBIENT_K;

/* ---------- 共通パーツ ---------- */

function setTopbar({ title, sub = '', back = null, action = '' }) {
  topbarEl.innerHTML = `
    ${
      back
        ? `<a class="icon-btn" href="${esc(back)}" aria-label="戻る">${icon('chevron')}</a>`
        : ''
    }
    <h1>${esc(title)}${sub ? ` <span class="sub">${esc(sub)}</span>` : ''}</h1>
    ${action}
  `;
}

function setActiveTab(tab) {
  for (const el of tabsEl.querySelectorAll('.tab')) {
    el.classList.toggle('is-active', el.dataset.tab === tab);
  }
}

// タブのドット絵は起動時に一度だけ流し込む。
for (const el of tabsEl.querySelectorAll('.tab-mark')) {
  el.innerHTML = icon(el.dataset.icon);
}

/* ---------- プロセスの期日 ---------- */

const todayKey = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

// 月曜始まりの週の終わり（日曜）。棚に並べる範囲を決めるのに使う。
const dateKeyOf = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

function summaryWeekEnd(now = new Date()) {
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return new Date(monday.getTime() + 7 * 86_400_000);
}

const daysUntil = (key) =>
  Math.round((new Date(`${key}T00:00:00`) - new Date(`${todayKey()}T00:00:00`)) / 86_400_000);

// 期日はバッジに収めたいので曜日を落とした短い表記を使う
// （定期イベントの fmtDay は曜日つきで別物）。
const fmtShortDay = (key) => {
  const date = new Date(`${key}T00:00:00`);
  return Number.isNaN(date.getTime()) ? key : `${date.getMonth() + 1}/${date.getDate()}`;
};

// 期日の状態。進行中のものだけ急かす。
function dueState(mission) {
  if (mission.status !== 'active') return null;
  const due = mission.effective_due_date ?? mission.due_date;
  if (due) {
    const left = daysUntil(due);
    if (left < 0) return { key: 'over', label: `${-left}日超過` };
    if (left === 0) return { key: 'today', label: '今日まで' };
    if (left <= 3) return { key: 'soon', label: `あと${left}日` };
    return { key: 'far', label: `あと${left}日` };
  }
  if (mission.start_date) {
    const until = daysUntil(mission.start_date);
    if (until > 0) return { key: 'waiting', label: `${until}日後に開始` };
  }
  return null;
}

function dueRange(mission) {
  if (!mission.start_date && !mission.due_date) {
    if (!mission.effective_due_date) return '';
    return SHOW.cauldron
      ? `大釜 → ${fmtShortDay(mission.effective_due_date)}`
      : `→ ${fmtShortDay(mission.effective_due_date)}`;
  }
  const from = mission.start_date ? fmtShortDay(mission.start_date) : '';
  const to = mission.due_date ? fmtShortDay(mission.due_date) : '';
  return `${from}${from ? ' ' : ''}→${to ? ' ' : ''}${to}`;
}

function missionDates(mission) {
  const range = dueRange(mission);
  return `
    <details class="mission-dates">
      <summary>${icon('hourglass')}<span>${range ? esc(range) : '期限'}</span></summary>
      <form class="mission-date-form" data-dates="${mission.id}">
        <div class="row">
          <div class="field">
            <label for="from-${mission.id}">いつから</label>
            <input id="from-${mission.id}" type="date" name="start_date"
                   value="${esc(mission.start_date ?? '')}" />
          </div>
          <div class="field">
            <label for="to-${mission.id}">いつまで</label>
            <input id="to-${mission.id}" type="date" name="due_date"
                   value="${esc(mission.due_date ?? '')}" />
          </div>
        </div>
        <div class="btn-row"><button type="submit">日付を保存</button></div>
      </form>
    </details>
  `;
}

function missionCard(mission, { showSource = true } = {}) {
  const sourceHref = `#/${mission.source_type}/${mission.source_id}`;
  const done = mission.status === 'done';
  const due = dueState(mission);
  const actions =
    mission.status === 'active'
      ? `<button data-act="complete" data-id="${mission.id}" class="act">完了</button>
         <button data-act="abandon" data-id="${mission.id}" class="ghost danger">断念</button>`
      : mission.status === 'abandoned'
        ? `<button data-act="reopen" data-id="${mission.id}" class="ghost">進行中に戻す</button>`
        : legacyButton('mission', mission.id, mission.is_legacy);
  return `
    <div class="card status-${esc(mission.status)} ${mission.is_legacy ? 'is-legacy' : ''}"
         data-mission="${mission.id}">
      <div class="card-top">
        <span class="badge ${esc(mission.status)}">${esc(STATUS_LABEL[mission.status])}</span>
        ${
          due
            ? `<span class="badge due-${due.key}">${esc(due.label)}</span>`
            : mission.effective_due_date
              ? `<span class="badge">〜${esc(fmtShortDay(mission.effective_due_date))}</span>`
              : ''
        }
        ${mission.is_legacy ? `<span class="badge now">${icon('spark')}レガシー</span>` : ''}
        <span class="spacer"></span>
        <span>${esc(fmtDate(done ? mission.completed_at : mission.created_at))}</span>
      </div>
      <div class="card-title">${icon(KIND_ICON.mission)}<span>${esc(mission.title)}</span></div>
      ${
        mission.estimated_time || mission.estimated_money
          ? `<div class="card-meta">
               <span>${done ? '実消費' : '見積'} ${esc(fmtTime(mission.estimated_time))}</span>
               <span>${esc(fmtMoney(mission.estimated_money))}</span>
             </div>`
          : ''
      }
      ${
        SHOW.cauldron && mission.cauldron
          ? `<div class="card-meta"><span>${icon('cauldron')}大釜「${esc(
              mission.cauldron.title,
            )}」の素材</span></div>`
          : ''
      }
      ${
        // 出どころは右端へ寄せる。プロセスの中では重さの軽い項目で、
        // 辿るのは盤のほうが主なので、左からは外す。
        showSource && mission.source_title
          ? `<div class="card-meta is-right">
               <a class="link" href="${sourceHref}">${esc(clip(mission.source_title, 10))} ↗</a>
             </div>`
          : ''
      }
      ${
        // 日付と操作を1行に混ぜる。別々の行に置くと札が241pxになり、
        // 1画面に1枚しか乗らなくなる。開いたときだけ下へ折り返す。
        mission.status === 'active' || actions
          ? `<div class="btn-row card-foot">
               ${mission.status === 'active' ? missionDates(mission) : ''}
               ${actions}
             </div>`
          : ''
      }
    </div>
  `;
}

// プロセスカードの完了／断念／再開と、期日の保存をまとめて処理する。
function wireMissionActions(container, onChanged) {
  container.addEventListener('submit', async (event) => {
    const form = event.target.closest('form[data-dates]');
    if (!form) return;
    event.preventDefault();
    try {
      await api(`/missions/${form.dataset.dates}`, {
        method: 'PATCH',
        body: {
          start_date: form.elements.start_date.value || null,
          due_date: form.elements.due_date.value || null,
        },
      });
      toast('日付を保存しました');
      await onChanged();
    } catch (err) {
      toast(err.message, true);
    }
  });

  container.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-act]');
    if (!button) return;
    const { act, id } = button.dataset;
    if (act === 'abandon' && !confirm('このプロセスを断念しますか？')) return;
    button.disabled = true;
    try {
      await api(`/missions/${id}/${act}`, { method: 'POST' });
      toast(
        act === 'complete' ? '完了：ログを生成しました' : act === 'abandon' ? '断念しました' : '進行中に戻しました',
      );
      await onChanged();
    } catch (err) {
      toast(err.message, true);
      button.disabled = false;
    }
  });
}

/* ---------- ホーム ---------- */

// リソースは2色の試験管で示す。下から 消費済み（薬草色）、消費予定（琥珀）。
const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];

/* 週の紙。月曜から7枚並べ、済んだ日から順に印が入る。
   タイムもウォレットも週で見るようになったので、いま週のどこに居るのかを
   数字より先に置く。今日の紙にはまだ印を入れない。終わっていないので。
   曜日の文字は出さない。左から月曜と決まっていて、印の数で何日目かが読める。
   読み上げには要るので、名前だけ aria-label に残す。 */
function weekSheets(now = new Date()) {
  const today = (now.getDay() + 6) % 7;
  return `<div class="week-sheets">${WEEKDAYS.map((day, index) => {
    const done = index < today;
    const isToday = index === today;
    return `<div class="sheet ${done ? 'is-done' : ''} ${isToday ? 'is-today' : ''}"
      aria-label="${day}${isToday ? '（今日）' : done ? '（済）' : ''}">
      ${icon(done ? 'sheet-done' : 'sheet', 'sheet-px', isToday ? { o: '#4a8236' } : null)}
    </div>`;
  }).join('')}</div>`;
}

// 期間は出さない。上の週の紙がいつの話かを示していて、両方あると二度言うことになる。
function tubeCard({ name, data, format, plannedLabel = '消費予定', href = null }) {
  const total = Math.max(data.budget, data.consumed + data.planned, 1);
  const pct = (value) => Math.max(0, Math.min(100, (value / total) * 100));
  const free = Math.max(0, data.budget - data.consumed - data.planned);

  return `
    <div class="tube-card">
      <div class="tube-head">
        ${
          // 飛び先があるものは見出しごとリンクにする。別の行を足すより場所を食わない。
          href
            ? `<a class="tube-name is-link" href="${href}">${esc(name)} →</a>`
            : `<span class="tube-name">${esc(name)}</span>`
        }
      </div>
      <div class="tube-wrap">
        <div class="tube ${data.over ? 'is-over' : ''}">
          <div class="tube-neck"></div>
          <div class="tube-body">
            <div class="liquid liquid-consumed" style="height:${pct(data.consumed)}%"></div>
            <div class="liquid liquid-planned" style="height:${pct(data.planned)}%"></div>
            <div class="tube-ticks"></div>
            <div class="tube-shine"></div>
          </div>
        </div>
        <div class="tube-readout">
          <div class="readout-row">
            <span class="k"><i class="swatch consumed"></i>消費済</span>
            <span class="v">${esc(format(data.consumed))}</span>
          </div>
          <div class="readout-row">
            <span class="k"><i class="swatch planned"></i>${esc(plannedLabel)}</span>
            <span class="v">${esc(format(data.planned))}</span>
          </div>
          <div class="readout-row">
            <span class="k"><i class="swatch free"></i>残量</span>
            <span class="v ${data.over ? 'neg' : ''}">${esc(format(free))}</span>
          </div>
          <div class="readout-row">
            <span class="k">全体</span>
            <span class="v">${esc(format(data.budget))}</span>
          </div>
        </div>
      </div>
      <div class="projection">
        <span>フォーキャスト</span>
        <span class="v ${data.remaining < 0 ? 'neg' : ''}">${esc(format(data.remaining))}</span>
      </div>
    </div>
  `;
}

/* ユーズド＝今週のウォレットが何に出ていったか。
   金額の大小がそのまま帯の長さになる。数字だけだと割合が読めず、
   家計簿として見るときに効かない。行を押すとストリームのその絞り込みへ飛ぶ。 */
const GOODS_TONE = { food: 'var(--green)', gear: '#9aa5ab', event: 'var(--gold-dark)' };
const GOODS_NAME = { food: '糧', gear: '装備', event: '出来事' };

function walletBars(rows) {
  const total = rows.reduce((sum, row) => sum + row.money, 0);
  if (!total) return '';
  return rows
    .filter((row) => row.money)
    .map(
      (row) => `
        <div class="spend">
          <div class="spend-head">
            <a class="spend-name" href="#/stream?type=${
              // 出来事＝素のログ。ストリームの絞り込みでは 'log' に当たる。
              row.goods === 'event' ? 'log' : row.goods
            }">${
              row.goods === 'event' ? '' : icon(KIND_ICON[row.goods])
            }<span>${GOODS_NAME[row.goods]}</span> →</a>
            <span class="spend-count">${row.count}件</span>
            <span class="spend-money">${esc(fmtMoney(row.money))}</span>
          </div>
          <div class="spend-bar">
            <i style="width:${Math.round((row.money / total) * 100)}%;
              background:${GOODS_TONE[row.goods]}"></i>
          </div>
        </div>`,
    )
    .join('');
}

/* ユーズド。ホームからは外して、ウォレットの試験管の先に置く。
   ホームは「いま週のどこに居るか」だけでよく、内訳は見に行くもの。 */
/* 調合棚。今週のうちに期限が来るプロセスを、丸底フラスコとして棚に並べる。
   中身の高さが残り日数で、期限が近いほど減っている。過ぎたものは吹きこぼれる。
   上の試験管と同じガラスの一家にしてあるので、同じ工房の棚に見える。 */
const SHELF_MAX = 6;

/* 丸底フラスコ。他の絵と同じくドット絵で描く。
   中身の高さだけが変わるので、型を1つ持って行ごとに塗り分ける。 */
const FLASK_ROWS = [
  '......cccc......',
  '......cccc......',
  '......o..o......',
  '......o..o......',
  '......o..o......',
  '.....o....o.....',
  '....o......o....',
  '...o........o...',
  '..o..........o..',
  '..o..........o..',
  '.o............o.',
  '.o............o.',
  '.o............o.',
  '..o..........o..',
  '..oo........oo..',
  '....oooooooo....',
];

// 液が入りうる行（首から底の1つ上まで）。
const FLASK_BODY = [2, 14];

const FLASK_TONE = {
  far: '#4a8236',
  soon: '#a8802a',
  over: '#b8442c',
};

function flaskRows(ratio, spill) {
  const [top, bottom] = FLASK_BODY;
  const rows = FLASK_ROWS.map((row) => row.split(''));
  const height = bottom - top + 1;
  const fill = Math.round(ratio * height);

  for (let y = bottom; y > bottom - fill; y -= 1) {
    const row = rows[y];
    const left = row.indexOf('o');
    const right = row.lastIndexOf('o');
    for (let x = left + 1; x < right; x += 1) if (row[x] === '.') row[x] = 'l';
  }
  // 吹きこぼれ。口の脇に粒を散らす。
  if (spill) {
    for (const [x, y] of [[4, 1], [11, 2], [3, 3], [12, 4]]) rows[y][x] = 'l';
  }
  return rows.map((row) => row.join(''));
}

function flask(mission, weekEnd) {
  const left = daysUntil(mission.effective_due_date ?? mission.due_date);
  const over = left < 0;
  // 週の残りぶんを満たすところから、期限に向かって減っていく。
  const span = Math.max(1, daysUntil(weekEnd) + 1);
  const ratio = over ? 0 : Math.max(0.1, Math.min(1, (left + 1) / span));
  const key = over ? 'over' : left <= 1 ? 'soon' : 'far';
  const href = `#/${mission.source_type}/${mission.source_id}`;

  const body = toRects({
    rows: flaskRows(ratio, over),
    palette: {
      o: over ? FLASK_TONE.over : '#8fa79c',
      c: '#8a5a2b',
      l: FLASK_TONE[key],
    },
  });

  return `
    <a class="flask is-${key}" href="${href}" aria-label="${esc(mission.title)}">
      <svg viewBox="0 0 16 16" shape-rendering="crispEdges"
           aria-hidden="true" focusable="false">${body}</svg>
    </a>
  `;
}

function shelf(missions, weekEnd) {
  const shown = missions.slice(0, SHELF_MAX);
  const rest = missions.length - shown.length;
  return `
    <div class="shelf">
      <div class="shelf-row">${shown.map((m) => flask(m, weekEnd)).join('')}</div>
      <div class="shelf-board"></div>
      <div class="shelf-names">
        ${shown.map((m) => `<span>${esc(clip(m.title, 5))}</span>`).join('')}
      </div>
      ${rest > 0 ? `<a class="link shelf-more" href="#/missions">他 ${rest} 本 →</a>` : ''}
    </div>
  `;
}

async function renderUsed() {
  setActiveTab('home');
  setTopbar({ title: 'ユーズド', back: '#/home' });
  viewEl.innerHTML = '<div class="empty">読み込み中…</div>';

  const summary = await api('/summary');
  const rows = summary.wallet_by_goods;
  const total = rows.reduce((sum, row) => sum + row.money, 0);

  viewEl.innerHTML = `
    <div class="panel tight">
      <div class="stat-line">
        <span>週 ${esc(summary.money.period.label)}</span>
        <span class="v">${esc(fmtMoney(total))}</span>
      </div>
    </div>
    ${
      total
        ? `<div class="panel">${walletBars(rows)}</div>`
        : '<div class="empty">今週はまだ出ていません</div>'
    }
  `;
}

async function renderHome() {
  setActiveTab('home');
  setTopbar({
    title: 'MyAthanor',
    action:
      `<a class="icon-btn" href="#/spells" aria-label="インゴット">${icon('ingot')}</a>` +
      `<a class="icon-btn" href="#/settings" aria-label="設定">${icon('key')}</a>`,
  });
  viewEl.innerHTML = '<div class="empty">読み込み中…</div>';

  // 今週の終わり。ここまでに期限が来るプロセスだけを棚に並べる。
  const weekEnd = dateKeyOf(new Date(new Date(summaryWeekEnd()).getTime() - 1));
  const [summary, vault, due] = await Promise.all([
    api('/summary'),
    api('/vault'),
    api(`/missions?status=active&sort=due&due_by=${weekEnd}`),
  ]);

  viewEl.innerHTML = `
    ${weekSheets()}
    <div class="section-title">リソース</div>
    <div class="tubes">
      ${tubeCard({
        name: 'タイム',
        data: summary.time,
        format: fmtTime,
        plannedLabel: '今週予定',
      })}
      ${tubeCard({
        name: 'ウォレット',
        data: summary.money,
        format: fmtMoney,
        plannedLabel: '今週予定',
        href: '#/used',
      })}
    </div>

    <a class="card nav-card vault-line" href="#/vault">
      ${icon('coins')}
      <span class="vault-line-label">金庫</span>
      <span class="vault-line-value">${esc(fmtMoney(vault.balance))}</span>
    </a>

    ${
      // 調合棚。今週のうちに期限が来るぶんだけ。
      due.length ? `<div class="section-title">調合棚</div>${shelf(due, weekEnd)}` : ''
    }

    <div class="section-title">現況</div>
    <div class="panel">
      <div class="stat-line">
        <span>進行中プロセス</span>
        <span class="v">${summary.active_mission_count}</span>
      </div>
      <div class="stat-line">
        <span>うち今週まで</span>
        <span class="v">${summary.time.due_mission_count}</span>
      </div>
      ${
        summary.time.planned_recurring || summary.money.planned_recurring
          ? `<div class="stat-line">
               <span><a class="link" href="#/recurrences">定期イベント →</a></span>
               <span class="v">${esc(fmtTime(summary.time.planned_recurring))} · ${esc(
                 fmtMoney(summary.money.planned_recurring),
               )}</span>
             </div>`
          : ''
      }
    </div>

    ${
      // 期限を持たない見積もりは試験管に乗らない。乗っていないことを見せて取りこぼしを防ぐ。
      summary.undated.time || summary.undated.money
        ? `<div class="panel warn">
             <div class="stat-line">
               <span><a class="link" href="#/missions">期限なしの見積 →</a></span>
               <span class="v neg">${esc(fmtTime(summary.undated.time))} · ${esc(
                 fmtMoney(summary.undated.money),
               )}</span>
             </div>
           </div>`
        : ''
    }

  `;
}

/* ---------- ストリーム ---------- */

const STREAM_TYPES = ['all', 'idea', 'log', 'food', 'gear'];
let streamFilter = 'all';

async function renderStream() {
  setActiveTab('stream');
  setTopbar({ title: 'ストリーム' });

  const items = await api(`/stream?type=${streamFilter}`);

  const body =
    `<div class="list">${
          items.length
            ? items.map(streamCard).join('')
            : '<div class="empty">まだ記録がありません</div>'
        }</div>`;

  viewEl.innerHTML = `
    <div class="filters">
      ${STREAM_TYPES
        .map(
          (type) => `<button class="filter" data-filter="${type}"
             aria-pressed="${streamFilter === type}">${
               type === 'all' ? 'すべて' : KIND_LABEL[type]
             }</button>`,
        )
        .join('')}
    </div>
    ${body}
  `;

  for (const button of viewEl.querySelectorAll('.filter[data-filter]')) {
    button.addEventListener('click', () => {
      streamFilter = button.dataset.filter;
      renderStream();
    });
  }
}

function streamCard(item) {
  const face = faceOf(item);
  return `
    <a class="card kind-${esc(face)}" href="#/${esc(item.kind)}/${item.id}">
      <div class="card-top">
        <span class="badge ${esc(face)}">${esc(KIND_LABEL[face])}</span>
        ${SHOW.temperature && item.kind === 'idea' ? tempChip(item.current_temperature) : ''}
        ${item.from_mission ? '<span>プロセス由来</span>' : ''}
        ${item.from_recurrence ? '<span>定期</span>' : ''}
        <span class="spacer"></span>
        <span>${esc(fmtDate(item.at))}</span>
      </div>
      <div class="card-title">${icon(KIND_ICON[face])}<span>${esc(item.title)}</span></div>
      <div class="card-meta">
        ${
          item.kind === 'log' && (item.time_spent || item.money_spent)
            ? `<span>${esc(fmtTime(item.time_spent))}</span>
               <span>${esc(fmtMoney(item.money_spent))}</span>`
            : ''
        }
        ${
          item.mission_count
            ? `<span class="${item.active_mission_count ? 'hot' : ''}">プロセス ${item.mission_count}件${
                item.active_mission_count ? `（進行中 ${item.active_mission_count}）` : ''
              }</span>`
            : ''
        }
      </div>
    </a>
  `;
}

/* 思いついた時点では、種別も詳細もまだ決まっていないことが多い。
   ここでは題だけを受け取り、入れても閉じずに次を待つ。
   詳細は後からストリームで開いて足せばよい。 */

// 続けて書くときは種別が変わらないことがほとんどなので、前に選んだものを覚えておく。
let captureKind = 'idea';

function openCapture() {
  if (document.querySelector('.modal-backdrop')) return;

  const caught = [];
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <form class="modal" id="capture">
      <h2>書き留める</h2>
      <div class="field">
        <div class="seg-toggle seg-4" id="kind-toggle">
          ${['idea', 'log', 'food', 'gear']
            .map(
              (kind) => `<button type="button" data-kind="${kind}"
                aria-pressed="${captureKind === kind}">${icon(KIND_ICON[kind])}${
                KIND_LABEL[kind]
              }</button>`,
            )
            .join('')}
        </div>
      </div>
      <div class="field capture-row">
        <input id="capture-title" autocomplete="off" enterkeyhint="done" />
        <input id="capture-money" type="number" inputmode="numeric" step="10" min="0" hidden />
      </div>
      <div class="caught" id="caught" hidden></div>
      <div class="btn-row">
        <button type="button" class="ghost" data-close>閉じる</button>
        <button type="submit" class="primary">入れる</button>
      </div>
    </form>
  `;
  document.body.appendChild(backdrop);

  const input = backdrop.querySelector('#capture-title');
  const money = backdrop.querySelector('#capture-money');
  const caughtEl = backdrop.querySelector('#caught');

  // 糧と装備は買ったものなので、金額を並べて受ける。
  function dressFor(kind) {
    money.hidden = !isGoods(kind);
    if (money.hidden) money.value = '';
  }
  dressFor(captureKind);
  input.focus();

  // 入れたものがあれば、閉じたときに下の画面へ反映する。
  const close = () => {
    backdrop.remove();
    if (caught.length) route();
  };

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop || event.target.hasAttribute('data-close')) close();
  });

  backdrop.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });

  backdrop.querySelector('#kind-toggle').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-kind]');
    if (!button) return;
    captureKind = button.dataset.kind;
    for (const b of backdrop.querySelectorAll('#kind-toggle button')) {
      b.setAttribute('aria-pressed', String(b.dataset.kind === captureKind));
    }
    dressFor(captureKind);
    input.focus();
  });

  // 入れたものを新しい順に控える。題を押せばその場で詳細へ行ける。
  function paintCaught() {
    caughtEl.hidden = caught.length === 0;
    caughtEl.innerHTML = `
      <div class="caught-head">入れたもの <b>${caught.length}</b></div>
      ${caught
        .map(
          (item) => `<a class="caught-row" href="#/${
            isGoods(item.kind) ? 'log' : item.kind
          }/${item.id}">
            ${icon(KIND_ICON[item.kind])}<span>${esc(item.title)}</span>
            ${item.money ? `<b>${esc(fmtMoney(item.money))}</b>` : ''}
          </a>`,
        )
        .join('')}
    `;
  }

  // 1行につき1つとして入れる。
  async function put(raw) {
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return input.focus();

    // 打ち終えた文字はすぐ引き取る。保存を待たせると次が打てない。
    input.value = '';
    input.focus();
    const kind = captureKind;
    // 金額は1行目にだけ載せる。まとめて貼ったぶんに同じ額を配ると嘘になる。
    const spent = isGoods(kind) ? toYen(money.value) : 0;
    money.value = '';

    for (const [index, title] of lines.entries()) {
      try {
        const created = await api('/entries', {
          method: 'POST',
          body: { kind, title, money_spent: index === 0 ? spent : 0 },
        });
        caught.unshift({ kind, id: created.id, title, money: index === 0 ? spent : 0 });
      } catch (err) {
        toast(err.message, true);
      }
    }
    paintCaught();
  }

  // 変換の確定で送ってしまうと、打ちかけの文字が入る。変換中は受け取らない。
  let composing = false;
  input.addEventListener('compositionstart', () => {
    composing = true;
  });
  input.addEventListener('compositionend', () => {
    composing = false;
  });

  // 1行の入力欄は改行を持てないので、複数行の貼り付けはここで受けて割る。
  input.addEventListener('paste', (event) => {
    const text = event.clipboardData?.getData('text') ?? '';
    if (!/[\r\n]/.test(text)) return;
    event.preventDefault();
    put(text);
  });

  backdrop.querySelector('#capture').addEventListener('submit', (event) => {
    event.preventDefault();
    if (composing) return;
    put(input.value);
  });
}

/* ---------- 詳細（アイデア／ログ） ---------- */

/* ---------- 大釜（プロセスのTODOリスト） ---------- */

// ひとつの大きなイベントに必要なプロセスを素材として並べる。
// 素材が全部そろうと錬成が終わる。断念した素材は必要数から外れる。
function cauldronPanel(cauldron) {
  const { progress } = cauldron;
  const complete = Boolean(cauldron.completed_at);
  // 錬成が終わっていれば急かさない。
  const due = complete ? null : dueState({ ...cauldron, status: 'active' });
  const percent = progress.needed ? Math.round((progress.done / progress.needed) * 100) : 0;

  return `
    <div class="cauldron ${complete ? 'is-complete' : ''}" data-cauldron="${cauldron.id}">
      <div class="cauldron-head">
        ${icon('cauldron')}
        <span class="cauldron-title">${esc(cauldron.title)}</span>
        <span class="cauldron-count">${progress.done}/${progress.needed}</span>
      </div>
      <div class="brew"><div class="brew-fill" style="width:${percent}%"></div></div>
      <div class="region-stat" style="padding:0 0 6px">
        ${
          due
            ? `<span class="${
                due.key === 'over' ? 'over' : due.key === 'far' || due.key === 'waiting' ? '' : 'hot'
              }">${esc(dueRange(cauldron) || '')} ${esc(due.label)}</span>`
            : dueRange(cauldron)
              ? `<span>${esc(dueRange(cauldron))}</span>`
              : ''
        }
        ${
          complete
            ? '<span class="hot">錬成完了</span>'
            : `<span>残り ${esc(fmtTime(progress.remaining_time))} · ${esc(
                fmtMoney(progress.remaining_money),
              )}</span>`
        }
        ${progress.abandoned ? `<span>断念 ${progress.abandoned}</span>` : ''}
      </div>

      ${cauldron.materials.map(materialRow).join('')}

      <details class="mission-dates">
        <summary>${
          dueRange(cauldron) ? esc(dueRange(cauldron)) : '大釜の日付を決める'
        }</summary>
        <form class="mission-date-form" data-cauldron-dates="${cauldron.id}">
          <div class="row">
            <div class="field">
              <label for="cfrom-${cauldron.id}">いつから</label>
              <input id="cfrom-${cauldron.id}" type="date" name="start_date"
                     value="${esc(cauldron.start_date ?? '')}" />
            </div>
            <div class="field">
              <label for="cto-${cauldron.id}">いつまで</label>
              <input id="cto-${cauldron.id}" type="date" name="due_date"
                     value="${esc(cauldron.due_date ?? '')}" />
            </div>
          </div>
          <div class="btn-row"><button type="submit">日付を保存</button></div>
        </form>
      </details>

      <form class="material-add" data-add="${cauldron.id}">
        <div class="field">
          <textarea id="mat-${cauldron.id}" rows="2"></textarea>
        </div>
        <div class="btn-row">
          <button type="submit">投入</button>
          <button type="button" class="ghost danger" data-drop="${cauldron.id}"
                  data-name="${esc(cauldron.title)}">大釜を捨てる</button>
        </div>
      </form>
    </div>
  `;
}

function materialRow(material) {
  const done = material.status === 'done';
  const abandoned = material.status === 'abandoned';
  return `
    <div class="material ${done ? 'is-done' : ''} ${abandoned ? 'is-abandoned' : ''}">
      <button type="button" class="material-check" data-toggle-material="${material.id}"
              data-status="${material.status}"
              aria-label="${done ? '未完了に戻す' : '完了にする'}">${done ? '✓' : ''}</button>
      <div class="material-body">
        <div class="material-title">${esc(material.title)}</div>
      ${
        material.estimated_time || material.estimated_money || material.due_date || abandoned
          ? `<div class="material-meta">${[
              material.estimated_time ? fmtTime(material.estimated_time) : '',
              material.estimated_money ? fmtMoney(material.estimated_money) : '',
              material.due_date ? `〜${fmtShortDay(material.due_date)}` : '',
              abandoned ? '断念' : '',
            ]
              .filter(Boolean)
              .map(esc)
              .join(' · ')}</div>`
          : ''
      }
      </div>
      ${
        abandoned
          ? `<button type="button" class="ghost material-drop"
               data-material-act="reopen" data-id="${material.id}">戻す</button>`
          : done
            ? ''
            : `<button type="button" class="ghost danger material-drop"
                 data-material-act="abandon" data-id="${material.id}">要らない</button>`
      }
    </div>
  `;
}

function wireCauldrons(container, entryId, kind) {
  const reload = () => renderEntry(kind, entryId);

  container.addEventListener('submit', async (event) => {
    const dates = event.target.closest('form[data-cauldron-dates]');
    if (dates) {
      event.preventDefault();
      try {
        await api(`/cauldrons/${dates.dataset.cauldronDates}`, {
          method: 'PATCH',
          body: {
            start_date: dates.elements.start_date.value || null,
            due_date: dates.elements.due_date.value || null,
          },
        });
        toast('大釜の日付を保存しました');
        await reload();
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    const form = event.target.closest('form[data-add]');
    if (!form) return;
    event.preventDefault();
    const box = form.querySelector('textarea');
    const titles = box.value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (titles.length === 0) return box.focus();
    try {
      await api(`/cauldrons/${form.dataset.add}/materials`, {
        method: 'POST',
        body: { items: titles.map((title) => ({ title })) },
      });
      toast(`${titles.length}個の素材を投入しました`);
      await reload();
    } catch (err) {
      toast(err.message, true);
    }
  });

  container.addEventListener('click', async (event) => {
    const check = event.target.closest('button[data-toggle-material]');
    const act = event.target.closest('button[data-material-act]');
    const drop = event.target.closest('button[data-drop]');
    if (!check && !act && !drop) return;

    try {
      if (check) {
        const next = check.dataset.status === 'done' ? 'reopen' : 'complete';
        await api(`/missions/${check.dataset.toggleMaterial}/${next}`, { method: 'POST' });
      } else if (act) {
        await api(`/missions/${act.dataset.id}/${act.dataset.materialAct}`, { method: 'POST' });
      } else {
        if (!confirm(`大釜「${drop.dataset.name}」を捨てますか？（素材は単独のプロセスとして残ります）`)) return;
        await api(`/cauldrons/${drop.dataset.drop}`, { method: 'DELETE' });
        toast('大釜を捨てました');
      }
      await reload();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// アイデアの温度。設定した熱は 273K へ向かって冷めていくので、
// 「いま何度か」と「いつ何度に入れたか」の両方を出す。
function temperaturePanel(idea) {
  const current = idea.current_temperature;
  const level = heat(current);
  const days = Math.floor((Date.now() - new Date(idea.temperature_at).getTime()) / 86_400_000);

  return `
    <div class="section-title">温度</div>
    <div class="panel">
      <div class="temp-head">
        <span class="temp temp-${level.key} temp-big">${heatIcon(current)}<span
          id="temp-value">${current}K</span></span>
        <span class="temp-label" id="temp-label">${esc(level.label)}・${toCelsius(current)}℃</span>
      </div>
      <input type="range" id="temp-range" min="${AMBIENT_K}" max="${MAX_K}" step="1"
             value="${current}" aria-label="アイデアの温度" />
      <div class="temp-scale">
        <span>${AMBIENT_K}K 凍結</span>
        <span>${MAX_K}K 沸騰</span>
      </div>
      <div class="stat-line">
        <span>入れた熱</span>
        <span class="v">${idea.temperature}K（${days === 0 ? '今日' : `${days}日前`}）</span>
      </div>
      <div class="btn-row">
        <button type="button" id="temp-save" class="primary">この熱さに入れ直す</button>
      </div>
    </div>
  `;
}

function wireTemperature(idea, entryId) {
  const range = document.getElementById('temp-range');
  const value = document.getElementById('temp-value');
  const label = document.getElementById('temp-label');
  const chip = value.closest('.temp');

  range.addEventListener('input', () => {
    const kelvin = Number(range.value);
    const level = heat(kelvin);
    value.textContent = `${kelvin}K`;
    label.textContent = `${level.label}・${toCelsius(kelvin)}℃`;
    chip.className = `temp temp-${level.key} temp-big`;
    chip.firstChild.replaceWith(
      new DOMParser().parseFromString(heatIcon(kelvin), 'image/svg+xml').documentElement,
    );
  });

  document.getElementById('temp-save').addEventListener('click', async () => {
    try {
      await api(`/ideas/${entryId}`, {
        method: 'PATCH',
        body: { temperature: Number(range.value) },
      });
      toast('熱を入れ直しました');
      await renderEntry('idea', entryId);
    } catch (err) {
      toast(err.message, true);
    }
  });
}

async function renderEntry(kind, entryId) {
  setActiveTab('stream');
  setTopbar({ title: KIND_LABEL[kind], back: '#/stream' });
  viewEl.innerHTML = '<div class="empty">読み込み中…</div>';

  const path = kind === 'idea' ? `/ideas/${entryId}` : `/logs/${entryId}`;
  const entry = await api(path);
  const at = kind === 'idea' ? entry.created_at : entry.occurred_at;
  // 大釜に入っているプロセスは大釜のほうに出すので、こちらからは外す。
  // 大釜を伏せている間は外さない。外すとどこからも出てこなくなる。
  const loose = SHOW.cauldron
    ? entry.missions.filter((mission) => !mission.cauldron_id)
    : entry.missions;

  viewEl.innerHTML = `
    ${/* いちばん使うのはプロセスを足すこと。1ページ目に置く。 */ ''}
    <div class="section-title">プロセスを追加</div>
    <form class="panel" id="mission-form">
      <div class="field">
        <input id="m-title" autocomplete="off" />
      </div>
      <details class="optional">
        <summary>見積と日付</summary>
        <div class="row">
          <div class="field">
            <label for="m-time">タイム（時間）</label>
            <input id="m-time" type="number" step="0.25" min="0" value="0" />
          </div>
          <div class="field">
            <label for="m-money">ウォレット（円）</label>
            <input id="m-money" type="number" step="1" min="0" value="0" />
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label for="m-from">いつから</label>
            <input id="m-from" type="date" />
          </div>
          <div class="field">
            <label for="m-to">いつまで</label>
            <input id="m-to" type="date" />
          </div>
        </div>
      </details>
      <div class="btn-row"><button type="submit" class="primary">追加</button></div>
    </form>

    <div class="section-title">${SHOW.cauldron ? '単独のプロセス' : 'プロセス'}</div>
    <div class="list" id="entry-missions">
      ${
        loose.length
          ? loose.map((m) => missionCard(m, { showSource: false })).join('')
          : '<div class="empty">プロセスはありません</div>'
      }
    </div>

    <div class="section-title">${KIND_LABEL[kind]} #${entryId}</div>
    <form class="panel" id="entry-form">
      <div class="field">
        <label for="title">タイトル</label>
        <input id="title" value="${esc(entry.title)}" autocomplete="off" />
      </div>
      ${
        kind === 'log'
          ? `<div class="field">
               <div class="seg-toggle seg-3" id="goods-toggle">
                 ${['log', 'food', 'gear']
                   .map(
                     (face) => `<button type="button" data-goods="${
                       face === 'log' ? '' : face
                     }" aria-pressed="${(entry.goods ?? 'log') === face}">${icon(
                       KIND_ICON[face],
                     )}${KIND_LABEL[face]}</button>`,
                   )
                   .join('')}
               </div>
             </div>
             <div class="row">
               <div class="field">
                 <label for="time-spent">消費タイム（時間）</label>
                 <input id="time-spent" type="number" step="0.25" min="0"
                        value="${minutesToHours(entry.time_spent)}" />
               </div>
               <div class="field">
                 <label for="money-spent">消費ウォレット（円）</label>
                 <input id="money-spent" type="number" step="1" min="0"
                        value="${entry.money_spent}" />
               </div>
             </div>`
          : ''
      }
      <div class="stat-line"><span>${kind === 'idea' ? '作成' : '発生'}</span><span class="v">${esc(fmtDate(at))}</span></div>
      ${
        entry.source_mission
          ? `<div class="stat-line"><span>由来</span><span class="v">プロセス完了「${esc(entry.source_mission.title)}」</span></div>`
          : ''
      }
      ${
        entry.source_recurrence
          ? `<div class="stat-line"><span>由来</span><span class="v"><a class="link" href="#/recurrence/${
              entry.source_recurrence.id
            }">定期イベント「${esc(entry.source_recurrence.title)}」</a></span></div>`
          : ''
      }
      <div class="btn-row">
        <button type="submit" class="primary">保存</button>
        ${kind === 'log' ? legacyButton('log', entry.id, entry.is_legacy) : ''}
      </div>
    </form>

    ${
      SHOW.cauldron
        ? `<div class="section-title">大釜</div>
    <div id="entry-cauldrons">
      ${entry.cauldrons.map(cauldronPanel).join('')}
      <details class="panel optional-panel">
        <summary>大釜を用意する</summary>
        <form id="cauldron-new">
          <div class="field">
            <input id="c-title" autocomplete="off" />
          </div>
          <details class="optional">
            <summary>日付</summary>
            <div class="row">
              <div class="field">
                <label for="c-from">いつから</label>
                <input id="c-from" type="date" />
              </div>
              <div class="field">
                <label for="c-to">いつまで</label>
                <input id="c-to" type="date" />
              </div>
            </div>
          </details>
          <div class="btn-row"><button type="submit" class="primary">用意する</button></div>
        </form>
      </details>
    </div>`
        : ''
    }

    ${SHOW.temperature && kind === 'idea' ? temperaturePanel(entry) : ''}

  `;

  const goodsToggle = document.getElementById('goods-toggle');
  if (goodsToggle) {
    goodsToggle.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-goods]');
      if (!button) return;
      for (const b of goodsToggle.querySelectorAll('button')) {
        b.setAttribute('aria-pressed', String(b === button));
      }
    });
  }

  document.getElementById('entry-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = { title: document.getElementById('title').value.trim() };
    if (kind === 'log') {
      body.time_spent = hoursToMinutes(document.getElementById('time-spent').value);
      body.money_spent = Math.round(Number(document.getElementById('money-spent').value || 0));
      body.goods = document.querySelector('#goods-toggle [aria-pressed="true"]').dataset.goods
        || null;
    }
    try {
      await api(path, { method: 'PATCH', body });
      toast('保存しました');
    } catch (err) {
      toast(err.message, true);
    }
  });

  if (SHOW.temperature && kind === 'idea') wireTemperature(entry, entryId);

  if (SHOW.cauldron) {
    wireCauldrons(document.getElementById('entry-cauldrons'), entryId, kind);
    document.getElementById('cauldron-new').addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = document.getElementById('c-title');
      const title = input.value.trim();
      if (!title) return input.focus();
      try {
        await api('/cauldrons', {
          method: 'POST',
          body: {
            title,
            source_type: kind,
            source_id: entryId,
            start_date: document.getElementById('c-from').value || null,
            due_date: document.getElementById('c-to').value || null,
          },
        });
        toast('大釜を用意しました');
        await renderEntry(kind, entryId);
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  document.getElementById('mission-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = document.getElementById('m-title').value.trim();
    if (!title) return toast('やることを入力してください', true);
    try {
      await api('/missions', {
        method: 'POST',
        body: {
          title,
          source_type: kind,
          source_id: entry.id,
          estimated_time: hoursToMinutes(document.getElementById('m-time').value),
          estimated_money: Math.round(Number(document.getElementById('m-money').value || 0)),
          start_date: document.getElementById('m-from').value || null,
          due_date: document.getElementById('m-to').value || null,
        },
      });
      toast('プロセスを追加しました');
      await renderEntry(kind, entryId);
    } catch (err) {
      toast(err.message, true);
    }
  });

  wireMissionActions(document.getElementById('entry-missions'), () => renderEntry(kind, entryId));
  wireLegacy(viewEl, () => renderEntry(kind, entryId));
}

/* ---------- プロセス ---------- */

let missionFilter = 'active';
let missionSort = 'due';

async function renderMissions() {
  setActiveTab('missions');
  setTopbar({ title: 'プロセス' });

  const missions = await api(`/missions?status=${missionFilter}&sort=${missionSort}`);
  const totals = missions.reduce(
    (acc, m) => ({
      time: acc.time + m.estimated_time,
      money: acc.money + m.estimated_money,
    }),
    { time: 0, money: 0 },
  );

  viewEl.innerHTML = `
    <div class="filters">
      ${['active', 'abandoned', 'done']
        .map(
          (status) => `<button class="filter" data-filter="${status}"
             aria-pressed="${missionFilter === status}">${STATUS_LABEL[status]}</button>`,
        )
        .join('')}
    </div>
    <div class="filters">
      <button class="filter" data-sort="due" aria-pressed="${
        missionSort === 'due'
      }">期限順</button>
      <button class="filter" data-sort="recent" aria-pressed="${
        missionSort === 'recent'
      }">新しい順</button>
    </div>
    ${
      // 1行に畳む。2行あると札が1枚しか同じページに乗らない。
      (() => {
        const undated = missions.filter((m) => !m.due_date).length;
        return `<div class="panel tight">
          <div class="stat-line">
            <span>${missions.length}件 / ${esc(STATUS_LABEL[missionFilter])}${
              missionSort === 'due' && undated ? `（期限なし ${undated}）` : ''
            }</span>
            <span class="v">${esc(fmtTime(totals.time))} · ${esc(fmtMoney(totals.money))}</span>
          </div>
        </div>`;
      })()
    }
    <div class="list" id="mission-list">
      ${
        missions.length
          ? missions.map((m) => missionCard(m)).join('')
          : '<div class="empty">該当するプロセスはありません</div>'
      }
    </div>
  `;

  for (const button of viewEl.querySelectorAll('.filter[data-filter]')) {
    button.addEventListener('click', () => {
      missionFilter = button.dataset.filter;
      renderMissions();
    });
  }
  for (const button of viewEl.querySelectorAll('.filter[data-sort]')) {
    button.addEventListener('click', () => {
      missionSort = button.dataset.sort;
      renderMissions();
    });
  }
  wireMissionActions(document.getElementById('mission-list'), renderMissions);
  wireLegacy(document.getElementById('mission-list'), renderMissions);
}

/* ---------- 設定 ---------- */

// タイムは週、ウォレットは月を1期間として使える量を管理する。
const BUDGET_UI = {
  time: {
    title: 'タイム（週別）',
    unit: '時間',
    step: '0.5',
    toInput: (amount) => minutesToHours(amount),
    fromInput: (value) => hoursToMinutes(value),
    format: fmtTime,
  },
  money: {
    title: 'ウォレット（週別）',
    unit: '円',
    step: '100',
    toInput: (amount) => amount,
    fromInput: (value) => Math.round(Number(value || 0)),
    format: fmtMoney,
  },
};

// 一覧に何期間ぶんの過去を含めるか。「さらに過去」で伸びる。
// 過去は「さらに過去」で伸ばせる。最初から6期ぶん開くと、設定だけで2ページ食う。
const budgetWindow = { time: 3, money: 3 };

function budgetSection(kind, rows) {
  const ui = BUDGET_UI[kind];
  return `
    <div class="section-title">${esc(ui.title)}</div>
    <form class="panel budget-form" data-kind="${kind}">
      ${rows
        .map(
          (row) => `
        <div class="budget-row">
          <div>
            <div class="budget-key">${esc(row.label)}${
              row.is_current ? '<span class="badge now">現在</span>' : ''
            }</div>
            <div class="budget-consumed">消費 ${esc(ui.format(row.consumed))}</div>
          </div>
          <input type="number" min="0" step="${ui.step}"
                 data-key="${esc(row.key)}"
                 data-original="${ui.toInput(row.amount)}"
                 value="${ui.toInput(row.amount)}"
                 aria-label="${esc(row.label)} の${esc(ui.unit)}" />
          ${
            row.source === 'override'
              ? `<button type="button" class="ghost" data-reset="${esc(row.key)}">既定へ</button>`
              : '<div class="budget-src">既定</div>'
          }
        </div>`,
        )
        .join('')}
      <div class="btn-row">
        <button type="button" data-more>さらに過去</button>
        <button type="submit" class="primary">保存</button>
      </div>
    </form>
  `;
}

async function renderSettings() {
  setActiveTab('home');
  setTopbar({ title: '設定', back: '#/home' });

  const [settings, timeBudgets, moneyBudgets] = await Promise.all([
    api('/settings'),
    api(`/budgets?kind=time&past=${budgetWindow.time}`),
    api(`/budgets?kind=money&past=${budgetWindow.money}`),
  ]);

  // 塗りが無ければ空の表から始める。
  const grid = (settings.time_grid ?? '').length === 168 ? settings.time_grid : '0'.repeat(168);

  viewEl.innerHTML = `
    <div class="section-title">週のタイム</div>
    <div class="panel" id="time-grid-panel">
      <div class="tg-top">
        <span class="tg-total" id="tg-total"></span>
        <button type="button" class="ghost" id="tg-clear">全部消す</button>
      </div>
      ${timeGridMarkup(grid)}
      <div class="btn-row"><button type="button" class="primary" id="tg-save">保存</button></div>
    </div>

    <div class="section-title">報酬</div>
    <form class="panel" id="settings-form">
      <div class="field">
        <label for="monthly-money">月あたり（円）</label>
        <input id="monthly-money" type="number" step="100" min="0" value="${settings.monthly_money}" />
      </div>
      <div class="stat-line">
        <span>週のウォレット</span>
        <span class="v" id="weekly-share">${esc(fmtMoney(Math.round(settings.monthly_money / 4)))}</span>
      </div>
      <div class="btn-row"><button type="submit" class="primary">保存</button></div>
    </form>

    ${
      SHOW.temperature
        ? `<div class="section-title">アイデアの冷却</div>
    <form class="panel" id="cooling-form">
      <div class="field">
        <label for="half-life">冷却の半減期（日）</label>
        <input id="half-life" type="number" step="1" min="0"
               value="${settings.cooling_half_life_days}" />
      </div>
      <div class="btn-row"><button type="submit" class="primary">保存</button></div>
    </form>`
        : ''
    }

    <div class="section-title">定期イベント</div>
    <a class="card nav-card" href="#/recurrences">
      <div class="card-title">${icon('hourglass')}<span>定期的に起こる出来事の登録</span></div>
    </a>

    <div class="section-title">金庫</div>
    <a class="card nav-card" href="#/vault">
      <div class="card-title">${icon('coins')}<span>金庫の初期残高と積立</span></div>
    </a>

    ${budgetSection('time', timeBudgets)}
    ${budgetSection('money', moneyBudgets)}
  `;

  // 打っている最中に、4で割った週ぶんが見えるようにする。
  const rewardInput = document.getElementById('monthly-money');
  rewardInput.addEventListener('input', () => {
    document.getElementById('weekly-share').textContent =
      fmtMoney(Math.round(Number(rewardInput.value || 0) / 4));
  });

  document.getElementById('settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/settings', {
        method: 'PUT',
        body: {
          monthly_money: Math.round(Number(document.getElementById('monthly-money').value || 0)),
        },
      });
      toast('既定値を保存しました');
      await renderSettings();
    } catch (err) {
      toast(err.message, true);
    }
  });

  wireTimeGrid(document.getElementById('time-grid-panel'), grid);

  if (SHOW.temperature) {
    document.getElementById('cooling-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('/settings', {
          method: 'PUT',
          body: {
            cooling_half_life_days: Math.round(
              Number(document.getElementById('half-life').value || 0),
            ),
          },
        });
        toast('冷却の設定を保存しました');
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  for (const form of viewEl.querySelectorAll('.budget-form')) {
    const kind = form.dataset.kind;
    const ui = BUDGET_UI[kind];

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const changed = [...form.querySelectorAll('input[data-key]')].filter(
        (input) => input.value !== input.dataset.original,
      );
      if (changed.length === 0) return toast('変更はありません');
      try {
        for (const input of changed) {
          await api(`/budgets/${kind}/${input.dataset.key}`, {
            method: 'PUT',
            body: { amount: ui.fromInput(input.value) },
          });
        }
        toast(`${changed.length}件の期間を保存しました`);
        await renderSettings();
      } catch (err) {
        toast(err.message, true);
      }
    });

    form.addEventListener('click', async (event) => {
      const reset = event.target.closest('button[data-reset]');
      if (reset) {
        try {
          await api(`/budgets/${kind}/${reset.dataset.reset}`, { method: 'DELETE' });
          toast('既定値に戻しました');
          await renderSettings();
        } catch (err) {
          toast(err.message, true);
        }
        return;
      }
      if (event.target.closest('button[data-more]')) {
        budgetWindow[kind] += 8;
        await renderSettings();
      }
    });
  }
}

/* ---------- 定期イベント ---------- */

const FREQ_LABEL = { daily: '毎日', weekly: '毎週', monthly: '毎月' };

function scheduleText(recurrence) {
  if (recurrence.freq === 'daily') return '毎日';
  if (recurrence.freq === 'weekly') return `毎週 ${WEEKDAYS[recurrence.weekday]}曜`;
  return `毎月 ${recurrence.month_day}日`;
}

function fmtDay(key) {
  const date = new Date(`${key}T00:00:00`);
  if (Number.isNaN(date.getTime())) return key;
  return `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAYS[(date.getDay() + 6) % 7]})`;
}

// 定義の入力欄。新規登録と編集で同じものを使う。
function recurrenceFields(recurrence = null) {
  const freq = recurrence?.freq ?? 'weekly';
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  return `
    <div class="field">
      <input id="r-title" autocomplete="off"
             value="${esc(recurrence?.title ?? '')}" />
    </div>
    <div class="row">
      <div class="field">
        <label for="r-freq">繰り返し</label>
        <select id="r-freq">
          ${Object.entries(FREQ_LABEL)
            .map(
              ([value, label]) =>
                `<option value="${value}" ${freq === value ? 'selected' : ''}>${label}</option>`,
            )
            .join('')}
        </select>
      </div>
      <div class="field" id="r-weekday-field" ${freq === 'weekly' ? '' : 'hidden'}>
        <label for="r-weekday">曜日</label>
        <select id="r-weekday">
          ${WEEKDAYS.map(
            (label, index) =>
              `<option value="${index}" ${
                (recurrence?.weekday ?? 2) === index ? 'selected' : ''
              }>${label}</option>`,
          ).join('')}
        </select>
      </div>
      <div class="field" id="r-monthday-field" ${freq === 'monthly' ? '' : 'hidden'}>
        <label for="r-monthday">日</label>
        <select id="r-monthday">
          ${Array.from({ length: 31 }, (_, i) => i + 1)
            .map(
              (day) =>
                `<option value="${day}" ${
                  (recurrence?.month_day ?? 1) === day ? 'selected' : ''
                }>${day}</option>`,
            )
            .join('')}
        </select>
      </div>
    </div>
    <div class="row">
      <div class="field">
        <label for="r-time">消費タイム（時間）</label>
        <input id="r-time" type="number" step="0.25" min="0"
               value="${minutesToHours(recurrence?.time_spent ?? 0)}" />
      </div>
      <div class="field">
        <label for="r-money">消費ウォレット（円）</label>
        <input id="r-money" type="number" step="100" min="0"
               value="${recurrence?.money_spent ?? 0}" />
      </div>
    </div>
    <details class="optional" ${recurrence?.end_date ? 'open' : ''}>
      <summary>期間</summary>
      <div class="row">
        <div class="field">
          <label for="r-start">開始日</label>
          <input id="r-start" type="date" value="${esc(recurrence?.start_date ?? todayKey)}" />
        </div>
        <div class="field">
          <label for="r-end">終了日</label>
          <input id="r-end" type="date" value="${esc(recurrence?.end_date ?? '')}" />
        </div>
      </div>
    </details>
  `;
}

// 繰り返しの種類に応じて曜日／日の欄を出し分ける。
function wireFreqToggle(scope) {
  const freq = scope.querySelector('#r-freq');
  const apply = () => {
    scope.querySelector('#r-weekday-field').hidden = freq.value !== 'weekly';
    scope.querySelector('#r-monthday-field').hidden = freq.value !== 'monthly';
  };
  freq.addEventListener('change', apply);
  apply();
}

function readRecurrenceFields(scope) {
  const freq = scope.querySelector('#r-freq').value;
  const end = scope.querySelector('#r-end').value;
  return {
    title: scope.querySelector('#r-title').value.trim(),
    freq,
    weekday: freq === 'weekly' ? Number(scope.querySelector('#r-weekday').value) : null,
    month_day: freq === 'monthly' ? Number(scope.querySelector('#r-monthday').value) : null,
    time_spent: hoursToMinutes(scope.querySelector('#r-time').value),
    money_spent: Math.round(Number(scope.querySelector('#r-money').value || 0)),
    start_date: scope.querySelector('#r-start').value,
    end_date: end === '' ? null : end,
  };
}

async function renderRecurrences() {
  setActiveTab('home');
  setTopbar({ title: '定期イベント', back: '#/settings' });
  viewEl.innerHTML = '<div class="empty">読み込み中…</div>';

  const recurrences = await api('/recurrences');

  viewEl.innerHTML = `
    <div class="section-title">登録済み</div>
    <div class="list">
      ${
        recurrences.length
          ? recurrences
              .map(
                (r) => `
        <a class="card kind-recurrence ${r.active ? '' : 'is-paused'}" href="#/recurrence/${r.id}">
          <div class="card-top">
            <span class="badge recurrence">${esc(scheduleText(r))}</span>
            ${r.active ? '' : '<span class="badge abandoned">停止中</span>'}
            <span class="spacer"></span>
            <span>${r.next_date ? `次回 ${esc(fmtDay(r.next_date))}` : '予定なし'}</span>
          </div>
          <div class="card-title">${icon('hourglass')}<span>${esc(r.title)}</span></div>
          <div class="card-meta">
            <span>タイム ${esc(fmtTime(r.time_spent))}</span>
            <span>ウォレット ${esc(fmtMoney(r.money_spent))}</span>
          </div>
        </a>`,
              )
              .join('')
          : '<div class="empty">定期イベントはまだありません</div>'
      }
    </div>

    <div class="section-title">新しく登録</div>
    <form class="panel" id="recurrence-new">
      ${recurrenceFields()}
      <div class="btn-row"><button type="submit" class="primary">登録</button></div>
    </form>
  `;

  const form = document.getElementById('recurrence-new');
  wireFreqToggle(form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const created = await api('/recurrences', {
        method: 'POST',
        body: readRecurrenceFields(form),
      });
      toast('定期イベントを登録しました');
      location.hash = `#/recurrence/${created.id}`;
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function occurrenceRow(occurrence) {
  const badges = [];
  if (occurrence.status === 'skipped') badges.push('<span class="badge abandoned">スキップ</span>');
  else if (occurrence.log_id) badges.push('<span class="badge log">記録済</span>');
  else badges.push('<span class="badge active">予定</span>');
  if (occurrence.is_overridden) badges.push('<span class="badge now">個別</span>');

  const skipped = occurrence.status === 'skipped';
  return `
    <div class="occurrence-row ${skipped ? 'is-skipped' : ''}">
      <div class="occurrence-head">
        <div class="occurrence-date">${esc(fmtDay(occurrence.date))} ${badges.join('')}</div>
        <div class="occurrence-actions">
          ${
            occurrence.is_overridden
              ? `<button type="button" class="ghost" data-reset="${esc(occurrence.date)}">既定へ</button>`
              : ''
          }
          <button type="button" class="ghost ${skipped ? '' : 'danger'}"
                  data-toggle="${esc(occurrence.date)}"
                  data-status="${skipped ? 'scheduled' : 'skipped'}">
            ${skipped ? '戻す' : 'スキップ'}
          </button>
        </div>
      </div>
      <div class="occurrence-inputs">
        <label>タイム(h)
          <input type="number" step="0.25" min="0" data-field="time_spent"
                 data-date="${esc(occurrence.date)}"
                 data-original="${minutesToHours(occurrence.time_spent)}"
                 value="${minutesToHours(occurrence.time_spent)}" ${skipped ? 'disabled' : ''} />
        </label>
        <label>ウォレット(円)
          <input type="number" step="100" min="0" data-field="money_spent"
                 data-date="${esc(occurrence.date)}"
                 data-original="${occurrence.money_spent}"
                 value="${occurrence.money_spent}" ${skipped ? 'disabled' : ''} />
        </label>
      </div>
    </div>
  `;
}

async function renderRecurrence(recurrenceId) {
  setActiveTab('home');
  setTopbar({ title: '定期イベント', back: '#/recurrences' });
  viewEl.innerHTML = '<div class="empty">読み込み中…</div>';

  const recurrence = await api(`/recurrences/${recurrenceId}?back=6&ahead=6`);

  viewEl.innerHTML = `
    <div class="section-title">定義</div>
    <form class="panel" id="recurrence-form">
      ${recurrenceFields(recurrence)}
      <div class="btn-row">
        <button type="submit" class="primary">保存</button>
        <button type="button" class="ghost" id="toggle-active">
          ${recurrence.active ? '停止する' : '再開する'}
        </button>
      </div>
      <div class="btn-row">
        <button type="button" class="ghost danger" id="delete-recurrence">この定期イベントを削除</button>
      </div>
    </form>

    <div class="section-title">直近の回</div>
    <form class="panel" id="occurrence-list">
      ${recurrence.occurrences.map(occurrenceRow).join('')}
      <div class="btn-row"><button type="submit" class="primary">変更を保存</button></div>
    </form>
  `;

  const form = document.getElementById('recurrence-form');
  wireFreqToggle(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api(`/recurrences/${recurrenceId}`, {
        method: 'PATCH',
        body: readRecurrenceFields(form),
      });
      toast('保存しました');
      await renderRecurrence(recurrenceId);
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('toggle-active').addEventListener('click', async () => {
    try {
      await api(`/recurrences/${recurrenceId}`, {
        method: 'PATCH',
        body: { active: recurrence.active ? 0 : 1 },
      });
      toast(recurrence.active ? '停止しました' : '再開しました');
      await renderRecurrence(recurrenceId);
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('delete-recurrence').addEventListener('click', async () => {
    if (!confirm('この定期イベントを削除しますか？（生成済みのログは残ります）')) return;
    try {
      await api(`/recurrences/${recurrenceId}`, { method: 'DELETE' });
      toast('削除しました');
      location.hash = '#/recurrences';
    } catch (err) {
      toast(err.message, true);
    }
  });

  const list = document.getElementById('occurrence-list');

  list.addEventListener('submit', async (event) => {
    event.preventDefault();
    const byDate = new Map();
    for (const input of list.querySelectorAll('input[data-date]')) {
      if (input.disabled || input.value === input.dataset.original) continue;
      const body = byDate.get(input.dataset.date) ?? {};
      body[input.dataset.field] =
        input.dataset.field === 'time_spent'
          ? hoursToMinutes(input.value)
          : Math.round(Number(input.value || 0));
      byDate.set(input.dataset.date, body);
    }
    if (byDate.size === 0) return toast('変更はありません');
    try {
      for (const [date, body] of byDate) {
        await api(`/recurrences/${recurrenceId}/occurrences/${date}`, { method: 'PATCH', body });
      }
      toast(`${byDate.size}回ぶんを保存しました`);
      await renderRecurrence(recurrenceId);
    } catch (err) {
      toast(err.message, true);
    }
  });

  list.addEventListener('click', async (event) => {
    const toggle = event.target.closest('button[data-toggle]');
    const reset = event.target.closest('button[data-reset]');
    if (!toggle && !reset) return;
    try {
      if (toggle) {
        await api(`/recurrences/${recurrenceId}/occurrences/${toggle.dataset.toggle}`, {
          method: 'PATCH',
          body: { status: toggle.dataset.status },
        });
        toast(toggle.dataset.status === 'skipped' ? 'スキップしました' : '予定に戻しました');
      } else {
        await api(`/recurrences/${recurrenceId}/occurrences/${reset.dataset.reset}`, {
          method: 'DELETE',
        });
        toast('定義どおりに戻しました');
      }
      await renderRecurrence(recurrenceId);
    } catch (err) {
      toast(err.message, true);
    }
  });
}

/* ---------- インゴット ---------- */

// インゴットは「したいこと」ではなく、良いと思った物事を持っておくもの。
// 時系列の出来事ではないのでストリームには出さず、ここに溜める。
async function renderSpells() {
  setActiveTab('home');
  setTopbar({ title: 'インゴット', back: '#/home' });
  viewEl.innerHTML = '<div class="empty">読み込み中…</div>';

  const spells = await api('/spells');

  viewEl.innerHTML = `
    <form class="panel" id="spell-new">
      <div class="field">
        <input id="s-title" autocomplete="off" />
      </div>
      <div class="btn-row"><button type="submit" class="primary">書き留める</button></div>
    </form>

    <div class="section-title">インゴット<span class="section-count">${spells.length}</span></div>
    <div class="list">
      ${
        spells.length
          ? spells
              .map(
                (spell) => `
        <a class="card kind-spell" href="#/spell/${spell.id}">
          <div class="card-top">
            <span class="spacer"></span>
            <span>${esc(fmtDate(spell.created_at))}</span>
          </div>
          <div class="card-title">${icon('sigil')}<span>${esc(spell.title)}</span></div>
          ${spell.body ? `<div class="spell-excerpt">${esc(spell.body)}</div>` : ''}
          ${
            spell.mission_count
              ? `<div class="card-meta"><span class="${
                  spell.active_mission_count ? 'hot' : ''
                }">プロセス ${spell.mission_count}件${
                  spell.active_mission_count ? `（進行中 ${spell.active_mission_count}）` : ''
                }</span></div>`
              : ''
          }
        </a>`,
              )
              .join('')
          : '<div class="empty">まだ何も書かれていません</div>'
      }
    </div>
  `;

  document.getElementById('spell-new').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.getElementById('s-title');
    const title = input.value.trim();
    if (!title) return input.focus();
    try {
      const created = await api('/spells', { method: 'POST', body: { title } });
      toast('インゴットを書き留めました');
      location.hash = `#/spell/${created.id}`;
    } catch (err) {
      toast(err.message, true);
    }
  });
}

async function renderSpell(spellId) {
  setActiveTab('home');
  setTopbar({ title: 'インゴット', back: '#/spells' });
  viewEl.innerHTML = '<div class="empty">読み込み中…</div>';

  const spell = await api(`/spells/${spellId}`);

  viewEl.innerHTML = `
    <form class="panel" id="spell-form">
      <div class="field">
        <label for="title">インゴット</label>
        <input id="title" value="${esc(spell.title)}" autocomplete="off" />
      </div>
      <div class="field">
        <textarea id="body" rows="5">${esc(
          spell.body ?? '',
        )}</textarea>
      </div>
      <div class="btn-row">
        <button type="submit" class="primary">保存</button>
        <button type="button" class="ghost danger" id="spell-delete">捨てる</button>
      </div>
    </form>

    <div class="section-title">ここから出たプロセス</div>
    <div class="list" id="entry-missions">
      ${
        spell.missions.length
          ? spell.missions.map((m) => missionCard(m, { showSource: false })).join('')
          : '<div class="empty">まだありません</div>'
      }
    </div>

    <div class="section-title">プロセスを切り出す</div>
    <form class="panel" id="mission-form">
      <div class="field">
        <input id="m-title" autocomplete="off" />
      </div>
      <details class="optional">
        <summary>見積と日付</summary>
        <div class="row">
          <div class="field">
            <label for="m-time">タイム（時間）</label>
            <input id="m-time" type="number" step="0.25" min="0" value="0" />
          </div>
          <div class="field">
            <label for="m-money">ウォレット（円）</label>
            <input id="m-money" type="number" step="1" min="0" value="0" />
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label for="m-from">いつから</label>
            <input id="m-from" type="date" />
          </div>
          <div class="field">
            <label for="m-to">いつまで</label>
            <input id="m-to" type="date" />
          </div>
        </div>
      </details>
      <div class="btn-row"><button type="submit" class="primary">追加</button></div>
    </form>
  `;

  const reload = () => renderSpell(spellId);

  document.getElementById('spell-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api(`/spells/${spellId}`, {
        method: 'PATCH',
        body: {
          title: document.getElementById('title').value.trim(),
          body: document.getElementById('body').value,
        },
      });
      toast('保存しました');
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('spell-delete').addEventListener('click', async () => {
    if (!confirm('このインゴットを捨てますか？')) return;
    try {
      await api(`/spells/${spellId}`, { method: 'DELETE' });
      toast('インゴットを捨てました');
      location.hash = '#/spells';
    } catch (err) {
      toast(
        err.message === 'spell still has missions'
          ? 'プロセスが残っているので捨てられません'
          : err.message,
        true,
      );
    }
  });

  document.getElementById('mission-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = document.getElementById('m-title').value.trim();
    if (!title) return toast('やることを入力してください', true);
    try {
      await api('/missions', {
        method: 'POST',
        body: {
          title,
          source_type: 'idea',
          source_id: spellId,
          estimated_time: hoursToMinutes(document.getElementById('m-time').value),
          estimated_money: Math.round(Number(document.getElementById('m-money').value || 0)),
          start_date: document.getElementById('m-from').value || null,
          due_date: document.getElementById('m-to').value || null,
        },
      });
      toast('プロセスを切り出しました');
      await reload();
    } catch (err) {
      toast(err.message, true);
    }
  });

  wireMissionActions(document.getElementById('entry-missions'), reload);
  wireLegacy(viewEl, reload);
}

/* ---------- 金庫 ---------- */

// 月が終わると、その月のウォレットの余りが金庫に積まれる。
async function renderVault() {
  setActiveTab('home');
  setTopbar({ title: '金庫', back: '#/home' });
  viewEl.innerHTML = '<div class="empty">読み込み中…</div>';

  const vault = await api('/vault');

  viewEl.innerHTML = `
    <div class="panel vault-head">
      ${icon('coins', 'vault-mark')}
      <div class="vault-balance">${esc(fmtMoney(vault.balance))}</div>
      <div class="vault-note">
        初期 ${esc(fmtMoney(vault.initial))}
        ／ 積立 ${vault.deposited >= 0 ? '+' : ''}${esc(fmtMoney(vault.deposited))}
      </div>
    </div>

    <div class="stat-line" style="margin-top:12px">
      <span>${esc(vault.current_period.label)}（進行中）が終わったら</span>
      <span class="v ${vault.pending < 0 ? 'neg' : ''}">${
        vault.pending >= 0 ? '+' : ''
      }${esc(fmtMoney(vault.pending))}</span>
    </div>

    <div class="section-title">初期残高</div>
    <form class="panel" id="vault-form">
      <div class="field">
        <input id="vault-initial" type="number" step="1000" value="${vault.initial}" />
      </div>
      <div class="btn-row"><button type="submit" class="primary">保存</button></div>
    </form>

    <div class="section-title">週ごとの積立<span class="section-count">${
      vault.weeks.length
    }</span></div>
    ${
      vault.weeks.length
        ? `<div class="panel">${vault.weeks
            .map(
              (week) => `
        <div class="vault-row">
          <div>
            <div class="vault-month">${esc(week.label)}</div>
            <div class="vault-detail">全体 ${esc(fmtMoney(week.budget))} − 消費 ${esc(
              fmtMoney(week.consumed),
            )}</div>
          </div>
          <div class="vault-surplus ${week.surplus < 0 ? 'neg' : ''}">${
            week.surplus >= 0 ? '+' : ''
          }${esc(fmtMoney(week.surplus))}</div>
        </div>`,
            )
            .join('')}</div>`
        : '<div class="empty">まだ終わった週がありません</div>'
    }
  `;

  document.getElementById('vault-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/settings', {
        method: 'PUT',
        body: {
          vault_initial: Math.round(Number(document.getElementById('vault-initial').value || 0)),
        },
      });
      toast('初期残高を保存しました');
      await renderVault();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

/* ---------- 週のタイムを表で選ぶ ---------- */

const WEEK_HEAD = ['月', '火', '水', '木', '金', '土', '日'];

// 曜日×24時間。index = 曜日(0=月) * 24 + 時。
function timeGridMarkup(grid) {
  const cells = [];
  for (let hour = 0; hour < 24; hour += 1) {
    cells.push(
      `<div class="tg-hour ${hour % 6 === 0 ? 'is-mark' : ''}">${
        hour % 3 === 0 ? hour : ''
      }</div>`,
    );
    for (let day = 0; day < 7; day += 1) {
      const index = day * 24 + hour;
      cells.push(
        `<div class="tg-cell ${grid[index] === '1' ? 'is-on' : ''}" data-cell="${index}"></div>`,
      );
    }
  }
  return `
    <div class="tg">
      <div class="tg-corner"></div>
      ${WEEK_HEAD.map((day) => `<div class="tg-head">${day}</div>`).join('')}
      ${cells.join('')}
    </div>
  `;
}

function wireTimeGrid(root, initial) {
  const grid = [...initial];
  const total = root.querySelector('#tg-total');
  const surface = root.querySelector('.tg');
  let painting = false;
  let paintTo = '1';

  const refresh = () => {
    const hours = grid.filter((cell) => cell === '1').length;
    total.textContent = `${hours}h / 週`;
  };

  const paint = (cell) => {
    if (!cell) return;
    const index = Number(cell.dataset.cell);
    if (grid[index] === paintTo) return;
    grid[index] = paintTo;
    cell.classList.toggle('is-on', paintTo === '1');
    refresh();
  };

  surface.addEventListener('pointerdown', (event) => {
    const cell = event.target.closest('.tg-cell');
    if (!cell) return;
    event.preventDefault();
    painting = true;
    // 最初に触ったマスの逆の状態を、指を離すまで塗り続ける。
    paintTo = cell.classList.contains('is-on') ? '0' : '1';
    surface.setPointerCapture(event.pointerId);
    paint(cell);
  });

  // 指の下にあるマスを座標から拾う。捕捉中は pointermove が surface に来るため。
  surface.addEventListener('pointermove', (event) => {
    if (!painting) return;
    paint(document.elementFromPoint(event.clientX, event.clientY)?.closest('.tg-cell'));
  });

  const stop = () => {
    painting = false;
  };
  surface.addEventListener('pointerup', stop);
  surface.addEventListener('pointercancel', stop);

  root.querySelector('#tg-clear').addEventListener('click', () => {
    grid.fill('0');
    for (const cell of surface.querySelectorAll('.tg-cell')) cell.classList.remove('is-on');
    refresh();
  });

  root.querySelector('#tg-save').addEventListener('click', async () => {
    try {
      await api('/settings/time-grid', { method: 'PUT', body: { grid: grid.join('') } });
      toast('週のタイムを保存しました');
      await renderSettings();
    } catch (err) {
      toast(err.message, true);
    }
  });

  refresh();
}

/* ---------- タグの整理 ---------- */

/* ---------- レガシー ---------- */

function legacyButton(kind, id, isLegacy) {
  return `
    <button type="button" class="ghost legacy-btn ${isLegacy ? 'is-on' : ''}"
            data-legacy-kind="${kind}" data-legacy-id="${id}"
            data-legacy-value="${isLegacy ? 0 : 1}">
      ${icon('spark')}<span>${isLegacy ? 'レガシー解除' : 'レガシー'}</span>
    </button>
  `;
}

function wireLegacy(container, onChanged) {
  container.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-legacy-kind]');
    if (!button) return;
    event.preventDefault();
    const turningOn = button.dataset.legacyValue === '1';
    button.disabled = true;
    try {
      await api(`/legacies/${button.dataset.legacyKind}/${button.dataset.legacyId}`, {
        method: 'PUT',
        body: { is_legacy: turningOn },
      });
      toast(turningOn ? 'レガシーに刻みました' : 'レガシーから外しました');
      await onChanged();
    } catch (err) {
      toast(err.message, true);
      button.disabled = false;
    }
  });
}

/* ---------- アストロラーベ ----------

   たまっていく情報を、1枚の盤として描く。天体の位置を読む器具に見立てて、
   物事どうしの関わりを角度と輪で出す。
     節 = アイデア／ログ、軌道 = プロセス、大釜の節 = 素材の束、宝箱 = レガシー。
     入口はいちばん内側の輪に並び、外へ行くほど後の時間で、角度が枝分かれ。
     入口からいちばん奥の掘削中まで、軌道に灯を入れて進む先を示す。

   区画には割らない。何と何が関わっているかは、派生したプロセスだけが決める。

   光はぼかしで作らない。同じ中心の輪を段で重ねて滲みにする。
   ぼかすとこの画面だけ輪郭が溶けて、他と手ざわりが変わってしまう。 */

const GRID = {
  node: 11, // 節の半径
  ring: 74, // 軌道の間隔
  first: 84, // 中心から最初の軌道まで。ここが狭いと内側の節が触れ合う
  margin: 40, // いちばん外の節が収まるぶん
  icon: 14,
  spacing: 34, // 隣り合う葉のあいだに要る距離。内側の輪の大きさを決める
  // 盤を縦長の楕円にする比。真円のままだと、縦長の画面に置いたとき
  // 上下が大きく余って、そのぶん盤が小さく縮む。
  aspect: 1.5,
};

// 紙に引いた盤。地を白のままにして、節と軌道を墨と葉の色で置く。
// 暗い地の光り方は使えないので、滲みは薄い輪を重ねた「にじみ」として残す。
const SPHERE = {
  space: '#fbfaf5',
  guide: '#e2e2d6', // 軌道の案内線
  fleck: '#e8e7db', // 紙の斑
  bed: '#e7efe0', // 軌道の下敷き
  bedDim: '#eeede4',
  core: '#ffffff', // 節の中身
};

// 節の色。輪で描き、中は紙のまま抜く。
const NODE_HUE = {
  idea: { ring: '#b8452f', glow: '184, 69, 47' },
  spell: { ring: '#a8802a', glow: '168, 128, 42' },
  log: { ring: '#8a7a55', glow: '138, 122, 85' },
  cauldron: { ring: '#4e8b3a', glow: '78, 139, 58' },
  dead: { ring: '#b3b2a4', glow: '179, 178, 164' },
  digging: { ring: '#a8802a', glow: '168, 128, 42' },
};

const hasBranch = (room) => room.corridors.length + room.cauldrons.length > 0;

/* 節に (depth, slot) を振る。葉から順に区画を配り、親は子の平均に置く。
   これで枝が扇に開き、中心から外へ向かう盤になる。
   大釜は素材ごとに区画を取らず、1つに畳んで進み具合だけ出す。
   素材の先にさらに道が続いているものだけ、大釜から枝として伸ばす。

   道は1本ずつ盤にしない。入口を全部いちばん内側の輪に並べ、
   そこから外へ伸ばして1枚の盤にする。中心には何も置かない。
   入口どうしは無関係で、線で結ぶと在りもしない関わりを描くことになるため。 */
function layoutBoard(roads) {
  const nodes = [];
  let nextId = 0;
  let leaves = 0;

  const placeCorridor = (corridor, depth) => {
    const child = corridor.room
      ? place(corridor.room, depth)
      : { kind: 'dead', id: nextId++, depth, slot: leaves++, children: [] };
    if (!corridor.room) nodes.push(child);
    child.corridor = corridor;
    return child;
  };

  const mid = (children) =>
    children.reduce((sum, child) => sum + child.slot, 0) / children.length;

  const placeCauldron = (bundle, depth) => {
    const branching = bundle.corridors.filter((c) => c.room && hasBranch(c.room));
    const children = branching.map((corridor) => placeCorridor(corridor, depth + 1));
    const node = {
      kind: 'cauldron',
      id: nextId++,
      cauldron: bundle.cauldron,
      done: bundle.corridors.filter((c) => c.mission.status === 'done').length,
      needed: bundle.corridors.filter((c) => c.mission.status !== 'abandoned').length,
      depth,
      slot: children.length ? mid(children) : leaves++,
      children,
    };
    for (const child of children) child.parent = node;
    nodes.push(node);
    return node;
  };

  function place(room, depth) {
    // 大釜を伏せている間は、素材を束ねずに親の軌道として並べる。
    // 節ごと落とすと、その先に続く道まで盤から消えてしまう。
    const bundles = SHOW.cauldron ? room.cauldrons : [];
    const spliced = SHOW.cauldron
      ? room.corridors
      : [...room.corridors, ...room.cauldrons.flatMap((bundle) => bundle.corridors)];
    const children = [
      ...spliced.map((corridor) => placeCorridor(corridor, depth + 1)),
      ...bundles.map((bundle) => placeCauldron(bundle, depth + 1)),
    ];
    const node = {
      kind: 'room',
      id: nextId++,
      room,
      depth,
      slot: children.length ? mid(children) : leaves++,
      children,
    };
    for (const child of children) child.parent = node;
    nodes.push(node);
    return node;
  }

  for (const road of roads) place(road, 1);

  const total = Math.max(leaves, 1);
  const maxDepth = Math.max(1, ...nodes.map((n) => n.depth));

  /* いちばん内側の輪の大きさは、葉の数から決める。
     固定にすると、入口が増えたときに内側で節が重なって団子になる。 */
  const first = Math.max(GRID.first, (total * GRID.spacing) / (2 * Math.PI));
  const outer = first + (maxDepth - 1) * GRID.ring;
  const cx = outer + GRID.margin;
  const cy = cx * GRID.aspect;

  for (const node of nodes) {
    node.r = first + (node.depth - 1) * GRID.ring;
    // 真上から時計回りに配る。
    node.a = -Math.PI / 2 + ((node.slot + 0.5) / total) * Math.PI * 2;
    node.x = cx + node.r * Math.cos(node.a);
    node.y = cy + node.r * GRID.aspect * Math.sin(node.a);
  }

  /* 実際に節が居るところだけを切り出す。輪はいちばん深い道の形で決まるので、
     そのまま全体を映すと、誰も居ない外側の輪ぶんだけ盤が小さく縮む。 */
  // 札は外へ向けて置くので、横は札1つぶん広く取る。縦は行の高さだけでよい。
  const padX = GRID.node + 96;
  const padY = GRID.node + 34;
  const box = nodes.reduce(
    (b, n) => ({
      x0: Math.min(b.x0, n.x - padX),
      y0: Math.min(b.y0, n.y - padY),
      x1: Math.max(b.x1, n.x + padX),
      y1: Math.max(b.y1, n.y + padY),
    }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
  );

  return {
    nodes,
    cx,
    cy,
    maxDepth,
    first,
    view: { x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 },
  };
}

const ROOM_ICON = { idea: 'stone', spell: 'ingot', log: 'footsteps' };

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const n2 = (value) => Math.round(value * 100) / 100;

// 盤は楕円なので、縦だけ比をかける。
const onRing = (cx, cy, r, a) => [
  cx + r * Math.cos(a),
  cy + r * GRID.aspect * Math.sin(a),
];

/* 親の軌道を子の角度まで回ってから、外へ抜ける。
   斜めに直線で結ぶと蜘蛛の巣になるので、必ず軌道に沿わせる。 */
function trackPath(cx, cy, parent, child) {
  const [px, py] = onRing(cx, cy, parent.r, parent.a);
  const [bx, by] = onRing(cx, cy, child.r, child.a);
  let turn = child.a - parent.a;
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;

  if (parent.r < 1 || Math.abs(turn) < 0.002) {
    return `M ${n2(px)} ${n2(py)} L ${n2(bx)} ${n2(by)}`;
  }
  const [ax, ay] = onRing(cx, cy, parent.r, child.a);
  const sweep = turn > 0 ? 1 : 0;
  const large = Math.abs(turn) > Math.PI ? 1 : 0;
  // 輪が楕円なので、弧の半径も縦だけ伸ばす。
  return `M ${n2(px)} ${n2(py)} A ${n2(parent.r)} ${n2(parent.r * GRID.aspect)} 0 ${large} `
    + `${sweep} ${n2(ax)} ${n2(ay)} L ${n2(bx)} ${n2(by)}`;
}

function mapPixel(name, x, y, size, overrides = null) {
  const scale = size / 16;
  return `<g transform="translate(${n2(x - size / 2)} ${n2(y - size / 2)}) scale(${n2(scale)})"
    shape-rendering="crispEdges">${iconBody(name, overrides)}</g>`;
}

/* 滲みは同じ中心の輪を段で重ねて作る。ぼかし半径は使わない。 */
function halo(x, y, r, rgb, steps) {
  return steps
    .map(
      ([grow, alpha]) =>
        `<circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(r + grow)}" fill="none"
          stroke="rgba(${rgb}, ${alpha})" stroke-width="1" />`,
    )
    .join('');
}

// 紙の斑。描き直すたびに動かないよう、道ごとの種から決める。
function starfield(view, seed) {
  let state = seed * 9301 + 49297;
  const next = () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
  const dots = [];
  for (let i = 0; i < Math.round((view.w + view.h) / 18); i += 1) {
    const x = Math.round(view.x + next() * view.w);
    const y = Math.round(view.y + next() * view.h);
    const bright = next() > 0.82;
    dots.push(`<rect x="${x}" y="${y}" width="${bright ? 2 : 1}" height="${bright ? 2 : 1}"
      fill="${SPHERE.fleck}" />`);
  }
  return dots.join('');
}

// 凡例の軌道も、盤と同じ「下敷きの上に細い線」で見せる。
let mapSeq = 0;

function boardMap(roads) {
  const { nodes, cx, cy, maxDepth, first, view } = layoutBoard(roads);
  const uid = (mapSeq += 1);

  // 盤ぜんたいで、いちばん奥の掘削中の先端まで。灯すのはこの1本だけにする。
  // 掘削中を全部灯すと盤が金色に埋まって、かえってどこへ向かうのか分からなくなる。
  const frontier = nodes
    .filter((node) => node.corridor?.mission.status === 'active')
    .sort((a, b) => (b.depth !== a.depth ? b.depth - a.depth : a.slot - b.slot))[0];
  const lit = new Set();
  for (let n = frontier; n; n = n.parent) lit.add(n.id);

  const beds = [];
  const lines = [];
  const glows = [];
  const bodies = [];
  const ink = [];

  /* 軌道の案内線。節が乗る輪を薄く先に敷く。 */
  const guides = [];
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const rx = first + (depth - 1) * GRID.ring;
    guides.push(`<ellipse cx="${n2(cx)}" cy="${n2(cy)}" rx="${n2(rx)}"
      ry="${n2(rx * GRID.aspect)}" fill="none"
      stroke="${SPHERE.guide}" stroke-width="1" />`);
  }

  /* 軌道 */
  for (const node of nodes) {
    if (!node.parent) continue;
    const status = node.kind === 'cauldron' ? 'done' : node.corridor.mission.status;
    const on = lit.has(node.id);
    const d = trackPath(cx, cy, node.parent, node);

    beds.push(`<path d="${d}" fill="none" stroke="${
      status === 'abandoned' ? SPHERE.bedDim : SPHERE.bed
    }" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" />`);

    const line = status === 'abandoned' ? '#c2c1b4' : on ? 'var(--gold)' : 'var(--green)';
    lines.push(`<path d="${d}" fill="none" stroke="${line}" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"
      ${status === 'abandoned' ? 'stroke-dasharray="2 5"' : ''}
      ${on ? 'stroke-dasharray="6 5"' : ''} />`);

    // 軌道には名前を置かない。節の名前だけで読める。
    // 宝箱になったプロセスだけ、外へ抜ける手前に印を置く。
    if (node.kind !== 'cauldron' && node.corridor.mission.is_legacy) {
      const [mx, my] = onRing(cx, cy, node.r - GRID.node - 11, node.a);
      ink.push(mapPixel('spark', mx, my, 11));
    }
  }

  /* 節 */
  for (const node of nodes) {
    const { x, y } = node;

    if (node.kind === 'dead') {
      const digging = node.corridor.mission.status === 'active';
      const hue = NODE_HUE[digging ? 'digging' : 'dead'];
      if (digging) glows.push(halo(x, y, 8, hue.glow, [[3, 0.26], [6, 0.12]]));
      bodies.push(`<circle cx="${n2(x)}" cy="${n2(y)}" r="8" fill="${SPHERE.core}"
        stroke="${hue.ring}" stroke-width="2" stroke-dasharray="3 3" />`);
      ink.push(
        `<text class="map-dead${digging ? ' is-active' : ''}" x="${n2(x)}"
          y="${n2(y + 22)}" text-anchor="middle">${digging ? '掘削中' : '崩落'}</text>`,
      );
      continue;
    }

    const isCauldron = node.kind === 'cauldron';
    const type = isCauldron ? 'cauldron' : node.room.type;
    const hue = NODE_HUE[type] ?? NODE_HUE.log;
    const legacy = !isCauldron && node.room.is_legacy;
    // 入口はひと回り大きくして、外へ伸びた先の節と見分けが付くようにする。
    const r = node.depth === 1 ? GRID.node + 3 : GRID.node;

    glows.push(
      halo(x, y, r, hue.glow, lit.has(node.id) || legacy
        ? [[3, 0.3], [6, 0.15], [9, 0.08]]
        : [[3, 0.18], [6, 0.08]]),
    );
    // 宝箱の節には金の輪をもう1本回す。
    if (legacy) {
      glows.push(`<circle cx="${n2(x)}" cy="${n2(y)}" r="${r + 5}" fill="none"
        stroke="var(--gold)" stroke-width="1" />`);
    }
    bodies.push(`<circle cx="${n2(x)}" cy="${n2(y)}" r="${r}" fill="${SPHERE.core}"
      stroke="${hue.ring}" stroke-width="2" />`);

    if (isCauldron) {
      // 進み具合は輪の一部を明るくして出す。
      const ratio = node.needed ? node.done / node.needed : 0;
      if (ratio > 0) {
        const end = -Math.PI / 2 + ratio * Math.PI * 2;
        const [sx, sy] = [x, y - (r + 4)];
        const ex = x + (r + 4) * Math.cos(end);
        const ey = y + (r + 4) * Math.sin(end);
        bodies.push(`<path d="M ${n2(sx)} ${n2(sy)} A ${r + 4} ${r + 4} 0 ${
          ratio > 0.5 ? 1 : 0
        } 1 ${n2(ex)} ${n2(ey)}" fill="none" stroke="var(--green)" stroke-width="2" />`);
      }
      ink.push(mapPixel('cauldron', x, y, GRID.icon));
    } else {
      // 押せるのは節ぜんぶ。絵の大きさのままだと的が小さすぎる。
      ink.push(
        `<a href="#/${node.room.type}/${node.room.id}" class="map-door">`,
        `<circle cx="${n2(x)}" cy="${n2(y)}" r="${r + 7}" fill="transparent" />`,
        mapPixel(ROOM_ICON[node.room.type] ?? 'footsteps', x, y, GRID.icon),
        '</a>',
      );
    }

    /* 札。外へ向けて置く。 */
    const title = isCauldron ? node.cauldron.title : node.room.title;
    const [lx, ly] = onRing(cx, cy, node.r + r + 15, node.a);
    const cos = Math.cos(node.a);
    const anchor = Math.abs(cos) < 0.25 ? 'middle' : cos > 0 ? 'start' : 'end';
    ink.push(
      `<text class="map-node${legacy ? ' is-legacy' : ''}" x="${n2(lx)}" y="${n2(ly + 4)}"
        text-anchor="${anchor}">${esc(clip(title, 6))}</text>`,
    );
    if (isCauldron) {
      ink.push(
        `<text class="map-cauldron" x="${n2(lx)}" y="${n2(ly + 16)}"
          text-anchor="${anchor}">${node.done}/${node.needed}</text>`,
      );
    }
  }

  /* 盤は1枚きり。幅にも高さにも合わせて縮め、全部を1画面に収める。
     width/height を書かずに viewBox だけ渡すと、枠のほうが寸法を決める。 */
  return `
    <div class="board">
      <svg class="map" viewBox="${n2(view.x)} ${n2(view.y)} ${n2(view.w)} ${n2(view.h)}"
           preserveAspectRatio="xMidYMid meet" role="img" aria-label="アストロラーベの盤">
        <rect x="${n2(view.x)}" y="${n2(view.y)}" width="${n2(view.w)}"
              height="${n2(view.h)}" fill="${SPHERE.space}" />
        ${starfield(view, uid)}${guides.join('')}
        ${beds.join('')}${lines.join('')}${glows.join('')}${bodies.join('')}${ink.join('')}
      </svg>
    </div>
  `;
}

/* 盤に載せる期間。null は既定（直近1か月）。
   期間を指定したものがエフェメリスで、当時の盤をそのまま呼び出す。
   （エフェメリス＝ある日付の天体の位置をまとめた暦表） */
let dungeonRange = null;

async function renderDungeon() {
  setActiveTab('dungeon');
  setTopbar({ title: dungeonRange ? 'エフェメリス' : 'アストロラーベ' });
  viewEl.innerHTML = '<div class="empty">読み込み中…</div>';

  const query = dungeonRange
    ? `?since=${dungeonRange.since}${dungeonRange.until ? `&until=${dungeonRange.until}` : ''}`
    : '';
  const { totals, roads } = await api(`/dungeon${query}`);

  const digger = `
    <details class="optional dig" ${dungeonRange ? 'open' : ''}>
      <summary>${icon('hourglass')}<span>エフェメリス</span></summary>
      <form class="dig-form" id="dig-form">
        <div class="row">
          <div class="field">
            <input id="dig-from" type="date" value="${esc(dungeonRange?.since ?? '')}" />
          </div>
          <div class="field">
            <input id="dig-to" type="date" value="${esc(dungeonRange?.until ?? '')}" />
          </div>
        </div>
        <div class="btn-row">
          ${dungeonRange ? '<button type="button" class="ghost" id="dig-now">いま</button>' : ''}
          <button type="submit" class="primary">合わせる</button>
        </div>
      </form>
    </details>`;

  viewEl.innerHTML = `
    ${digger}
    ${
      roads.length
        ? `<div class="board-stat">
             <span>節 ${totals.rooms}</span>
             ${totals.corridors ? `<span>軌道 ${totals.corridors}</span>` : ''}
             ${totals.depth > 1 ? `<span>最深 ${totals.depth}</span>` : ''}
             ${SHOW.cauldron && totals.cauldrons ? `<span>大釜 ${totals.cauldrons}</span>` : ''}
             ${totals.legacies ? `<span class="hot">輝き ${totals.legacies}</span>` : ''}
             <span class="spacer"></span>
             <span>${esc(fmtTime(totals.consumed_time))} · ${esc(
               fmtMoney(totals.consumed_money),
             )}</span>
           </div>
           ${boardMap(roads)}`
        : '<div class="empty">この期間の盤はありません</div>'
    }
  `;

  document.getElementById('dig-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const since = document.getElementById('dig-from').value;
    const until = document.getElementById('dig-to').value;
    if (!since) return toast('いつからを入れてください', true);
    dungeonRange = { since, until: until || null };
    renderDungeon();
  });

  document.getElementById('dig-now')?.addEventListener('click', () => {
    dungeonRange = null;
    renderDungeon();
  });
}

/* ---------- ページ送り ----------

   縦に流さず、1画面ぶんずつ横へ送る。中身は #view の段組みに流し込むので、
   各画面の描画側には手を入れずに済む。段の送りは scrollLeft でやる。
   overflow:hidden でも JS からの代入は効くので、指では動かないまま送れる。 */

const pagerEl = document.getElementById('pager');
const pageCountEl = document.getElementById('page-count');
const prevEl = document.getElementById('page-prev');
const nextEl = document.getElementById('page-next');

let page = 0;
let pageTotal = 1;

function pageMetrics() {
  const style = getComputedStyle(viewEl);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const gap = parseFloat(style.columnGap) || 0;
  const width = Math.max(1, viewEl.clientWidth - padX);
  return { width, gap, step: width + gap, padX };
}

function goToPage(next) {
  const { step } = pageMetrics();
  page = Math.min(Math.max(next, 0), pageTotal - 1);
  viewEl.scrollLeft = page * step;
  pageCountEl.textContent = `${page + 1} / ${pageTotal}`;
  prevEl.disabled = page === 0;
  nextEl.disabled = page === pageTotal - 1;
}

// 画面を切り替えたときだけ先頭に戻す。その場の書き換えでは読んでいた頁に留まる。
let toFirstPage = true;

/* この枚数までは、めくらずに縦へ流す。
   1画面に少し足りないだけで送る操作を強いるほうが、指の手数が増える。
   これを超えたら、いつまで続くのか分からない縦長になるのでめくりへ切り替える。 */
const SCROLL_LIMIT = 2;
let scrolls = false;

// 中身が変わるたびに、何ページに割れたかを測り直す。
function refitPages() {
  /* 盤の画面だけは別扱い。段にも割らず流しもせず、残りの高さを全部使う。
     盤は1枚で1画面に収まるように縮むので、送る先も流す先も無い。 */
  const board = viewEl.querySelector('.board');
  viewEl.classList.toggle('is-board', Boolean(board));
  if (board) {
    viewEl.classList.remove('is-scroll');
    viewEl.style.columnWidth = '';
    pageTotal = 1;
    page = 0;
    scrolls = true;
    pagerEl.hidden = true;
    document.body.classList.remove('is-paged');
    toFirstPage = false;
    return;
  }

  // 判定はいつも段組みの状態で測る。流したまま測ると必ず1ページになり、
  // 一度縦へ倒れたらめくりへ戻れなくなる。
  viewEl.classList.remove('is-scroll');
  const { width, gap, step, padX } = pageMetrics();
  viewEl.style.columnWidth = `${width}px`;
  const flowed = Math.max(0, viewEl.scrollWidth - padX);
  const total = Math.max(1, Math.round((flowed + gap) / step));
  const split = total !== pageTotal;

  pageTotal = total;
  scrolls = total <= SCROLL_LIMIT;
  viewEl.classList.toggle('is-scroll', scrolls);
  pagerEl.hidden = scrolls || pageTotal < 2;
  document.body.classList.toggle('is-paged', !scrolls && pageTotal > 1);

  if (scrolls) {
    viewEl.scrollLeft = 0;
    if (toFirstPage || split) viewEl.scrollTop = 0;
    page = 0;
  } else {
    goToPage(toFirstPage || split ? 0 : page);
  }
  toFirstPage = false;
}

let refitTimer = null;
let settleTimer = null;
function scheduleRefit() {
  cancelAnimationFrame(refitTimer);
  refitTimer = requestAnimationFrame(refitPages);
  // 図版や書体が遅れて寸法を決めることがある。落ち着いた頃にもう一度だけ測る。
  clearTimeout(settleTimer);
  settleTimer = setTimeout(refitPages, 250);
}

prevEl.addEventListener('click', () => goToPage(page - 1));
nextEl.addEventListener('click', () => goToPage(page + 1));

// 描画のたびに呼ぶ代わりに、#view の中身が変わったのを見て測り直す。
new MutationObserver(scheduleRefit).observe(viewEl, { childList: true, subtree: true });
window.addEventListener('resize', scheduleRefit);

/* 指で横に払ってもページを送る。
   地図・時間の表・文字入力の中では、そちらの操作を邪魔しないよう手を出さない。 */
const KEEPS_TOUCH = '.board, .tg, input, textarea, select, .filters';
let swipe = null;

viewEl.addEventListener('pointerdown', (event) => {
  if (scrolls || event.target.closest(KEEPS_TOUCH)) return;
  swipe = { x: event.clientX, y: event.clientY };
});

viewEl.addEventListener('pointerup', (event) => {
  if (!swipe) return;
  const dx = event.clientX - swipe.x;
  const dy = event.clientY - swipe.y;
  swipe = null;
  // 横に払ったときだけ。縦の動きが勝っていれば、ただの押し損ねとみなす。
  if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  goToPage(page + (dx < 0 ? 1 : -1));
});

viewEl.addEventListener('pointercancel', () => {
  swipe = null;
});

// 物理キーボードがあるときは矢印でも送る。文字を打っている最中は邪魔しない。
window.addEventListener('keydown', (event) => {
  if (scrolls || event.target.closest('input, textarea, select')) return;
  if (event.key === 'ArrowRight') goToPage(page + 1);
  if (event.key === 'ArrowLeft') goToPage(page - 1);
});

/* 書き留めるボタンはシェルに置く。思いつくのはどの画面を見ている時でも同じなので、
   ストリームまで移動してから、では間に合わない。 */
const fabEl = document.getElementById('fab');
fabEl.innerHTML = icon('plus');
fabEl.addEventListener('click', openCapture);

// 物理キーボードがあるときは n でも開く。文字を打っている最中は邪魔しない。
window.addEventListener('keydown', (event) => {
  if (event.key !== 'n' || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target.closest('input, textarea, select')) return;
  event.preventDefault();
  openCapture();
});

/* ---------- ルーティング ---------- */

async function route() {
  const hash = location.hash.replace(/^#/, '') || '/home';
  toFirstPage = true;
  try {
    let match;
    if (hash === '/home') return await renderHome();
    if (hash === '/stream' || hash.startsWith('/stream?')) {
      // ユーズドから種別を指定して来られるようにする。
      const type = new URLSearchParams(hash.split('?')[1] ?? '').get('type');
      if (type && STREAM_TYPES.includes(type)) streamFilter = type;
      return await renderStream();
    }
    if (hash === '/missions') return await renderMissions();
    if (hash === '/dungeon') return await renderDungeon();
    if (hash === '/settings') return await renderSettings();
    if (hash === '/recurrences') return await renderRecurrences();
    if (hash === '/vault') return await renderVault();
    if (hash === '/used') return await renderUsed();
    if (hash === '/spells') return await renderSpells();
    if ((match = hash.match(/^\/spell\/(\d+)$/))) {
      return await renderSpell(Number(match[1]));
    }
    if ((match = hash.match(/^\/recurrence\/(\d+)$/))) {
      return await renderRecurrence(Number(match[1]));
    }
    if ((match = hash.match(/^\/(idea|log)\/(\d+)$/))) {
      return await renderEntry(match[1], Number(match[2]));
    }
    location.hash = '#/home';
  } catch (err) {
    viewEl.innerHTML = `<div class="empty">読み込みに失敗しました<br />${esc(err.message)}</div>`;
    toast(err.message, true);
  }
}

window.addEventListener('hashchange', route);
route();
