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

/* タイムの選択肢（時間、30分刻み）。長くても1日で収まることが
   多いので24時間まで並べる。 */
function hourOptions(max = 24) {
  const opts = [0];
  for (let h = 0.5; h <= max; h += 0.5) opts.push(h);
  return opts;
}

/* 刻み外れは選ばせず、値そのものを常に30分刻みに揃える（db側で丸め済み）。
   ただし、いまの値が選択肢に無いとブラウザは黙って先頭（0）を選ぶ。
   そのまま保存すると、開いただけの札が0になってしまう。
   24時間を超える見積もりや、丸めを見送った行がこれに当たるので、
   刻みは30分のまま、いまの値が入る所まで並びを伸ばして必ず選ばせる。 */
function hourSelect(id, name, current, { max = 24, ariaLabel } = {}) {
  const snapped = Math.max(0, Math.round(Number(current || 0) * 2) / 2);
  return `<select id="${id}" name="${name}" ${ariaLabel ? `aria-label="${esc(ariaLabel)}"` : ''}>
    ${hourOptions(Math.max(max, snapped))
      .map((h) => `<option value="${h}" ${h === snapped ? 'selected' : ''}>${h}</option>`)
      .join('')}
  </select>`;
}

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

/* datetime-local が読み書きする形（YYYY-MM-DDTHH:mm）。地元の時刻で出す。
   ISO をそのまま入れると UTC で表示され、入力欄と札の時刻が食い違う。 */
function toLocalInput(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 入力欄の値を ISO に戻す。空なら触らせない（日時の無い記録は作らない）。
function fromLocalInput(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/* 時刻の30分刻み。input[type=time] の step は機種によって
   選ぶ側の刻みには反映されず（1分刻みのまま）、送るときだけ
   刻み外れとして無効を返す機種があったため、選択式に変えた。
   刻み外れは選ばせず、値そのものを常に30分刻みに揃える（db側で丸め済み）。 */
function timeOptions() {
  const opts = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) opts.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
  return opts;
}

/* 刻みから外れた時刻（丸めを見送った行）を最寄りの30分へ寄せて選ばせる。
   選択肢に無いとブラウザは空欄を選び、そのまま保存すると0時になる。
   繰り上げで日が変わってしまわないよう、23:30 で止める。 */
function snapTimeValue(value) {
  const parts = /^(\d{1,2}):(\d{2})/.exec(value ?? '');
  if (!parts) return '';
  const total = Number(parts[1]) * 60 + Number(parts[2]);
  const snapped = Math.min(Math.round(total / 30) * 30, 23 * 60 + 30);
  return `${String(Math.floor(snapped / 60)).padStart(2, '0')}:${String(snapped % 60).padStart(2, '0')}`;
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 断念という状態は持たない。やらないことにしたものは消す。
// 過去に断念したものが残っているので、札の名前だけは引ける形で置いておく。
// active は常にこれから先の話なので「予定」と呼ぶ。「進行中」だと、
// まだ手を付けていないものまで動いているように読めてしまう。
const STATUS_LABEL = { active: '予定', abandoned: '断念', done: '完了' };
const KIND_LABEL = {
  idea: 'アイデア', log: 'ログ', food: '糧', gear: '装備', feast: '祭事', process: 'プロセス',
};

/* 糧・装備・祭事はログの器に入っている。見た目の別だけここで引き直す。 */
const GOODS = ['food', 'gear', 'feast'];
const isGoods = (kind) => GOODS.includes(kind);
// 別を付けていないログ（プロセスの完了で生まれたものと、素のまま書き留めたもの）は
// 「プロセス」の顔で出す。中身が空になったフラスコ＝もう済んだ予定として見せる。
const faceOf = (item) => item.goods ?? (item.kind === 'log' ? 'process' : item.kind);
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

/* 上のバーは「戻る」「いまの状態」「操作」があるときだけ出す。
   画面の名前は出さない。下のタブが名乗っているものを上でも名乗ると、
   同じ語が1画面に2つ並ぶ。何も無いときは畳んで、そのぶんを本文に返す。 */
function setTopbar({ title = '', sub = '', back = null, action = '' } = {}) {
  const empty = !title && !back && !action;
  topbarEl.hidden = empty;
  topbarEl.innerHTML = empty
    ? ''
    : `
    ${
      back
        ? `<a class="icon-btn" href="${esc(back)}" aria-label="戻る">${icon('chevron')}</a>`
        : ''
    }
    ${
      // 名乗らない画面でも、右に置く操作は端へ寄せたい。
      title
        ? `<h1>${esc(title)}${sub ? ` <span class="sub">${esc(sub)}</span>` : ''}</h1>`
        : '<span class="spacer"></span>'
    }
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

const dateKeyOf = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

/* 棚に並べる範囲。暦の週ではなく、今日から先の7日。
   月曜に見たときと日曜に見たときで見える先の長さが変わると、
   棚が週の後半でどんどん短くなってしまう。 */
const SHELF_DAYS = 7;

function shelfHorizon(now = new Date()) {
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + SHELF_DAYS);
  return end;
}

// ホーム下段のストリーム。暦の週ではなく、今日から遡って7日ぶん。
const STREAM_DAYS = 7;

function streamSince(now = new Date()) {
  const start = new Date(now);
  start.setDate(start.getDate() - STREAM_DAYS);
  return start.toISOString();
}

const daysUntil = (key) =>
  Math.round((new Date(`${key}T00:00:00`) - new Date(`${todayKey()}T00:00:00`)) / 86_400_000);

// 期日はバッジに収めたいので曜日を落とした短い表記を使う。
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

/* 札の中で直す。どの項目も後から書き換えられる。
   種は日付を持たないので周期を、そうでないものは日付を出す。
   畳んであるのは、ふだん見たいのは題と期限だけだから。 */
function missionEdit(mission) {
  const range = dueRange(mission);
  const seed = Boolean(mission.repeat_days);
  const id = mission.id;
  return `
    <details class="mission-dates">
      <summary>${icon('hourglass')}<span>${range ? esc(range) : '直す'}</span></summary>
      <form class="mission-date-form" data-edit="${id}">
        <div class="field">
          <label for="t-${id}">題</label>
          <input id="t-${id}" name="title" value="${esc(mission.title)}" autocomplete="off" />
        </div>
        <div class="row">
          <div class="field">
            <label for="mt-${id}">タイム（時間）</label>
            ${hourSelect(`mt-${id}`, 'estimated_time', minutesToHours(mission.estimated_time))}
          </div>
          <div class="field">
            <label for="mm-${id}">ウォレット（円）</label>
            <input id="mm-${id}" type="number" step="1" min="0" name="estimated_money"
                   value="${mission.estimated_money}" />
          </div>
        </div>
        ${
          seed
            ? `<div class="field">
                 <label for="rp-${id}">${icon('cycle')}何日ごと</label>
                 <input id="rp-${id}" type="number" step="1" min="0" max="365" name="repeat_days"
                        value="${mission.repeat_days}" />
               </div>`
            : `<div class="row">
                 <div class="field">
                   <label for="from-${id}">いつから</label>
                   <input id="from-${id}" type="date" name="start_date"
                          value="${esc(mission.start_date ?? '')}" />
                 </div>
                 <div class="field">
                   <label for="to-${id}">いつまで</label>
                   <input id="to-${id}" type="date" name="due_date"
                          value="${esc(mission.due_date ?? '')}" />
                 </div>
               </div>`
        }
        <div class="btn-row">
          <button type="submit">保存</button>
          <button type="button" class="ghost danger" data-act="delete" data-id="${id}"${
            seed ? ' data-seed="1"' : ''
          }>削除</button>
        </div>
      </form>
    </details>
  `;
}

/* 種が毎週いくら持っていくか。見積もりは1回ぶんなので 7 ÷ 周期を掛ける。
   この額が可処分から先に引かれるので、種の札にだけ出す。
   周期と見積もりから暗算はできるが、頭の中でやらせる理由がない。 */
function weekShare(mission) {
  if (!mission.repeat_days) return '';
  const share = (value) => Math.round((value * 7) / mission.repeat_days);
  // 0 のほうは書かない。タイムだけの種に「−¥0」が付くと、引かれた気がしてしまう。
  const parts = [
    [share(mission.estimated_time), fmtTime],
    [share(mission.estimated_money), fmtMoney],
  ]
    .filter(([value]) => value)
    .map(([value, format]) => `−${esc(format(value))}`);
  if (!parts.length) return '';
  return `<div class="card-meta"><span class="neg">週 ${parts.join(' · ')}</span></div>`;
}

function missionCard(mission, { showSource = true } = {}) {
  const sourceHref = `#/${mission.source_type}/${mission.source_id}`;
  const done = mission.status === 'done';
  const due = dueState(mission);
  /* やらないことにしたものは消す。「断念」という状態は持たない。
     やり直すなら、そのとき新しく立てればよい。畳んだ札の中に削除がある。 */
  const actions =
    mission.status === 'active'
      // 種は完了しない。回り続けるものなので、終わるのは消したとき。
      ? mission.repeat_days
        ? ''
        : `<button data-act="complete" data-id="${mission.id}" class="act">完了</button>`
      : legacyButton('mission', mission.id, mission.is_legacy);
  return `
    <div class="card status-${esc(mission.status)} ${mission.is_legacy ? 'is-legacy' : ''}"
         data-mission="${mission.id}">
      <div class="card-top">
        ${/* 絵は題の頭に出しているので、札には状態だけを持たせる。
             ログの札と見分けが付くことは、題の頭のフラスコと太い左縁が担う。 */ ''}
        <span class="badge ${esc(mission.status)}">${esc(STATUS_LABEL[mission.status])}</span>
        ${
          due
            ? `<span class="badge due-${due.key}">${esc(due.label)}</span>`
            : mission.effective_due_date
              ? `<span class="badge">〜${esc(fmtShortDay(mission.effective_due_date))}</span>`
              : ''
        }
        ${mission.is_legacy ? `<span class="badge now">${icon('spark')}レガシー</span>` : ''}
        ${
          // アイデアそのものの終わり。子のプロセスとは違う重さなので、金の宝石で目立たせる。
          mission.is_conclusion
            ? `<span class="badge now">${icon('stone-gold')}終わり</span>`
            : ''
        }
        <span class="spacer"></span>
        <span>${esc(fmtDate(done ? mission.completed_at : mission.created_at))}</span>
      </div>
      <div class="card-title">${icon(KIND_ICON.mission)}<span>${esc(mission.title)}</span>${
        // 種そのものと、種から生えたものに循環の印を添える。
        mission.repeat_days || mission.repeat_of ? icon('cycle', 'cycle-mark') : ''
      }</div>
      ${
        mission.estimated_time || mission.estimated_money
          ? `<div class="card-meta">
               <span>${done ? '実消費' : '見積'} ${esc(fmtTime(mission.estimated_time))}</span>
               <span>${esc(fmtMoney(mission.estimated_money))}</span>
               ${mission.repeat_days ? `<span>${mission.repeat_days}日ごと</span>` : ''}
             </div>
             ${weekShare(mission)}`
          : mission.repeat_days
            ? `<div class="card-meta"><span>${mission.repeat_days}日ごと</span></div>`
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
        // 直す口と操作を1行に混ぜる。別々の行に置くと札が241pxになり、
        // 1画面に1枚しか乗らなくなる。開いたときだけ下へ折り返す。
        // 直す口は終わった札にも出す。後から書き換えられないものを作らない。
        `<div class="btn-row card-foot">
           ${missionEdit(mission)}
           ${actions}
         </div>`
      }
    </div>
  `;
}

// プロセスカードの完了と削除、直した中身の保存をまとめて処理する。
function wireMissionActions(container, onChanged) {
  container.addEventListener('submit', async (event) => {
    const form = event.target.closest('form[data-edit]');
    if (!form) return;
    event.preventDefault();
    const { title, estimated_time, estimated_money, repeat_days, start_date, due_date } =
      form.elements;
    try {
      await api(`/missions/${form.dataset.edit}`, {
        method: 'PATCH',
        body: {
          title: title.value,
          estimated_time: hoursToMinutes(estimated_time.value),
          estimated_money: Math.round(Number(estimated_money.value || 0)),
          // 種は周期を、そうでないものは日付を持つ。無いほうは触らない。
          ...(repeat_days
            ? { repeat_days: Math.round(Number(repeat_days.value || 0)) }
            : { start_date: start_date.value || null, due_date: due_date.value || null }),
        },
      });
      toast('保存しました');
      await onChanged();
    } catch (err) {
      toast(err.message, true);
    }
  });

  container.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-act]');
    if (!button) return;
    const { act, id } = button.dataset;
    if (act === 'delete') {
      // 種かどうかはこちらが知っている。「循環の種なら」と条件を人に判じさせない。
      const also = button.dataset.seed ? '（生えたぶんも消えます）' : '';
      if (!confirm(`このプロセスを消しますか？${also}`)) return;
    }
    button.disabled = true;
    try {
      if (act === 'delete') {
        await api(`/missions/${id}`, { method: 'DELETE' });
        toast('削除しました');
        return await onChanged();
      }
      await api(`/missions/${id}/${act}`, { method: 'POST' });
      toast('ログへ移りました');
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
function tubeCard({ name, data, format, plannedLabel = '消費予定', href = null, store = null }) {
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
          ${
            /* 固定費。繰り返すぶんは先にここで引いてあるので、消費済みにも
               消費予定にも出てこない。引かれた覚えのない数字にならないよう、
               使える量のすぐ上に置いて、引き算の途中だと読めるようにする。 */
            data.fixed
              ? `<div class="readout-row">
                   <span class="k">固定費</span>
                   <span class="v neg">−${esc(format(data.fixed))}</span>
                 </div>`
              : ''
          }
          <div class="readout-row">
            <span class="k">使える量</span>
            <span class="v ${data.budget < 0 ? 'neg' : ''}">${esc(format(data.budget))}</span>
          </div>
        </div>
      </div>
      <div class="projection">
        ${
          /* 名前は書かない。上に引いた線と、緑と赤の使い分けで、差し引きだと読める。
             左には、その管の元をたどれる先を置く。ウォレットは金庫（貯まった額つき）、
             タイムは週の表（貯まらないので絵だけ）。
             空でも枠は残す。片方だけ丈が変わると、2本の管の目盛りがずれて見える。 */
          store
            ? `<a class="proj-store" href="${store.href}" aria-label="${esc(store.label)}">${icon(
                store.icon,
              )}${store.text ? `<span>${esc(store.text)}</span>` : ''}</a>`
            : '<span class="proj-store is-empty"></span>'
        }
        <span class="v ${data.remaining < 0 ? 'neg' : ''}">${
          data.remaining > 0 ? '+' : ''
        }${esc(format(data.remaining))}</span>
      </div>
    </div>
  `;
}

/* ユーズド＝その週、何に出ていったか。
   量の大小がそのまま帯の長さになる。数字だけだと割合が読めず、
   家計簿として見るときに効かない。行を押すとその先へ飛べる。 */
const GOODS_TONE = {
  food: 'var(--green)',
  gear: '#9aa5ab',
  feast: 'var(--gold-dark)',
  other: '#a89d7c',
};
// other＝別を付けていないぶん。プロセスの完了で生まれたログはここに落ちる。
const GOODS_NAME = { ...KIND_LABEL, other: 'その他' };

function usedBars(used, format) {
  const money = used.kind === 'money';
  return used.rows
    .filter((row) => row.value)
    .map((row) => {
      /* ウォレットは別ごとなので、その絞り込みへ飛ぶ。
         タイムは1件ずつなので、そのログへ飛ぶ。 */
      const href = money
        ? `#/missions?sub=${row.key === 'other' ? 'process' : row.key}`
        : `#/log/${row.id}`;
      const face = money ? row.key : row.goods;
      const name = money ? GOODS_NAME[row.key] : clip(row.title, 12);
      return `
        <div class="spend">
          <div class="spend-head">
            <a class="spend-name" href="${href}">${
              face && face !== 'other' ? icon(KIND_ICON[face]) : ''
            }<span>${esc(name)}</span> →</a>
            ${money ? `<span class="spend-count">${row.count}件</span>` : ''}
            <span class="spend-money">${esc(format(row.value))}</span>
          </div>
          <div class="spend-bar">
            <i style="width:${Math.round((row.value / used.total) * 100)}%;
              background:${money ? GOODS_TONE[row.key] : 'var(--green)'}"></i>
          </div>
        </div>`;
    })
    .join('');
}

/* ユーズド。ホームからは外して、ウォレットの試験管の先に置く。
   ホームは「いま週のどこに居るか」だけでよく、内訳は見に行くもの。 */
/* 調合棚。今週のうちに期限が来るプロセスを、丸底フラスコとして棚に並べる。
   中身の高さが残り日数で、期限が近いほど減っている。過ぎたものは吹きこぼれる。
   上の試験管と同じガラスの一家にしてあるので、同じ工房の棚に見える。 */
const SHELF_MAX = 6;

// 1歩にかける秒数。急ぐものではないので、ゆっくり歩かせる。
const KEEPER_STEP = 3;
// 端まで行ったら、いなくなっている時間。奥へ引っ込んでいるつもり。
const KEEPER_AWAY = 10;
// 歩く柄。1歩ごとに次の柄へ移る。
const KEEPER_FRAMES = ['keeper', 'keeper-b', 'keeper-c'];

/* 棚番の絵だけ縦に長い（帽子のぶん）。共通の icon() は 16x16 を前提に
   viewBox を書くので、ここだけ自前で組む。 */
function keeperMark(name) {
  return `<svg class="px keeper-px" viewBox="0 0 16 20" shape-rendering="crispEdges"
    aria-hidden="true" focusable="false">${iconBody(name)}</svg>`;
}

/* 棚番の動き。右へ歩き、端で消え、しばらくして戻ってくる、を繰り返す。

   歩幅も止まる場所もフラスコの数で変わるので、道筋はその場で組む。
   組んだものは @keyframes ではなく element.animate() に渡す。
   刷ったCSSを差し込む形だと、規則が入るのと要素に名前が付くのとの前後で
   動き出さないブラウザがあり、確かめようがない不確かさが残る。
   JS から直に渡せばその前後関係が消えるうえ、動きを控える設定も
   その場で見て決められる（CSS 側だと、要素に直接書いた指定に負ける）。

   各点に step-end を付けて、次の点まで値を保たせる。
   中割りが起きるとドット絵が半端な位置に来る。
   動かすのは transform と opacity だけなので、合成だけで済む。 */
function keeperWalk(n) {
  /* 出来事を時間順に並べる。
     右へ n 歩 → 消える → 待つ → 左へ n 歩 → 消える → 待つ。

     フラスコが1本のときは歩く先が無いので、その場で柄の数だけ拍を打つ。
     位置は変えられないが、柄が巡って、消えて戻ってくる。
     ずっと立ちっぱなしだと、居るのではなく描き損ねたように見える。 */
  const inPlace = n < 2;
  const beats = inPlace ? KEEPER_FRAMES.length : n;
  const stops = [];
  let t = 0;
  for (const face of [1, -1]) {
    // 戻りは逆から辿る。折り返しでは体ごと裏返して、進む向きに顔を向ける。
    const at = (i) => (inPlace ? 0 : face > 0 ? i : n - 1 - i);
    for (let i = 0; i < beats; i += 1, t += KEEPER_STEP) {
      stops.push({ t, pos: at(i), on: 1, face });
    }
    stops.push({ t, pos: at(beats - 1), on: 0, face });
    t += KEEPER_AWAY;
  }
  const seconds = t;

  /* 最後の点から終いまでは、そのままの姿勢で消えている。
     終端が無いと元の値へ戻そうとするので、明示して置く。 */
  stops.push({ ...stops[stops.length - 1], t: seconds });
  return { seconds, stops };
}

function wireKeeper() {
  const keeper = viewEl.querySelector('.keeper');
  if (!keeper) return;
  const dresses = [...keeper.querySelectorAll('.keeper-frame')];
  // 動きを控える設定なら、いちばん左に立たせたままにする。
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const n = Number(keeper.dataset.n);
  const cycle = (offsets, opts) =>
    dresses.forEach((dress, k) =>
      dress.animate(
        offsets.map(({ offset, index }) => ({
          offset,
          opacity: index % dresses.length === k ? 1 : 0,
          easing: 'step-end',
        })),
        opts,
      ));

  const { seconds, stops } = keeperWalk(n);
  const opts = { duration: seconds * 1000, iterations: Infinity };
  const at = (stop) => stop.t / seconds;

  keeper.animate(
    stops.map((stop) => ({
      offset: at(stop),
      // 持ち幅がフラスコ1つぶんなので、100%＋隙間 が隣までの距離になる。
      transform: `translateX(calc((100% + 4px) * ${stop.pos}))`,
      opacity: stop.on,
      easing: 'step-end',
    })),
    opts,
  );
  // 折り返しでは体ごと裏返して、進む向きに顔を向ける。
  keeper.querySelector('.keeper-face').animate(
    stops.map((stop) => ({ offset: at(stop), transform: `scaleX(${stop.face})`, easing: 'step-end' })),
    opts,
  );
  // 柄は1歩ごとに送る。何番目の出来事かをそのまま柄の番号にする。
  cycle(stops.map((stop, index) => ({ offset: at(stop), index })), opts);
}

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

/* 満タンにはしない。口まで詰まっていると、揺らせば溢れるように見えて落ち着かない。
   実際の調合も口いっぱいには入れない。 */
const FLASK_MAX = 0.8;

// 液は2色。地を暗くして、水面と縁に明るいほうを1段だけ置く。
const FLASK_TONE = {
  far: { deep: '#35682a', lit: '#7cb356' },
  soon: { deep: '#7d5f18', lit: '#c9a03f' },
  over: { deep: '#8c3322', lit: '#cf5a3f' },
};

function flaskRows(ratio) {
  const [top, bottom] = FLASK_BODY;
  const rows = FLASK_ROWS.map((row) => row.split(''));
  const height = bottom - top + 1;
  const fill = Math.max(1, Math.round(ratio * height));
  const surface = bottom - fill + 1;

  for (let y = bottom; y >= surface; y -= 1) {
    const row = rows[y];
    const left = row.indexOf('o');
    const right = row.lastIndexOf('o');
    for (let x = left + 1; x < right; x += 1) {
      if (row[x] !== '.') continue;
      // 水面の1行と、その下の左肩だけを明るくする。全部明るいと平たく見える。
      row[x] = y === surface || (y === surface + 1 && x <= left + 2) ? 'h' : 'l';
    }
  }
  return rows.map((row) => row.join(''));
}

/* 期限切れの空フラスコ＝吹きこぼれではなく、放っておかれて壊れていく体にする。
   ヒビは段を追って増やし、増えたものは砕けるまで消えない。
   砕ける瞬間は、肩・左半身・右半身の3つに割って別々に飛ばす。
   ヒビの場所は輪郭の内側に手で置く。丸みに沿わせないと、斜め線が
   ガラスの上に浮いて見える。 */
const CRACK_STAGES = [
  [[7, 4], [8, 5]],
  [[5, 7], [10, 8]],
  [[9, 11], [6, 12], [8, 13]],
];
const CRACK_INK = '#2a1810';

// これより上の行は肩（頸ごと）、下は左右に割る。
const SHARD_SPLIT_Y = 7;
const SHARD_SPLIT_X = 8;

function maskRows(rows, keep) {
  return rows.map((row, y) => [...row].map((ch, x) => (keep(x, y) ? ch : '.')).join(''));
}

function flaskShatterBody(rows, palette) {
  const shards = {
    top: maskRows(rows, (x, y) => y < SHARD_SPLIT_Y),
    left: maskRows(rows, (x, y) => y >= SHARD_SPLIT_Y && x < SHARD_SPLIT_X),
    right: maskRows(rows, (x, y) => y >= SHARD_SPLIT_Y && x >= SHARD_SPLIT_X),
  };
  const cracks = CRACK_STAGES.map((points) => {
    const overlay = rows.map(() => Array(16).fill('.'));
    for (const [x, y] of points) overlay[y][x] = 'k';
    return toRects({ rows: overlay.map((r) => r.join('')), palette: { k: CRACK_INK } });
  });

  return `
    ${Object.entries(shards)
      .map(([name, r]) => `<g class="shard shard-${name}">${toRects({ rows: r, palette })}</g>`)
      .join('')}
    ${cracks.map((c, i) => `<g class="crack crack-${i + 1}">${c}</g>`).join('')}
  `;
}

function flask(mission, weekEnd) {
  const left = daysUntil(mission.effective_due_date ?? mission.due_date);
  const over = left < 0;
  // 週の残りぶんを満たすところから、期限に向かって減っていく。
  const span = Math.max(1, daysUntil(weekEnd) + 1);
  const ratio = over ? 0 : Math.max(0.1, Math.min(FLASK_MAX, ((left + 1) / span) * FLASK_MAX));
  const key = over ? 'over' : left <= 1 ? 'soon' : 'far';
  const href = `#/${mission.source_type}/${mission.source_id}`;

  const rows = flaskRows(ratio);
  const palette = {
    o: over ? FLASK_TONE.over.deep : '#8fa79c',
    c: '#8a5a2b',
    l: FLASK_TONE[key].deep,
    h: FLASK_TONE[key].lit,
  };
  const body = over ? flaskShatterBody(rows, palette) : toRects({ rows, palette });

  return `
    <a class="flask is-${key}" href="${href}" aria-label="${esc(mission.title)}"
       data-id="${mission.id}">
      <svg viewBox="0 0 16 16" shape-rendering="crispEdges"
           aria-hidden="true" focusable="false">${body}</svg>
      ${
        // 循環から生えたものは、そうと分かるように印を添える。
        mission.repeat_of ? icon('cycle', 'flask-cycle') : ''
      }
    </a>
  `;
}

// ヒビが増える間隔と、砕けて散る動き。棚番と同じくゆっくり進める。
const CRACK_STEP = 3; // ヒビが1本増えるまでの秒数
const CRACK_HOLD = 2; // 全部ヒビが入ってから砕けるまで
const BREAK_SPAN = 0.5; // 砕けて飛び散る動きの長さ
const BREAK_GONE = 1.5; // 消えたままにしておく間

/* 期限切れフラスコのヒビと破裂。棚番と同じ理由で element.animate() を直に使う。
   フラスコごとに開始位置をずらす（id で割った余りを負の delay にする）。
   全部が同時に割れると、放っておかれた感じではなく人形劇に見える。 */
function wireFlaskDecay() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const crackAt = CRACK_STAGES.map((_, i) => (i + 1) * CRACK_STEP);
  const breakAt = crackAt[crackAt.length - 1] + CRACK_HOLD;
  const goneAt = breakAt + BREAK_SPAN;
  const seconds = goneAt + BREAK_GONE;
  const at = (t) => t / seconds;

  const THROWS = {
    top: 'translate(0px,-10px) rotate(-16deg)',
    left: 'translate(-9px,7px) rotate(24deg)',
    right: 'translate(9px,8px) rotate(-26deg)',
  };

  for (const el of viewEl.querySelectorAll('.flask.is-over')) {
    const delay = -((Number(el.dataset.id) % 11) / 11) * seconds * 1000;
    const opts = { duration: seconds * 1000, iterations: Infinity, delay };

    crackAt.forEach((t, i) => {
      el.querySelector(`.crack-${i + 1}`)?.animate(
        [
          { offset: 0, opacity: 0, easing: 'step-end' },
          { offset: at(t), opacity: 1, easing: 'step-end' },
          { offset: at(goneAt), opacity: 1, easing: 'step-end' },
          { offset: at(goneAt), opacity: 0 },
          { offset: 1, opacity: 0 },
        ],
        opts,
      );
    });

    // 割れて散った姿は、次の巡り（offset 0 で無傷へ戻る）まで保つ。
    // 直後に組み直すと、砕けたことにならない。
    for (const [name, thrown] of Object.entries(THROWS)) {
      el.querySelector(`.shard-${name}`)?.animate(
        [
          { offset: 0, transform: 'none', opacity: 1, easing: 'step-end' },
          { offset: at(breakAt), transform: 'none', opacity: 1, easing: 'ease-in' },
          { offset: at(goneAt), transform: thrown, opacity: 0 },
          { offset: 1, transform: thrown, opacity: 0 },
        ],
        opts,
      );
    }
  }
}

function shelf(missions, weekEnd) {
  const shown = missions.slice(0, SHELF_MAX);
  const n = shown.length;
  if (!n) return '';

  /* 棚番。フラスコと同じ段をうろつく。歩く柄は3枚を重ねて置き、
     表に出す1枚を差し替えて切り替える。動きは wireKeeper() が付ける。 */
  const keeper = `
    <span class="keeper" style="--n:${n}" data-n="${n}">
      <span class="keeper-face">
        <span class="keeper-frames">
          ${KEEPER_FRAMES.map((name) => `<span class="keeper-frame">${keeperMark(name)}</span>`).join('')}
        </span>
      </span>
    </span>
  `;

  return `
    <div class="shelf">
      <div class="shelf-stage">
        <div class="shelf-row">
          ${shown.map((m) => flask(m, weekEnd)).join('')}
          ${keeper}
        </div>
      </div>
      <div class="shelf-board"></div>
      <div class="shelf-names">
        ${shown.map((m) => `<span>${esc(clip(m.title, 5))}</span>`).join('')}
      </div>
    </div>
  `;
}

// 管の名前。ユーズドはどちらの管の話かを切り替えて見る。
const TUBE_LABEL = { time: 'タイム', money: 'ウォレット' };

async function renderUsed(kind) {
  setActiveTab('home');
  setTopbar({ title: `ユーズド・${TUBE_LABEL[kind]}`, back: '#/home' });
  viewEl.innerHTML = '<div class="empty">読み込み中…</div>';

  const used = await api(`/used?kind=${kind}`);
  const format = kind === 'money' ? fmtMoney : fmtTime;

  viewEl.innerHTML = `
    <div class="filter-bar">
      <div class="filters">
        ${['time', 'money']
          .map(
            (face) => `<button class="filter" data-used="${face}"
               aria-pressed="${kind === face}">${TUBE_LABEL[face]}</button>`,
          )
          .join('')}
      </div>
    </div>
    <div class="panel tight">
      <div class="stat-line">
        <span>週 ${esc(used.period.label)}</span>
        <span class="v">${esc(format(used.total))}</span>
      </div>
    </div>
    ${
      used.total
        ? `<div class="panel">${usedBars(used, format)}</div>`
        : '<div class="empty">今週はまだ出ていません</div>'
    }
  `;

  for (const button of viewEl.querySelectorAll('.filter[data-used]')) {
    button.addEventListener('click', () => {
      location.hash = `#/used?kind=${button.dataset.used}`;
    });
  }
}

async function renderHome() {
  setActiveTab('home');
  // アプリの名前は毎回読むものではないので出さない。設定へ入る鍵だけ置く。
  setTopbar({
    action:
      `<a class="icon-btn" href="#/settings" aria-label="設定">${icon('key')}</a>`,
  });
  viewEl.innerHTML = '<div class="empty">読み込み中…</div>';

  // 今日から7日先まで。ここまでに期限が来るプロセスを棚に並べる。
  const weekEnd = dateKeyOf(shelfHorizon());
  const [summary, vault, due, stream] = await Promise.all([
    api('/summary'),
    api('/vault'),
    api(`/missions?status=active&sort=due&due_by=${weekEnd}`),
    // 今日から7日遡ったぶん。棚と違って先ではなく、もう起きたことを流す。
    api(`/stream?type=all&since=${encodeURIComponent(streamSince())}&limit=100`),
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
        href: '#/used?kind=time',
        // タイムは貯まらないので数は出さない。使える幅を決めに行く入口だけ置く。
        store: { icon: 'timegrid', href: '#/settings', label: '週のタイムを決める' },
      })}
      ${tubeCard({
        name: 'ウォレット',
        data: summary.money,
        format: fmtMoney,
        plannedLabel: '今週予定',
        href: '#/used?kind=money',
        store: { icon: 'coins', text: fmtMoney(vault.balance), href: '#/vault', label: '金庫' },
      })}
    </div>

    ${
      // 調合棚。今週のぶんは棚の上、それ以外は奥に控えている。
      // 数を並べて書かない。棚に何本あるかがそのまま今週の数になる。
      // 棚に出すのは今日から7日ぶんだけ。先のものまで並べると、いま見るべきものが埋もれる。
      shelf(due, weekEnd)
    }

    ${
      // 期限を持たない見積もりは試験管に乗らない。乗っていないことを見せて取りこぼしを防ぐ。
      // プロセスの一覧はもう無い（出したアイデア・ログの側にしか居ない）ので、飛び先は持たせない。
      summary.undated.time || summary.undated.money
        ? `<div class="panel warn">
             <div class="stat-line">
               <span>期限なしの見積</span>
               <span class="v neg">${esc(fmtTime(summary.undated.time))} · ${esc(
                 fmtMoney(summary.undated.money),
               )}</span>
             </div>
           </div>`
        : ''
    }

    <div class="section-title">この1週間</div>
    <div class="list">
      ${
        stream.length
          ? stream.map(streamCard).join('')
          : '<div class="empty">まだ記録がありません</div>'
      }
    </div>

  `;

  wireKeeper();
  wireFlaskDecay();
}

/* ---------- ストリーム ---------- */

/* ストリームはアイデアだけを流す。
   行ったこと（ログ）はプロセスと同じ画面へ移した。予定と実績は同じものの
   前後の姿なので、離して置くと行き来のたびにタブをまたぐことになる。 */
async function renderStream() {
  setActiveTab('stream');
  // タブが「アイデア」と名乗っているので、上では名乗らない。
  setTopbar();

  const items = await api('/stream?type=idea');

  viewEl.innerHTML = `
    <div class="list">${
      items.length
        ? items.map(streamCard).join('')
        : '<div class="empty">まだ記録がありません</div>'
    }</div>
  `;
}

function streamCard(item) {
  const face = faceOf(item);
  // アイデアそのものの終わりは、子のプロセスの完了とは重さが違うので、
  // 別を付けていないログの中でもさらに金の宝石で目立たせる。
  const iconName = item.is_conclusion ? 'stone-gold' : KIND_ICON[face];
  return `
    <a class="card kind-${esc(face)} ${item.is_conclusion ? 'is-conclusion' : ''}"
       href="#/${esc(item.kind)}/${item.id}">
      <div class="card-top">
        ${
          /* 種別の札は出さない。左の縁の色と題の頭の絵で、すでに二度言っている。
             札を残すのは「終わり」だけ。稀で、金の宝石だけでは弱いので語を添える。 */
          item.is_conclusion ? '<span class="badge is-conclusion">終わり</span>' : ''
        }
        ${SHOW.temperature && item.kind === 'idea' ? tempChip(item.current_temperature) : ''}
        ${item.from_repeat ? icon('cycle', 'cycle-mark') : ''}
        <span class="spacer"></span>
        <span>${esc(fmtDate(item.at))}</span>
      </div>
      <div class="card-title">${icon(iconName)}<span>${esc(item.title)}</span></div>
      ${
        // アイデア産のプロセスは、件数の札ではなく実の題をインデントで出す。
        // 1件ずつの中身は一行で軽く。詳しくはアイデアを開けば札で見える。
        item.missions && item.missions.length
          ? `<div class="idea-missions">
               ${item.missions
                 .map(
                   (m) => `
                 <div class="idea-mission">
                   ${icon(m.is_conclusion ? 'stone-gold' : 'flask')}
                   <span>${esc(m.title)}</span>
                   ${m.cycle ? icon('cycle', 'cycle-mark') : ''}
                 </div>`,
                 )
                 .join('')}
             </div>`
          : ''
      }
      <div class="card-meta">
        ${
          item.kind === 'log' && (item.time_spent || item.money_spent)
            ? `<span>${esc(fmtTime(item.time_spent))}</span>
               <span>${esc(fmtMoney(item.money_spent))}</span>`
            : ''
        }
        ${
          item.mission_count && !item.missions
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

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <form class="modal" id="capture">
      <h2>書き留める</h2>
      <div class="field">
        <div class="seg-toggle seg-5" id="kind-toggle">
          ${['idea', 'log', ...GOODS]
            .map((kind) => {
              // 素のログは、プロセスを経ずに直接書き留めた済んだこと。
              // 他の画面ではプロセスの顔（空フラスコ）で出しているので、ここも合わせる。
              const face = kind === 'log' ? 'process' : kind;
              return `<button type="button" data-kind="${kind}"
                aria-pressed="${captureKind === kind}">${icon(KIND_ICON[face])}${
                KIND_LABEL[face]
              }</button>`;
            })
            .join('')}
        </div>
      </div>
      <div class="field capture-row">
        <input id="capture-title" autocomplete="off" enterkeyhint="done" />
        <input id="capture-money" type="number" inputmode="numeric" step="10" min="0" hidden />
      </div>
      <div class="btn-row">
        <button type="button" class="ghost" data-close>閉じる</button>
        <button type="submit" class="primary">入れる</button>
      </div>
    </form>
  `;
  document.body.appendChild(backdrop);

  const input = backdrop.querySelector('#capture-title');
  const money = backdrop.querySelector('#capture-money');

  // 糧・装備・祭事は買ったものなので、金額を並べて受ける。
  function dressFor(kind) {
    money.hidden = !isGoods(kind);
    if (money.hidden) money.value = '';
  }
  dressFor(captureKind);
  input.focus();

  let put = false;
  const close = () => {
    backdrop.remove();
    // 入れたものがあれば、下の画面へ反映する。
    if (put) route();
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

  // 変換の確定で送ってしまうと、打ちかけの文字が入る。変換中は受け取らない。
  let composing = false;
  input.addEventListener('compositionstart', () => {
    composing = true;
  });
  input.addEventListener('compositionend', () => {
    composing = false;
  });

  /* 押したら1件入って閉じる。控えに積んでいく作りだったが、
     何件も溜めると「入れたつもりで入っていない」が起きるし、
     溜めたぶんを見返すなら閉じてストリームを見たほうが早い。 */
  backdrop.querySelector('#capture').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (composing) return;
    const title = input.value.trim();
    if (!title) return input.focus();
    const kind = captureKind;
    const submit = backdrop.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await api('/entries', {
        method: 'POST',
        body: { kind, title, money_spent: isGoods(kind) ? toYen(money.value) : 0 },
      });
      put = true;
      toast(`${KIND_LABEL[kind === 'log' ? 'process' : kind]}を入れました`);
      close();
    } catch (err) {
      toast(err.message, true);
      submit.disabled = false;
    }
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
        toast('保存しました');
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
        toast('捨てました');
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
      toast('保存しました');
      await renderEntry('idea', entryId);
    } catch (err) {
      toast(err.message, true);
    }
  });
}

async function renderEntry(kind, entryId) {
  setActiveTab('stream');
  /* 名乗るのは下の見出し（section-title）に一本化する。アイデアでは題の枠が
     プロセスの後ろに来るので、そこに見出しが無いと宙に浮いて見える。
     上のバーは戻る矢印だけを持つ。 */
  setTopbar({ back: '#/stream' });
  viewEl.innerHTML = '<div class="empty">読み込み中…</div>';

  const path = kind === 'idea' ? `/ideas/${entryId}` : `/logs/${entryId}`;
  const entry = await api(path);
  const at = kind === 'idea' ? entry.created_at : entry.occurred_at;
  // 大釜に入っているプロセスは大釜のほうに出すので、こちらからは外す。
  // 大釜を伏せている間は外さない。外すとどこからも出てこなくなる。
  const loose = SHOW.cauldron
    ? entry.missions.filter((mission) => !mission.cauldron_id)
    : entry.missions;
  // すでに終わりを予定しているなら、押し直させない（終わりは1つでよい）。
  const concluding = kind === 'idea' && entry.missions.some((m) => m.is_conclusion);

  const addSection = `
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
            <select id="m-time">
              ${hourOptions()
                .map((h) => `<option value="${h}" ${h === 0 ? 'selected' : ''}>${h}</option>`)
                .join('')}
            </select>
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
        <div class="field">
          <label for="m-repeat">${icon('cycle')}何日ごと</label>
          <input id="m-repeat" type="number" step="1" min="0" max="365" value="0" />
        </div>
      </details>
      <div class="btn-row"><button type="submit" class="primary">追加</button></div>
    </form>
  `;

  const listSection = `
    <div class="section-title">${SHOW.cauldron ? '単独のプロセス' : 'プロセス'}</div>
    <div class="list" id="entry-missions">
      ${
        loose.length
          ? loose.map((m) => missionCard(m, { showSource: false })).join('')
          : '<div class="empty">プロセスはありません</div>'
      }
    </div>
  `;

  const titleSection = `
    <div class="section-title">${KIND_LABEL[kind]}${
      entry.is_conclusion
        ? `<span class="badge now is-conclusion">${icon('stone-gold')}終わり</span>`
        : ''
    }</div>
    <form class="panel" id="entry-form">
      <div class="field">
        <label for="title">タイトル</label>
        <input id="title" value="${esc(entry.title)}" autocomplete="off" />
      </div>
      ${
        // 本文。題だけで足りるものが多いので、書いてあるときだけ開いておく。
        kind === 'idea'
          ? `<details class="optional" ${entry.body ? 'open' : ''}>
               <summary>本文</summary>
               <div class="field">
                 <textarea id="body" rows="5">${esc(entry.body ?? '')}</textarea>
               </div>
             </details>`
          : ''
      }
      ${
        kind === 'log'
          ? `<div class="field">
               <div class="seg-toggle seg-4" id="goods-toggle">
                 ${['process', ...GOODS]
                   .map(
                     (face) => `<button type="button" data-goods="${
                       face === 'process' ? '' : face
                     }" aria-pressed="${(entry.goods ?? 'process') === face}">${icon(
                       KIND_ICON[face],
                     )}${KIND_LABEL[face]}</button>`,
                   )
                   .join('')}
               </div>
             </div>
             <div class="row">
               <div class="field">
                 <label for="time-spent">消費タイム（時間）</label>
                 ${hourSelect('time-spent', 'time-spent', minutesToHours(entry.time_spent))}
               </div>
               <div class="field">
                 <label for="money-spent">消費ウォレット（円）</label>
                 <input id="money-spent" type="number" step="1" min="0"
                        value="${entry.money_spent}" />
               </div>
             </div>`
          : ''
      }
      ${
        // 日付＋時刻の1本の枠（datetime-local）は、機種によって内側の絵が
        // 縮まずに枠からはみ出す。日付と時刻を別の枠に分け、横に並べもしない
        // （半分の幅では今度はそれぞれが詰まって欠ける）。
        (() => {
          const local = toLocalInput(at);
          const [dateVal, rawTime] = local ? local.split('T') : ['', ''];
          const timeVal = snapTimeValue(rawTime);
          return `
            <div class="field">
              <label for="at-date">${kind === 'idea' ? '作成' : '発生'}</label>
              <input id="at-date" type="date" value="${esc(dateVal)}" />
            </div>
            <div class="field">
              <label for="at-time">時刻</label>
              <select id="at-time">
                <option value=""></option>
                ${timeOptions()
                  .map((t) => `<option value="${esc(t)}" ${t === timeVal ? 'selected' : ''}>${t}</option>`)
                  .join('')}
              </select>
            </div>
          `;
        })()
      }
      ${
        entry.source_title
          ? `<div class="stat-line"><span>出どころ</span><span class="v"><a class="link"
               href="#/${esc(entry.source_type)}/${entry.source_id}">${esc(
                 clip(entry.source_title, 14),
               )} ↗</a></span></div>`
          : ''
      }
      <div class="btn-row">
        <button type="submit" class="primary">保存</button>
        ${kind === 'log' ? legacyButton('log', entry.id, entry.is_legacy) : ''}
        ${
          // アイデアそのものの終わり。子のプロセスをいくつ完了しても付かない締めくくり。
          kind === 'idea' && !concluding
            ? `<button type="button" class="ghost" id="idea-conclude">${icon(
                'stone-gold',
              )}アイデアを終える</button>`
            : ''
        }
        <button type="button" class="ghost danger" id="entry-delete">削除</button>
      </div>
    </form>
  `;

  viewEl.innerHTML = `
    ${
      /* アイデアはプロセスを切り出すのが主な用なので、その入口を先に置く。
         ログはすでに済んだことの記録なので、まずタイトル側で中身を確かめてから、
         そこから続けるプロセスを足す順にする。 */
      kind === 'log'
        ? `${titleSection}${addSection}${listSection}`
        : `${addSection}${listSection}${titleSection}`
    }

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
    // 日時も直せる。空にはさせない（日時の無い記録は作らない）。時刻を空にした
    // だけなら、日付はそのままに 0時として扱う。
    const dateVal = document.getElementById('at-date').value;
    const timeVal = document.getElementById('at-time').value || '00:00';
    const moment = dateVal ? fromLocalInput(`${dateVal}T${timeVal}`) : null;
    if (moment) body[kind === 'idea' ? 'created_at' : 'occurred_at'] = moment;
    if (kind === 'idea') body.body = document.getElementById('body').value;
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

  document.getElementById('entry-delete').addEventListener('click', async () => {
    const derived = entry.missions.length;
    const also = derived ? `（ここから出たプロセス${derived}件も消えます）` : '';
    if (!confirm(`この${KIND_LABEL[kind]}を消しますか？${also}`)) return;
    try {
      await api(path, { method: 'DELETE' });
      toast('削除しました');
      location.hash = '#/stream';
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('idea-conclude')?.addEventListener('click', async () => {
    try {
      await api(`/ideas/${entryId}/conclude`, { method: 'POST' });
      toast('終わりを予定に立てました');
      await renderEntry(kind, entryId);
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
        toast('用意しました');
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
          repeat_days: Number(document.getElementById('m-repeat')?.value || 0),
          start_date: document.getElementById('m-from').value || null,
          due_date: document.getElementById('m-to').value || null,
        },
      });
      toast('追加しました');
      await renderEntry(kind, entryId);
    } catch (err) {
      toast(err.message, true);
    }
  });

  wireMissionActions(document.getElementById('entry-missions'), () => renderEntry(kind, entryId));
  wireLegacy(viewEl, () => renderEntry(kind, entryId));
}

/* ---------- ログ ---------- */

/* 予定（プロセス）は、それを生んだアイデア・ログの側に居る。
   ここは行ったことだけを見る場所。糧・装備・祭事はログの中の別、
   プロセスは別を付けていないぶん（プロセスの完了で生まれたログと、
   素のまま書き留めたログ）。 */
let logFilter = 'process';

async function renderMissions() {
  setActiveTab('missions');
  // タブが「ログ」と名乗っているので、上では名乗らない。
  setTopbar();

  const items = await api(`/stream?type=${logFilter}`);

  const totals = items.reduce(
    (acc, item) => ({ time: acc.time + item.time_spent, money: acc.money + item.money_spent }),
    { time: 0, money: 0 },
  );

  const sub = [...GOODS.map((g) => [g, KIND_LABEL[g]]), ['process', KIND_LABEL.process]];

  viewEl.innerHTML = `
    <div class="filter-bar">
      <div class="filters">
        ${sub
          .map(
            ([key, label]) => `<button class="filter" data-sub="${key}"
               aria-pressed="${logFilter === key}">${icon(KIND_ICON[key])}${label}</button>`,
          )
          .join('')}
      </div>
    </div>
    <div class="panel tight">
      <div class="stat-line">
        ${/* 件数は札の数そのものなので書かない。合計は見ても数えられないので残す。 */ ''}
        <span class="spacer"></span>
        <span class="v">${esc(fmtTime(totals.time))} · ${esc(fmtMoney(totals.money))}</span>
      </div>
    </div>
    <div class="list" id="mission-list">
      ${
        items.length
          ? items.map(streamCard).join('')
          : '<div class="empty">まだ記録がありません</div>'
      }
    </div>
  `;

  for (const button of viewEl.querySelectorAll('.filter[data-sub]')) {
    button.addEventListener('click', () => {
      logFilter = button.dataset.sub;
      renderMissions();
    });
  }
}

/* ---------- 設定 ---------- */

// タイムは週、ウォレットは月を1期間として使える量を管理する。
const BUDGET_UI = {
  time: {
    title: 'タイム（週別）',
    unit: '時間',
    toInput: (amount) => minutesToHours(amount),
    fromInput: (value) => hoursToMinutes(value),
    format: fmtTime,
    // 週まるごとを割り当てることもあり得るので、1週間ぶん（168時間）まで並べる。
    field: (id, label, value) => hourSelect(id, 'amount', value, { max: 168, ariaLabel: `${label} の時間` }),
  },
  money: {
    title: 'ウォレット（週別）',
    unit: '円',
    toInput: (amount) => amount,
    fromInput: (value) => Math.round(Number(value || 0)),
    format: fmtMoney,
    field: (id, label, value) =>
      `<input id="${id}" type="number" min="0" step="100" value="${value}" aria-label="${esc(label)} の円" />`,
  },
};

// 一覧に何期間ぶんの過去を含めるか。「さらに過去」で伸びる。
// 過去は「さらに過去」で伸ばせる。最初から6期ぶん開くと、設定だけで2ページ食う。
const budgetWindow = { time: 3, money: 3 };

/* 期間ごとの個別設定（特例）。ふだんは値だけを見せて、開けば直せる。
   全期間ぶんの入力欄を常に並べていたが、実際に上書きするのはごく一部の週だけ。
   使わない欄まで常設すると「特例」が既定であるかのように見えてしまう。
   項目（details）として畳んでおき、開いた期間だけがその場で1件ずつ確定する。 */
function budgetSection(kind, rows) {
  const ui = BUDGET_UI[kind];
  return `
    <div class="section-title">${esc(ui.title)}</div>
    <div class="panel budget-list" data-kind="${kind}">
      ${rows
        .map(
          (row) => `
        <details class="settings-item" data-key="${esc(row.key)}">
          <summary>
            <span class="settings-item-label">
              ${esc(row.label)}${row.is_current ? '<span class="badge now">現在</span>' : ''}
              ${row.source === 'override' ? '<span class="badge override">特例</span>' : ''}
            </span>
            <span class="v">${esc(ui.format(row.amount))}</span>
          </summary>
          <div class="settings-item-body">
            <div class="budget-consumed">消費 ${esc(ui.format(row.consumed))}${
              // 固定費を引く前と後で数が違うので、後のほうも出す。
              // 名前は管の読み取りに合わせる。同じ数を別の名前で呼ばない。
              row.fixed ? ` · 使える量 ${esc(ui.format(row.amount))}` : ''
            }</div>
            <div class="field">
              ${ui.field(`budget-${kind}-${esc(row.key)}`, row.label, ui.toInput(row.gross))}
            </div>
            <div class="btn-row">
              <button type="button" class="primary" data-save>保存</button>
              ${
                row.source === 'override'
                  ? '<button type="button" class="ghost" data-reset>既定へ</button>'
                  : ''
              }
            </div>
          </div>
        </details>`,
        )
        .join('')}
      <div class="btn-row"><button type="button" class="ghost" data-more>さらに過去</button></div>
    </div>
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

  /* 繰り返すプロセスから来る固定費。今の週のぶんを使う。
     入ってくる量から引かれるので、引き算の途中を両方の枠に見せる。 */
  const fixedOf = (rows) => rows.find((row) => row.is_current)?.fixed ?? 0;
  const fixedTime = fixedOf(timeBudgets);
  const fixedMoney = fixedOf(moneyBudgets);

  /* 既定値の2つ（報酬・冷却）も、期間ごとの個別設定と同じ項目の形にする。
     常に開いた入力欄を並べず、値だけを見せて、開けば直す。 */
  viewEl.innerHTML = `
    <div class="section-title">週のタイム</div>
    <div class="panel" id="time-grid-panel">
      <div class="tg-top">
        <span class="tg-total" id="tg-total"></span>
        ${/* 塗るあいだだけ表が指を取る。ふだんは画面を流せるようにしておく。 */ ''}
        <button type="button" id="tg-paint" aria-pressed="false">塗る</button>
        <button type="button" class="ghost" id="tg-clear">全部消す</button>
      </div>
      ${timeGridMarkup(grid)}
      ${
        /* 塗りが無いときは出さない。この行は塗った枚数から引いた数なので、
           数字で持っている週のタイムとは食い違う。 */
        fixedTime && settings.time_grid
          ? `<div class="stat-line">
               <span>固定費</span>
               <span class="v neg">−${esc(fmtTime(fixedTime))}</span>
             </div>
             <div class="stat-line">
               <span>使える量</span>
               <span class="v" id="time-net"></span>
             </div>`
          : ''
      }
      <div class="btn-row"><button type="button" class="primary" id="tg-save">保存</button></div>
    </div>

    <div class="section-title">既定値</div>
    <div class="panel">
      <details class="settings-item" id="reward-item">
        <summary>
          <span class="settings-item-label">報酬（月あたり）</span>
          <span class="v">${esc(fmtMoney(settings.monthly_money))}</span>
        </summary>
        <div class="settings-item-body">
          <div class="field">
            <input id="monthly-money" type="number" step="100" min="0"
                   value="${settings.monthly_money}" aria-label="報酬（月あたり）の円" />
          </div>
          ${
            fixedMoney
              ? `<div class="stat-line">
                   <span>固定費</span>
                   <span class="v neg">−${esc(fmtMoney(fixedMoney))}</span>
                 </div>`
              : ''
          }
          <div class="stat-line">
            <span>使える量</span>
            <span class="v" id="weekly-share"></span>
          </div>
          <div class="btn-row"><button type="button" class="primary" id="reward-save">保存</button></div>
        </div>
      </details>
      ${
        SHOW.temperature
          ? `<details class="settings-item" id="cooling-item">
               <summary>
                 <span class="settings-item-label">アイデアの冷却</span>
                 <span class="v">${
                   settings.cooling_half_life_days
                     ? `${esc(settings.cooling_half_life_days)}日`
                     : '冷めない'
                 }</span>
               </summary>
               <div class="settings-item-body">
                 <div class="field">
                   <label for="half-life">冷却の半減期（日）</label>
                   <input id="half-life" type="number" step="1" min="0"
                          value="${settings.cooling_half_life_days}" />
                 </div>
                 <div class="btn-row">
                   <button type="button" class="primary" id="cooling-save">保存</button>
                 </div>
               </div>
             </details>`
          : ''
      }
    </div>

    <div class="section-title">金庫</div>
    <a class="card nav-card" href="#/vault">
      <div class="card-title">${icon('coins')}<span>金庫の初期残高と積立</span></div>
    </a>

    ${budgetSection('time', timeBudgets)}
    ${budgetSection('money', moneyBudgets)}
  `;

  // 打っている最中に、4で割って固定費を引いたぶんが見えるようにする。
  const rewardInput = document.getElementById('monthly-money');
  const share = document.getElementById('weekly-share');
  const showShare = () => {
    const value = Math.round(Number(rewardInput.value || 0) / 4) - fixedMoney;
    share.textContent = fmtMoney(value);
    // 固定費が報酬を超えたら赤にする。数字だけだと符号を見落とす。
    share.classList.toggle('neg', value < 0);
  };
  showShare();
  rewardInput.addEventListener('input', showShare);

  document.getElementById('reward-save').addEventListener('click', async () => {
    try {
      await api('/settings', {
        method: 'PUT',
        body: { monthly_money: Math.round(Number(rewardInput.value || 0)) },
      });
      toast('保存しました');
      await renderSettings();
    } catch (err) {
      toast(err.message, true);
    }
  });

  wireTimeGrid(document.getElementById('time-grid-panel'), grid, fixedTime);

  if (SHOW.temperature) {
    document.getElementById('cooling-save').addEventListener('click', async () => {
      try {
        await api('/settings', {
          method: 'PUT',
          body: {
            cooling_half_life_days: Math.round(
              Number(document.getElementById('half-life').value || 0),
            ),
          },
        });
        toast('保存しました');
        await renderSettings();
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  // 期間ごとの個別設定。項目を開いて、1件ずつその場で保存する。
  for (const list of viewEl.querySelectorAll('.budget-list')) {
    const kind = list.dataset.kind;
    const ui = BUDGET_UI[kind];

    list.addEventListener('click', async (event) => {
      const save = event.target.closest('button[data-save]');
      const reset = event.target.closest('button[data-reset]');
      const more = event.target.closest('button[data-more]');
      if (more) {
        budgetWindow[kind] += 8;
        await renderSettings();
        return;
      }
      const item = event.target.closest('.settings-item[data-key]');
      if (!item) return;
      const key = item.dataset.key;
      try {
        if (save) {
          const input = item.querySelector('input, select');
          await api(`/budgets/${kind}/${key}`, {
            method: 'PUT',
            body: { amount: ui.fromInput(input.value) },
          });
          toast('保存しました');
          await renderSettings();
        } else if (reset) {
          await api(`/budgets/${kind}/${key}`, { method: 'DELETE' });
          toast('既定値に戻しました');
          await renderSettings();
        }
      } catch (err) {
        toast(err.message, true);
      }
    });
  }
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
            <div class="vault-detail">使える量 ${esc(fmtMoney(week.budget))} − 消費 ${esc(
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
      toast('保存しました');
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

function wireTimeGrid(root, initial, fixed = 0) {
  const grid = [...initial];
  const total = root.querySelector('#tg-total');
  // 固定費が無いときは引き算の行を出していないので、更新先も無い。
  const net = root.querySelector('#time-net');
  const surface = root.querySelector('.tg');
  const paintBtn = root.querySelector('#tg-paint');
  let painting = false;
  let paintTo = '1';

  /* 表は画面の半分以上を覆うので、いつでも指を取っていると流す場所が無くなる。
     そのうえ掴んだつもりで週が塗り変わってしまう。
     塗るあいだだけ取るようにして、ふだんは触っても何も起きないようにする。 */
  let armed = false;
  paintBtn.addEventListener('click', () => {
    armed = !armed;
    paintBtn.setAttribute('aria-pressed', String(armed));
    surface.classList.toggle('is-paint', armed);
  });

  const refresh = () => {
    const hours = grid.filter((cell) => cell === '1').length;
    total.textContent = `${hours}h / 週`;
    if (net) {
      const left = hours * 60 - fixed;
      net.textContent = fmtTime(left);
      net.classList.toggle('neg', left < 0);
    }
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
    if (!armed) return;
    const cell = event.target.closest('.tg-cell');
    if (!cell) return;
    event.preventDefault();
    painting = true;
    // 最初に触ったマスの逆の状態を、指を離すまで塗り続ける。
    paintTo = cell.classList.contains('is-on') ? '0' : '1';
    // 触れた1枡は先に塗る。捕捉に失敗しても、押した所だけは必ず変わるように。
    paint(cell);
    try {
      surface.setPointerCapture(event.pointerId);
    } catch {
      // 捕捉できない指もある。なぞりは効かなくなるが、1枡ずつなら押せる。
    }
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
      toast('保存しました');
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

const ROOM_ICON = { idea: 'stone', log: 'footsteps' };

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

  /* 盤は1枚きり。等倍では幅にも高さにも合わせて縮め、全部を1画面に収める。
     拡げたぶんは枠の中を繰って見る。盤の寸法は JS が入れるので、ここでは
     viewBox の縦横だけ添えておく。 */
  return `
    <div class="board">
      <div class="board-view" id="board-view">
        <svg class="map" viewBox="${n2(view.x)} ${n2(view.y)} ${n2(view.w)} ${n2(view.h)}"
             data-w="${n2(view.w)}" data-h="${n2(view.h)}"
             preserveAspectRatio="xMidYMid meet" role="img" aria-label="アストロラーベの盤">
          <rect x="${n2(view.x)}" y="${n2(view.y)}" width="${n2(view.w)}"
                height="${n2(view.h)}" fill="${SPHERE.space}" />
          ${starfield(view, uid)}${guides.join('')}
          ${beds.join('')}${lines.join('')}${glows.join('')}${bodies.join('')}${ink.join('')}
        </svg>
      </div>
      <div class="board-zoom">
        <button type="button" id="zoom-out" aria-label="盤を縮める">−</button>
        <button type="button" id="zoom-in" aria-label="盤を拡げる">＋</button>
      </div>
    </div>
  `;
}

/* 盤の倍率。等倍が「全部が1画面に収まる大きさ」で、そこから拡げていく。
   縮める側は等倍で止める。等倍より小さくしても、読めない盤が真ん中に浮くだけ。 */
const ZOOM_STEPS = [1, 1.5, 2.25, 3.4];
// 期間を変えても同じ盤なので、描き直しをまたいで倍率は保つ。
let boardZoom = 0;
let boardWatch = null;

function wireBoard() {
  const box = document.getElementById('board-view');
  if (!box) return;
  const svg = box.querySelector('.map');
  const w = Number(svg.dataset.w);
  const h = Number(svg.dataset.h);
  const outBtn = document.getElementById('zoom-out');
  const inBtn = document.getElementById('zoom-in');

  let lastFit = 0;

  const apply = (keepCenter) => {
    /* 等倍の寸法は枠から毎回出し直す。画面が回ったり幅が変わったりしても、
       等倍が「1画面に収まる大きさ」であり続けるようにするため。 */
    const fit = Math.min(box.clientWidth / w, box.clientHeight / h);
    if (!fit) return;
    // 枠も倍率も変わっていないなら触らない。繰り返し呼ばれても揺れないように。
    if (!keepCenter && fit === lastFit) return;
    lastFit = fit;
    const zoom = ZOOM_STEPS[boardZoom];
    // 拡げる前に見ていた真ん中を控えておき、拡げたあとに同じ点へ戻す。
    // 左上を保つと、拡げるたびに盤の中心から離れていってしまう。
    const at = keepCenter && {
      x: (box.scrollLeft + box.clientWidth / 2) / Math.max(1, box.scrollWidth),
      y: (box.scrollTop + box.clientHeight / 2) / Math.max(1, box.scrollHeight),
    };
    svg.style.width = `${w * fit * zoom}px`;
    svg.style.height = `${h * fit * zoom}px`;
    if (at) {
      box.scrollLeft = at.x * box.scrollWidth - box.clientWidth / 2;
      box.scrollTop = at.y * box.scrollHeight - box.clientHeight / 2;
    }
    outBtn.disabled = boardZoom === 0;
    inBtn.disabled = boardZoom === ZOOM_STEPS.length - 1;
  };

  const step = (by) => () => {
    boardZoom = Math.min(Math.max(boardZoom + by, 0), ZOOM_STEPS.length - 1);
    apply(true);
  };
  outBtn.addEventListener('click', step(-1));
  inBtn.addEventListener('click', step(1));

  /* 枠の丈が決まるのは、ページ送りが盤の画面だと判じて縦の配分をやり直した後。
     描いた直後に測ると等倍が大きく出るので、枠が動いたら測り直す。
     画面を回したときにも同じ道で直る。 */
  boardWatch?.disconnect();
  boardWatch = new ResizeObserver(() => apply(false));
  boardWatch.observe(box);
}

/* 盤に載せる期間。null は既定（直近1か月）。
   期間を指定したものがエフェメリスで、当時の盤をそのまま呼び出す。
   （エフェメリス＝ある日付の天体の位置をまとめた暦表） */
let dungeonRange = null;

async function renderDungeon() {
  setActiveTab('dungeon');
  /* ふだんは名乗らない（タブが名乗っている）。過去の盤を見ている間だけ出す。
     これは名前ではなく「いまどの盤を見ているか」という状態なので、書く値がある。 */
  setTopbar(dungeonRange ? { title: 'エフェメリス' } : {});
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

  wireBoard();

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

/* ---------- 画面の丈 ----------

   画面は縦に流す。1画面ぶんずつ横へ送る作りを持っていたが、やめた。
   組んである画面ほど枠が境で割れず、段の末尾に白が残って、
   同じ中身が3ページにも4ページにもなる。どのページに何が居るのかも
   覚えていられない。順に下へ辿れるほうが、探す手数が少なくて済む。

   #view は自分で流れるので、ここでやることは2つだけ。
   盤の画面かどうかを見分けることと、画面を切り替えたら頭へ戻すこと。 */

// 画面を切り替えたときだけ頭に戻す。その場の書き換えでは読んでいた所に留まる。
let toTop = true;

function refitView() {
  /* 盤の画面だけは別扱い。流さず、残りの高さを全部盤に渡す。
     盤は枠の中で自分で繰るので、外側まで動くと二重になる。 */
  const board = viewEl.querySelector('.board');
  viewEl.classList.toggle('is-board', Boolean(board));
  viewEl.classList.toggle('is-scroll', !board);
  if (toTop) viewEl.scrollTop = 0;
  toTop = false;
}

let refitTimer = null;
function scheduleRefit() {
  cancelAnimationFrame(refitTimer);
  refitTimer = requestAnimationFrame(refitView);
}

// 描画のたびに呼ぶ代わりに、#view の中身が変わったのを見て付け直す。
new MutationObserver(scheduleRefit).observe(viewEl, { childList: true, subtree: true });

// 書き留めるボタン。出すのはホームだけ（route() で決める）。
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
  toTop = true;
  /* 書き留めるボタンはホームにだけ置く。どの画面にも浮かせていたが、
     読んでいる札や盤の隅を隠すだけで、思いついたら一度ホームへ戻ればよい。 */
  fabEl.hidden = hash !== '/home';
  try {
    let match;
    if (hash === '/home') return await renderHome();
    if (hash === '/stream' || hash.startsWith('/stream?')) return await renderStream();
    if (hash === '/missions' || hash.startsWith('/missions?')) {
      // ユーズドから、見たい絞り込みを指定して来られるようにする。
      const query = new URLSearchParams(hash.split('?')[1] ?? '');
      const sub = query.get('sub');
      if (sub && (sub === 'process' || GOODS.includes(sub))) logFilter = sub;
      return await renderMissions();
    }
    if (hash === '/dungeon') return await renderDungeon();
    if (hash === '/settings') return await renderSettings();
    if (hash === '/vault') return await renderVault();
    if (hash === '/used' || hash.startsWith('/used?')) {
      const kind = new URLSearchParams(hash.split('?')[1] ?? '').get('kind');
      return await renderUsed(kind === 'time' ? 'time' : 'money');
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
