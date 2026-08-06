/* MyAthanor — フロントエンド（ビルドなしの ES モジュール） */

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

/* ---------- 共通パーツ ---------- */

function setTopbar({ title, sub = '', back = null, action = '' }) {
  topbarEl.innerHTML = `
    ${back ? `<a class="icon-btn" href="${esc(back)}" aria-label="戻る">‹</a>` : ''}
    <h1>${esc(title)}${sub ? ` <span class="sub">${esc(sub)}</span>` : ''}</h1>
    ${action}
  `;
}

function setActiveTab(tab) {
  for (const el of tabsEl.querySelectorAll('.tab')) {
    el.classList.toggle('is-active', el.dataset.tab === tab);
  }
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
        : '';
  return `
    <div class="card status-${esc(mission.status)}" data-mission="${mission.id}">
      <div class="card-top">
        <span class="badge ${esc(mission.status)}">${esc(STATUS_LABEL[mission.status])}</span>
        <span class="spacer"></span>
        <span>${esc(fmtDate(done ? mission.completed_at : mission.created_at))}</span>
      </div>
      <div class="card-title">${esc(mission.title)}</div>
      <div class="card-meta">
        <span>${done ? '実消費' : '見積'} TIME ${esc(fmtTime(mission.estimated_time))}</span>
        <span>WALLET ${esc(fmtMoney(mission.estimated_money))}</span>
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

function tankCard({ name, period, data, format }) {
  const total = Math.max(data.budget, data.consumed + data.planned, 1);
  const pct = (value) => Math.max(0, Math.min(100, (value / total) * 100));
  const free = Math.max(0, data.budget - data.consumed - data.planned);

  return `
    <div class="tank-card">
      <div class="tank-head">
        <span class="tank-name">${esc(name)}</span>
        <span class="tank-period">${esc(period)}</span>
      </div>
      <div class="tank-wrap">
        <div class="tank ${data.over ? 'is-over' : ''}">
          <div class="seg seg-consumed" style="height:${pct(data.consumed)}%"></div>
          <div class="seg seg-planned" style="height:${pct(data.planned)}%"></div>
          <div class="tank-grid"></div>
        </div>
        <div class="tank-readout">
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
    action: '<a class="icon-btn" href="#/settings" aria-label="設定">⚙</a>',
  });
  viewEl.innerHTML = '<div class="empty">読み込み中…</div>';

  const [summary, active] = await Promise.all([
    api('/summary'),
    api('/missions?status=active'),
  ]);

  const upcoming = active.slice(0, 5);

  viewEl.innerHTML = `
    <div class="section-title">Resource Status</div>
    <div class="tanks">
      ${tankCard({
        name: 'TIME',
        period: `週 ${summary.time.period.label}`,
        data: summary.time,
        format: fmtTime,
      })}
      ${tankCard({
        name: 'WALLET',
        period: `月 ${summary.money.period.label}`,
        data: summary.money,
        format: fmtMoney,
      })}
    </div>

    <div class="section-title">Overview</div>
    <div class="panel">
      <div class="stat-line"><span>進行中ミッション</span><span class="v">${summary.active_mission_count}</span></div>
      <div class="stat-line"><span>全完了時タイム残</span><span class="v">${esc(fmtTime(summary.time.remaining))}</span></div>
      <div class="stat-line"><span>全完了時ウォレット残</span><span class="v">${esc(fmtMoney(summary.money.remaining))}</span></div>
    </div>

    <div class="section-title">Active Missions</div>
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
}

/* ---------- ストリーム ---------- */

let streamFilter = 'all';

async function renderStream() {
  setActiveTab('stream');
  setTopbar({ title: 'ストリーム' });

  const items = await api(`/stream?type=${streamFilter}`);

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
    <div class="list">
      ${
        items.length
          ? items
              .map(
                (item) => `
        <a class="card kind-${esc(item.kind)}" href="#/${esc(item.kind)}/${item.id}">
          <div class="card-top">
            <span class="badge ${esc(item.kind)}">${esc(KIND_LABEL[item.kind])}</span>
            ${item.from_mission ? '<span>MISSION由来</span>' : ''}
            <span class="spacer"></span>
            <span>${esc(fmtDate(item.at))}</span>
          </div>
          <div class="card-title">${esc(item.title)}</div>
          <div class="card-meta">
            ${
              item.kind === 'log'
                ? `<span>TIME ${esc(fmtTime(item.time_spent))}</span>
                   <span>WALLET ${esc(fmtMoney(item.money_spent))}</span>`
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
        </a>`,
              )
              .join('')
          : '<div class="empty">まだ記録がありません。＋から追加してください。</div>'
      }
    </div>
    <button class="fab" id="fab" aria-label="新規追加">＋</button>
  `;

  for (const button of viewEl.querySelectorAll('.filter')) {
    button.addEventListener('click', () => {
      streamFilter = button.dataset.filter;
      renderStream();
    });
  }
  document.getElementById('fab').addEventListener('click', openNewEntryModal);
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
          <button type="button" data-kind="idea" aria-pressed="true">アイデア</button>
          <button type="button" data-kind="log" aria-pressed="false">ログ</button>
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

async function renderEntry(kind, entryId) {
  setActiveTab('stream');
  setTopbar({ title: KIND_LABEL[kind], back: '#/stream' });
  viewEl.innerHTML = '<div class="empty">読み込み中…</div>';

  const path = kind === 'idea' ? `/ideas/${entryId}` : `/logs/${entryId}`;
  const entry = await api(path);
  const at = kind === 'idea' ? entry.created_at : entry.occurred_at;

  viewEl.innerHTML = `
    <div class="section-title">${kind === 'idea' ? 'Idea' : 'Log'} #${entryId}</div>
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
      <div class="btn-row"><button type="submit" class="primary">保存</button></div>
    </form>

    <div class="section-title">Missions</div>
    <div class="list" id="entry-missions">
      ${
        entry.missions.length
          ? entry.missions.map((m) => missionCard(m, { showSource: false })).join('')
          : '<div class="empty">紐づくミッションはありません</div>'
      }
    </div>

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
}

/* ---------- 設定 ---------- */

async function renderSettings() {
  setActiveTab('home');
  setTopbar({ title: '設定', back: '#/home' });

  const settings = await api('/settings');

  viewEl.innerHTML = `
    <div class="section-title">可処分リソース</div>
    <form class="panel" id="settings-form">
      <div class="field">
        <label for="weekly-time">週あたりの可処分タイム（時間）</label>
        <input id="weekly-time" type="number" step="0.5" min="0"
               value="${minutesToHours(settings.weekly_time)}" />
        <div class="hint">ホームのタンクは月曜始まりの週で集計します</div>
      </div>
      <div class="field">
        <label for="monthly-money">月あたりの可処分ウォレット（円）</label>
        <input id="monthly-money" type="number" step="100" min="0" value="${settings.monthly_money}" />
        <div class="hint">ウォレットは当月で集計します</div>
      </div>
      <div class="btn-row"><button type="submit" class="primary">保存</button></div>
    </form>
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
      toast('設定を保存しました');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

/* ---------- ルーティング ---------- */

async function route() {
  const hash = location.hash.replace(/^#/, '') || '/home';
  try {
    let match;
    if (hash === '/home') return await renderHome();
    if (hash === '/stream') return await renderStream();
    if (hash === '/missions') return await renderMissions();
    if (hash === '/settings') return await renderSettings();
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
