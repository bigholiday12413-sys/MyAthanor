/* MyAthanor — フロントエンド（ビルドなしの ES モジュール） */

import { icon, KIND_ICON } from './icons.js';

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
const KIND_LABEL = { idea: 'アイデア', log: 'ログ' };

/* アイデアの温度。273K（＝0℃）を常温とし、そこへ向かって冷めていく。 */
const AMBIENT_K = 273;
const MAX_K = 373;

const HEAT_LEVELS = [
  { min: 350, key: 'boiling', label: '沸騰', flame: '#ff8a3c', core: '#ffe4b8' },
  { min: 320, key: 'hot', label: '熱い', flame: '#e0aa3c', core: '#ffe8a8' },
  { min: 295, key: 'warm', label: 'ぬるい', flame: '#b9925a', core: '#e6d0a0' },
  { min: 276, key: 'cooling', label: '冷めかけ', flame: '#8a7550', core: '#b3a075' },
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

function missionCard(mission, { showSource = true } = {}) {
  const sourceHref = `#/${mission.source_type}/${mission.source_id}`;
  const done = mission.status === 'done';
  const actions =
    mission.status === 'active'
      ? `<button data-act="complete" data-id="${mission.id}" class="primary">完了</button>
         <button data-act="abandon" data-id="${mission.id}" class="ghost danger">断念</button>`
      : mission.status === 'abandoned'
        ? `<button data-act="reopen" data-id="${mission.id}" class="ghost">進行中に戻す</button>`
        : legacyButton('mission', mission.id, mission.is_legacy);
  return `
    <div class="card status-${esc(mission.status)} ${mission.is_legacy ? 'is-legacy' : ''}"
         data-mission="${mission.id}">
      <div class="card-top">
        <span class="badge ${esc(mission.status)}">${esc(STATUS_LABEL[mission.status])}</span>
        ${mission.is_legacy ? `<span class="badge now">${icon('chest')}レガシー</span>` : ''}
        <span class="spacer"></span>
        <span>${esc(fmtDate(done ? mission.completed_at : mission.created_at))}</span>
      </div>
      <div class="card-title">${icon('parchment')}<span>${esc(mission.title)}</span></div>
      <div class="card-meta">
        <span>${done ? '実消費' : '見積'} タイム ${esc(fmtTime(mission.estimated_time))}</span>
        <span>ウォレット ${esc(fmtMoney(mission.estimated_money))}</span>
      </div>
      ${
        showSource && mission.source_title
          ? `<div class="card-meta">
               <a class="link" href="${sourceHref}">↳ ${esc(KIND_LABEL[mission.source_type])}: ${esc(mission.source_title)}</a>
             </div>`
          : ''
      }
      ${actions ? `<div class="btn-row">${actions}</div>` : ''}
    </div>
  `;
}

// ミッションカードの完了／断念／再開ボタンをまとめて処理する。
function wireMissionActions(container, onChanged) {
  container.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-act]');
    if (!button) return;
    const { act, id } = button.dataset;
    if (act === 'abandon' && !confirm('このミッションを断念しますか？')) return;
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
function tubeCard({ name, period, data, format }) {
  const total = Math.max(data.budget, data.consumed + data.planned, 1);
  const pct = (value) => Math.max(0, Math.min(100, (value / total) * 100));
  const free = Math.max(0, data.budget - data.consumed - data.planned);

  return `
    <div class="tube-card">
      <div class="tube-head">
        <span class="tube-name">${esc(name)}</span>
        <span class="tube-period">${esc(period)}</span>
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
            <span class="k"><i class="swatch planned"></i>消費予定</span>
            <span class="v">${esc(format(data.planned))}</span>
          </div>
          <div class="readout-row">
            <span class="k"><i class="swatch free"></i>残量</span>
            <span class="v ${data.over ? 'neg' : ''}">${esc(format(free))}</span>
          </div>
          <div class="readout-row">
            <span class="k">可処分</span>
            <span class="v">${esc(format(data.budget))}</span>
          </div>
        </div>
      </div>
      <div class="projection">
        <span>全完了時</span>
        <span class="v ${data.remaining < 0 ? 'neg' : ''}">${esc(format(data.remaining))}</span>
      </div>
    </div>
  `;
}

async function renderHome() {
  setActiveTab('home');
  setTopbar({
    title: 'MyAthanor',
    action: `<a class="icon-btn" href="#/settings" aria-label="設定">${icon('key')}</a>`,
  });
  viewEl.innerHTML = '<div class="empty">読み込み中…</div>';

  const [summary, active] = await Promise.all([
    api('/summary'),
    api('/missions?status=active'),
  ]);

  const upcoming = active.slice(0, 5);

  viewEl.innerHTML = `
    <div class="section-title">リソース</div>
    <div class="tubes">
      ${tubeCard({
        name: 'タイム',
        period: `週 ${summary.time.period.label}`,
        data: summary.time,
        format: fmtTime,
      })}
      ${tubeCard({
        name: 'ウォレット',
        period: `月 ${summary.money.period.label}`,
        data: summary.money,
        format: fmtMoney,
      })}
    </div>

    <div class="section-title">現況</div>
    <div class="panel">
      <div class="stat-line"><span>進行中ミッション</span><span class="v">${summary.active_mission_count}</span></div>
      ${
        summary.time.planned_recurring || summary.money.planned_recurring
          ? `<div class="stat-line">
               <span><a class="link" href="#/recurrences">うち定期イベント →</a></span>
               <span class="v">${esc(fmtTime(summary.time.planned_recurring))} · ${esc(
                 fmtMoney(summary.money.planned_recurring),
               )}</span>
             </div>`
          : ''
      }
      <div class="stat-line"><span>全完了時タイム残</span><span class="v">${esc(fmtTime(summary.time.remaining))}</span></div>
      <div class="stat-line"><span>全完了時ウォレット残</span><span class="v">${esc(fmtMoney(summary.money.remaining))}</span></div>
    </div>

    <div class="section-title">進行中のミッション</div>
    <div class="list" id="home-missions">
      ${
        upcoming.length
          ? upcoming.map((m) => missionCard(m)).join('')
          : '<div class="empty">進行中のミッションはありません</div>'
      }
    </div>
    ${
      active.length > upcoming.length
        ? `<div class="btn-row"><a class="link" href="#/missions">他 ${active.length - upcoming.length} 件を表示 →</a></div>`
        : ''
    }
  `;

  wireMissionActions(document.getElementById('home-missions'), renderHome);
  wireLegacy(document.getElementById('home-missions'), renderHome);
}

/* ---------- ストリーム ---------- */

let streamFilter = 'all';
let streamView = 'time'; // time = 時系列 / tag = タグ別
let streamTag = null;

async function renderStream() {
  setActiveTab('stream');
  setTopbar({ title: 'ストリーム' });

  const [items, tags] = await Promise.all([
    api(`/stream?type=${streamFilter}${streamTag ? `&tag=${streamTag}` : ''}`),
    api('/tags'),
  ]);

  const body =
    streamView === 'tag'
      ? groupedByTag(items)
      : `<div class="list">${
          items.length
            ? items.map(streamCard).join('')
            : '<div class="empty">まだ記録がありません。＋から追加してください。</div>'
        }</div>`;

  viewEl.innerHTML = `
    <div class="filters">
      ${['all', 'idea', 'log']
        .map(
          (type) => `<button class="filter" data-filter="${type}"
             aria-pressed="${streamFilter === type}">${
               type === 'all' ? 'すべて' : KIND_LABEL[type]
             }</button>`,
        )
        .join('')}
    </div>
    <div class="filters">
      <button class="filter" data-view="time" aria-pressed="${streamView === 'time'}">時系列</button>
      <button class="filter" data-view="tag" aria-pressed="${streamView === 'tag'}">タグ別</button>
    </div>
    ${
      streamView === 'time' && tags.length
        ? `<div class="tag-bar">
             <button class="chip ${streamTag ? '' : 'is-on'}" data-tag="">すべて</button>
             ${tags
               .map(
                 (tag) => `<button class="chip ${
                   String(streamTag) === String(tag.id) ? 'is-on' : ''
                 }" data-tag="${tag.id}">${esc(tag.name)} <b>${tag.total}</b></button>`,
               )
               .join('')}
           </div>`
        : ''
    }
    ${body}
    <button class="fab" id="fab" aria-label="新規追加">${icon('plus')}</button>
  `;

  for (const button of viewEl.querySelectorAll('.filter[data-filter]')) {
    button.addEventListener('click', () => {
      streamFilter = button.dataset.filter;
      renderStream();
    });
  }
  for (const button of viewEl.querySelectorAll('.filter[data-view]')) {
    button.addEventListener('click', () => {
      streamView = button.dataset.view;
      renderStream();
    });
  }
  for (const button of viewEl.querySelectorAll('.chip[data-tag]')) {
    button.addEventListener('click', () => {
      streamTag = button.dataset.tag || null;
      renderStream();
    });
  }
  document.getElementById('fab').addEventListener('click', openNewEntryModal);
}

function streamCard(item) {
  return `
    <a class="card kind-${esc(item.kind)}" href="#/${esc(item.kind)}/${item.id}">
      <div class="card-top">
        <span class="badge ${esc(item.kind)}">${esc(KIND_LABEL[item.kind])}</span>
        ${item.kind === 'idea' ? tempChip(item.current_temperature) : ''}
        ${item.from_mission ? '<span>ミッション由来</span>' : ''}
        ${item.from_recurrence ? '<span>定期</span>' : ''}
        <span class="spacer"></span>
        <span>${esc(fmtDate(item.at))}</span>
      </div>
      <div class="card-title">${icon(KIND_ICON[item.kind])}<span>${esc(item.title)}</span></div>
      <div class="card-meta">
        ${
          item.kind === 'log'
            ? `<span>タイム ${esc(fmtTime(item.time_spent))}</span>
               <span>ウォレット ${esc(fmtMoney(item.money_spent))}</span>`
            : ''
        }
        ${
          item.mission_count
            ? `<span class="${item.active_mission_count ? 'hot' : ''}">ミッション ${item.mission_count}件${
                item.active_mission_count ? `（進行中 ${item.active_mission_count}）` : ''
              }</span>`
            : ''
        }
      </div>
      ${
        item.tags.length
          ? `<div class="chips">${item.tags
              .map((tag) => `<span class="chip is-flat">${esc(tag.name)}</span>`)
              .join('')}</div>`
          : ''
      }
    </a>
  `;
}

// タグ別表示。複数タグが付いた項目はそれぞれの束に出る。未分類は最後。
function groupedByTag(items) {
  const groups = new Map();
  const untagged = [];

  for (const item of items) {
    if (item.tags.length === 0) {
      untagged.push(item);
      continue;
    }
    for (const tag of item.tags) {
      if (!groups.has(tag.id)) groups.set(tag.id, { name: tag.name, items: [] });
      groups.get(tag.id).items.push(item);
    }
  }

  const sections = [...groups.values()].sort((a, b) => b.items.length - a.items.length);
  if (untagged.length) sections.push({ name: '未分類', items: untagged });
  if (sections.length === 0) return '<div class="empty">まだ記録がありません。</div>';

  return sections
    .map(
      (section) => `
    <div class="section-title">${esc(section.name)}<span class="section-count">${
      section.items.length
    }</span></div>
    <div class="list">${section.items.map(streamCard).join('')}</div>`,
    )
    .join('');
}

function openNewEntryModal() {
  let kind = 'idea';
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <form class="modal" id="new-entry">
      <h2>新規追加</h2>
      <div class="field">
        <label>種別</label>
        <div class="seg-toggle" id="kind-toggle">
          <button type="button" data-kind="idea" aria-pressed="true">${icon('stone')}アイデア</button>
          <button type="button" data-kind="log" aria-pressed="false">${icon('footsteps')}ログ</button>
        </div>
      </div>
      <div class="field">
        <label for="entry-title">テキスト</label>
        <input id="entry-title" autocomplete="off" placeholder="したいこと／起きたこと" />
      </div>
      <div class="btn-row">
        <button type="button" class="ghost" data-close>キャンセル</button>
        <button type="submit" class="primary">追加</button>
      </div>
    </form>
  `;
  document.body.appendChild(backdrop);

  const input = backdrop.querySelector('#entry-title');
  input.focus();

  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop || event.target.hasAttribute('data-close')) close();
  });

  backdrop.querySelector('#kind-toggle').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-kind]');
    if (!button) return;
    kind = button.dataset.kind;
    for (const b of backdrop.querySelectorAll('#kind-toggle button')) {
      b.setAttribute('aria-pressed', String(b.dataset.kind === kind));
    }
  });

  backdrop.querySelector('#new-entry').addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) return input.focus();
    try {
      const created = await api('/entries', { method: 'POST', body: { kind, title } });
      close();
      toast(`${KIND_LABEL[kind]}を追加しました`);
      location.hash = `#/${kind}/${created.id}`;
    } catch (err) {
      toast(err.message, true);
    }
  });
}

/* ---------- 詳細（アイデア／ログ） ---------- */

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
      <div class="hint">触らずにいると設定から少しずつ 273K へ冷めます。半減期は設定で変えられます。</div>
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
  const [entry, allTags] = await Promise.all([api(path), api('/tags')]);
  const at = kind === 'idea' ? entry.created_at : entry.occurred_at;

  viewEl.innerHTML = `
    <div class="section-title">${KIND_LABEL[kind]} #${entryId}</div>
    <form class="panel" id="entry-form">
      <div class="field">
        <label for="title">タイトル</label>
        <input id="title" value="${esc(entry.title)}" autocomplete="off" />
      </div>
      ${
        kind === 'log'
          ? `<div class="row">
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
          ? `<div class="stat-line"><span>由来</span><span class="v">ミッション完了「${esc(entry.source_mission.title)}」</span></div>`
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

    <div class="section-title">切り出したミッション</div>
    <div class="list" id="entry-missions">
      ${
        entry.missions.length
          ? entry.missions.map((m) => missionCard(m, { showSource: false })).join('')
          : '<div class="empty">紐づくミッションはありません</div>'
      }
    </div>

    ${kind === 'idea' ? temperaturePanel(entry) : ''}

    <div class="section-title">タグ</div>
    <form class="panel" id="tag-form">
      <div class="chips" id="entry-tags">
        ${
          entry.tags.length
            ? entry.tags
                .map(
                  (tag) => `<span class="chip">${esc(tag.name)}<button type="button"
                     data-remove="${esc(tag.name)}" aria-label="${esc(tag.name)} を外す">×</button></span>`,
                )
                .join('')
            : '<span class="chips-empty">タグなし</span>'
        }
      </div>
      <div class="row tag-add">
        <input id="tag-input" list="tag-options" autocomplete="off" placeholder="タグを追加" />
        <button type="submit">追加</button>
      </div>
      <datalist id="tag-options">
        ${allTags.map((tag) => `<option value="${esc(tag.name)}"></option>`).join('')}
      </datalist>
    </form>

    <div class="section-title">ミッションを追加</div>
    <form class="panel" id="mission-form">
      <div class="field">
        <label for="m-title">やること</label>
        <input id="m-title" autocomplete="off" placeholder="切り出すミッション" />
      </div>
      <div class="row">
        <div class="field">
          <label for="m-time">見積タイム（時間）</label>
          <input id="m-time" type="number" step="0.25" min="0" value="0" />
        </div>
        <div class="field">
          <label for="m-money">見積ウォレット（円）</label>
          <input id="m-money" type="number" step="1" min="0" value="0" />
        </div>
      </div>
      <div class="btn-row"><button type="submit" class="primary">ミッションを追加</button></div>
    </form>
  `;

  document.getElementById('entry-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = { title: document.getElementById('title').value.trim() };
    if (kind === 'log') {
      body.time_spent = hoursToMinutes(document.getElementById('time-spent').value);
      body.money_spent = Math.round(Number(document.getElementById('money-spent').value || 0));
    }
    try {
      await api(path, { method: 'PATCH', body });
      toast('保存しました');
    } catch (err) {
      toast(err.message, true);
    }
  });

  const currentTags = entry.tags.map((tag) => tag.name);
  const saveTags = async (names, message) => {
    try {
      await api(`/entries/${kind}/${entryId}/tags`, { method: 'PUT', body: { tags: names } });
      toast(message);
      await renderEntry(kind, entryId);
    } catch (err) {
      toast(err.message, true);
    }
  };

  const tagForm = document.getElementById('tag-form');
  tagForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.getElementById('tag-input');
    const name = input.value.trim();
    if (!name) return input.focus();
    if (currentTags.includes(name)) return toast('もう付いています');
    await saveTags([...currentTags, name], 'タグを付けました');
  });

  tagForm.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-remove]');
    if (!button) return;
    await saveTags(
      currentTags.filter((name) => name !== button.dataset.remove),
      'タグを外しました',
    );
  });

  if (kind === 'idea') wireTemperature(entry, entryId);

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
        },
      });
      toast('ミッションを追加しました');
      await renderEntry(kind, entryId);
    } catch (err) {
      toast(err.message, true);
    }
  });

  wireMissionActions(document.getElementById('entry-missions'), () => renderEntry(kind, entryId));
  wireLegacy(viewEl, () => renderEntry(kind, entryId));
}

/* ---------- ミッション ---------- */

let missionFilter = 'active';

async function renderMissions() {
  setActiveTab('missions');
  setTopbar({ title: 'ミッション' });

  const missions = await api(`/missions?status=${missionFilter}`);
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
    <div class="panel" style="margin-bottom:14px">
      <div class="stat-line">
        <span>${missions.length}件 / ${esc(STATUS_LABEL[missionFilter])}</span>
        <span class="v">${esc(fmtTime(totals.time))} · ${esc(fmtMoney(totals.money))}</span>
      </div>
    </div>
    <div class="list" id="mission-list">
      ${
        missions.length
          ? missions.map((m) => missionCard(m)).join('')
          : '<div class="empty">該当するミッションはありません</div>'
      }
    </div>
  `;

  for (const button of viewEl.querySelectorAll('.filter')) {
    button.addEventListener('click', () => {
      missionFilter = button.dataset.filter;
      renderMissions();
    });
  }
  wireMissionActions(document.getElementById('mission-list'), renderMissions);
  wireLegacy(document.getElementById('mission-list'), renderMissions);
}

/* ---------- 設定 ---------- */

// タイムは週、ウォレットは月を1期間として可処分量を管理する。
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
    title: 'ウォレット（月別）',
    unit: '円',
    step: '100',
    toInput: (amount) => amount,
    fromInput: (value) => Math.round(Number(value || 0)),
    format: fmtMoney,
  },
};

// 一覧に何期間ぶんの過去を含めるか。「さらに過去」で伸びる。
const budgetWindow = { time: 6, money: 6 };

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
                 aria-label="${esc(row.label)} の可処分${esc(ui.unit)}" />
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

  viewEl.innerHTML = `
    <div class="section-title">既定の可処分リソース</div>
    <form class="panel" id="settings-form">
      <div class="field">
        <label for="weekly-time">週あたりの可処分タイム（時間）</label>
        <input id="weekly-time" type="number" step="0.5" min="0"
               value="${minutesToHours(settings.weekly_time)}" />
      </div>
      <div class="field">
        <label for="monthly-money">月あたりの可処分ウォレット（円）</label>
        <input id="monthly-money" type="number" step="100" min="0" value="${settings.monthly_money}" />
      </div>
      <div class="hint">個別に設定していない期間に適用されます。タイムは月曜始まりの週、ウォレットは暦月で集計します。</div>
      <div class="btn-row"><button type="submit" class="primary">保存</button></div>
    </form>

    <div class="section-title">アイデアの冷却</div>
    <form class="panel" id="cooling-form">
      <div class="field">
        <label for="half-life">冷却の半減期（日）</label>
        <input id="half-life" type="number" step="1" min="0"
               value="${settings.cooling_half_life_days}" />
      </div>
      <div class="hint">
        この日数が経つごとに、アイデアの熱（273Kからの差）が半分になります。
        0 にすると冷めません。
      </div>
      <div class="btn-row"><button type="submit" class="primary">保存</button></div>
    </form>

    <div class="section-title">定期イベント</div>
    <a class="card nav-card" href="#/recurrences">
      <div class="card-title">${icon('hourglass')}<span>定期的に起こる出来事の登録</span></div>
      <div class="card-meta"><span>日付が来たら自動でログになります</span></div>
    </a>

    <div class="section-title">タグ</div>
    <a class="card nav-card" href="#/tags">
      <div class="card-title"><span>タグの整理</span></div>
      <div class="card-meta"><span>名前の変更と削除</span></div>
    </a>

    ${budgetSection('time', timeBudgets)}
    ${budgetSection('money', moneyBudgets)}
  `;

  document.getElementById('settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/settings', {
        method: 'PUT',
        body: {
          weekly_time: hoursToMinutes(document.getElementById('weekly-time').value),
          monthly_money: Math.round(Number(document.getElementById('monthly-money').value || 0)),
        },
      });
      toast('既定値を保存しました');
      await renderSettings();
    } catch (err) {
      toast(err.message, true);
    }
  });

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

const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];
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
      <label for="r-title">出来事</label>
      <input id="r-title" autocomplete="off" placeholder="定期的に起きること"
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
    <div class="row">
      <div class="field">
        <label for="r-start">開始日</label>
        <input id="r-start" type="date" value="${esc(recurrence?.start_date ?? todayKey)}" />
      </div>
      <div class="field">
        <label for="r-end">終了日（任意）</label>
        <input id="r-end" type="date" value="${esc(recurrence?.end_date ?? '')}" />
      </div>
    </div>
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
      <div class="hint">開始日から今日までのぶんは、登録した時点でログになります。</div>
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
      <div class="hint">削除しても、これまでに生成されたログは記録として残ります。</div>
    </form>

    <div class="section-title">直近の回</div>
    <form class="panel" id="occurrence-list">
      ${recurrence.occurrences.map(occurrenceRow).join('')}
      <div class="btn-row"><button type="submit" class="primary">変更を保存</button></div>
      <div class="hint">値を変えると、記録済みの回はログにも反映されます。</div>
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

/* ---------- タグの整理 ---------- */

async function renderTags() {
  setActiveTab('home');
  setTopbar({ title: 'タグの整理', back: '#/settings' });
  viewEl.innerHTML = '<div class="empty">読み込み中…</div>';

  const tags = await api('/tags');

  viewEl.innerHTML = `
    <div class="section-title">タグ</div>
    ${
      tags.length
        ? `<form class="panel" id="tag-list">
            ${tags
              .map(
                (tag) => `
              <div class="budget-row">
                <div>
                  <input class="tag-name" data-id="${tag.id}"
                         data-original="${esc(tag.name)}" value="${esc(tag.name)}" />
                  <div class="budget-consumed">アイデア ${tag.idea_count} · ログ ${tag.log_count}</div>
                </div>
                <div class="budget-src">${tag.total}件</div>
                <button type="button" class="ghost danger" data-delete="${tag.id}"
                        data-name="${esc(tag.name)}">削除</button>
              </div>`,
              )
              .join('')}
            <div class="btn-row"><button type="submit" class="primary">名前を保存</button></div>
            <div class="hint">削除するとタグは全ての項目から外れます。項目そのものは消えません。</div>
          </form>`
        : '<div class="empty">タグはまだありません。<br />アイデアやログの詳細から付けられます。</div>'
    }
  `;

  const list = document.getElementById('tag-list');
  if (!list) return;

  list.addEventListener('submit', async (event) => {
    event.preventDefault();
    const changed = [...list.querySelectorAll('.tag-name')].filter(
      (input) => input.value.trim() !== input.dataset.original,
    );
    if (changed.length === 0) return toast('変更はありません');
    try {
      for (const input of changed) {
        await api(`/tags/${input.dataset.id}`, {
          method: 'PATCH',
          body: { name: input.value.trim() },
        });
      }
      toast(`${changed.length}件の名前を変えました`);
      await renderTags();
    } catch (err) {
      toast(err.message, true);
    }
  });

  list.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-delete]');
    if (!button) return;
    if (!confirm(`タグ「${button.dataset.name}」を削除しますか？`)) return;
    try {
      await api(`/tags/${button.dataset.delete}`, { method: 'DELETE' });
      toast('タグを削除しました');
      await renderTags();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

/* ---------- レガシー ---------- */

function legacyButton(kind, id, isLegacy) {
  return `
    <button type="button" class="ghost legacy-btn ${isLegacy ? 'is-on' : ''}"
            data-legacy-kind="${kind}" data-legacy-id="${id}"
            data-legacy-value="${isLegacy ? 0 : 1}">
      ${icon('chest')}<span>${isLegacy ? 'レガシー解除' : 'レガシー'}</span>
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

/* ---------- ダンジョン ---------- */

let dungeonFilter = 'all';

// 部屋（アイデア／ログ）と通路（ミッション）を入れ子で描く。
function dungeonNode(node) {
  const isRoom = node.type !== 'mission';
  const iconName = node.type === 'mission' ? 'parchment' : KIND_ICON[node.type];
  const canLegacy = node.type === 'log' || (node.type === 'mission' && node.status === 'done');

  const title = isRoom
    ? `<a class="room-title" href="#/${node.type}/${node.id}">${esc(node.title)}</a>`
    : `<span class="room-title">${esc(node.title)}</span>`;

  const meta = isRoom
    ? `<span>${esc(fmtDate(node.at))}</span>` +
      (node.type === 'log'
        ? `<span>${esc(fmtTime(node.time))} · ${esc(fmtMoney(node.money))}</span>`
        : '') +
      (node.from_recurrence ? '<span>定期</span>' : '')
    : `<span class="badge ${esc(node.status)}">${esc(STATUS_LABEL[node.status])}</span>` +
      `<span>${esc(fmtTime(node.time))} · ${esc(fmtMoney(node.money))}</span>`;

  return `
    <div class="dungeon-node">
      <div class="room room-${esc(node.type)} ${node.is_legacy ? 'is-legacy' : ''}">
        <div class="room-head">
          ${icon(iconName)}
          ${title}
          ${node.is_legacy ? icon('chest', 'legacy-mark') : ''}
        </div>
        <div class="room-meta">${meta}</div>
        ${canLegacy ? `<div class="room-actions">${legacyButton(node.type, node.id, node.is_legacy)}</div>` : ''}
      </div>
      ${
        node.children.length
          ? `<div class="dungeon-children">${node.children.map(dungeonNode).join('')}</div>`
          : ''
      }
    </div>
  `;
}

async function renderDungeon() {
  setActiveTab('dungeon');
  setTopbar({ title: 'ダンジョン' });
  viewEl.innerHTML = '<div class="empty">読み込み中…</div>';

  const [roots, legacies] = await Promise.all([
    api(`/dungeon${dungeonFilter === 'legacy' ? '?legacy=1' : ''}`),
    api('/legacies'),
  ]);

  viewEl.innerHTML = `
    <div class="filters">
      <button class="filter" data-filter="all" aria-pressed="${dungeonFilter === 'all'}">すべての層</button>
      <button class="filter" data-filter="legacy" aria-pressed="${dungeonFilter === 'legacy'}">レガシーのある層</button>
    </div>

    <div class="section-title">レガシー</div>
    ${
      legacies.length
        ? `<div class="list">${legacies
            .map(
              (item) => `
        <div class="card is-legacy kind-${item.type === 'log' ? 'log' : 'mission'}">
          <div class="card-top">
            <span class="badge ${item.type === 'log' ? 'log' : 'done'}">${
              item.type === 'log' ? 'ログ' : '完了ミッション'
            }</span>
            <span class="spacer"></span>
            <span>${esc(fmtDate(item.at))}</span>
          </div>
          <div class="card-title">
            ${icon(item.type === 'log' ? 'footsteps' : 'parchment')}
            <span>${esc(item.title)}</span>
            ${icon('chest', 'legacy-mark')}
          </div>
          <div class="card-meta">
            <span>${esc(fmtTime(item.type === 'log' ? item.time_spent : item.estimated_time))}</span>
            <span>${esc(fmtMoney(item.type === 'log' ? item.money_spent : item.estimated_money))}</span>
          </div>
          <div class="btn-row">${legacyButton(item.type, item.id, true)}</div>
        </div>`,
            )
            .join('')}</div>`
        : '<div class="empty">まだレガシーはありません。<br />ログや完了したミッションから選んで刻んでください。</div>'
    }

    <div class="section-title">探索</div>
    ${
      roots.length
        ? roots
            .map(
              (root) => `
      <div class="floor">
        <div class="floor-head">
          <span class="floor-depth">深度 ${root.totals.depth}</span>
          <span class="floor-stat">部屋 ${root.totals.rooms} · ミッション ${root.totals.missions}${
            root.totals.legacies ? ` · レガシー ${root.totals.legacies}` : ''
          }</span>
        </div>
        <div class="floor-totals">
          <span>費やした ${esc(fmtTime(root.totals.consumed_time))} · ${esc(
            fmtMoney(root.totals.consumed_money),
          )}</span>
          ${
            root.totals.planned_time || root.totals.planned_money
              ? `<span class="hot">これから ${esc(fmtTime(root.totals.planned_time))} · ${esc(
                  fmtMoney(root.totals.planned_money),
                )}</span>`
              : ''
          }
        </div>
        ${dungeonNode(root)}
      </div>`,
            )
            .join('')
        : '<div class="empty">探索できる層がありません</div>'
    }
  `;

  for (const button of viewEl.querySelectorAll('.filter')) {
    button.addEventListener('click', () => {
      dungeonFilter = button.dataset.filter;
      renderDungeon();
    });
  }
  wireLegacy(viewEl, renderDungeon);
}

/* ---------- ルーティング ---------- */

async function route() {
  const hash = location.hash.replace(/^#/, '') || '/home';
  try {
    let match;
    if (hash === '/home') return await renderHome();
    if (hash === '/stream') return await renderStream();
    if (hash === '/missions') return await renderMissions();
    if (hash === '/dungeon') return await renderDungeon();
    if (hash === '/settings') return await renderSettings();
    if (hash === '/recurrences') return await renderRecurrences();
    if (hash === '/tags') return await renderTags();
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
