// 集計期間の算出。
// タイムもウォレットも「週あたり」（月曜始まり）で管理する。
// ウォレットの既定値だけは月あたりの報酬として持ち、4で割って週に均す。
// 境界はサーバのローカルタイムゾーンで判定し、SQLite に格納した ISO(UTC)
// 文字列と比較できるよう UTC の ISO に揃えて返す。

const pad = (n) => String(n).padStart(2, '0');

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// ローカル日付を YYYY-MM-DD で表す。日付の同一性はこの文字列で判断する。
export function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? ''));
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(year, month - 1, day);
  // 2026-02-30 のような繰り上がる日付を弾く
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

export function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

// 月曜=0 … 日曜=6。週が月曜始まりなのに合わせる。
export function weekdayIndex(date) {
  return (date.getDay() + 6) % 7;
}

function mondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function week(start) {
  const end = addDays(start, 7);
  const last = new Date(end.getTime() - 1);
  return {
    unit: 'week',
    key: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
    label: `${start.getMonth() + 1}/${start.getDate()}-${last.getMonth() + 1}/${last.getDate()}`,
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

export const periods = {
  // タイム：週単位
  time: {
    kind: 'time',
    unit: 'week',
    of(date = new Date()) {
      return week(mondayOf(date));
    },
    // キーは週の月曜日（YYYY-MM-DD）。週内のどの日を渡しても同じ週に正規化される。
    fromKey(key) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? ''));
      if (!m) return null;
      const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (Number.isNaN(date.getTime())) return null;
      return week(mondayOf(date));
    },
    shift(key, offset) {
      const base = this.fromKey(key);
      if (!base) return null;
      return week(mondayOf(addDays(new Date(base.start), offset * 7)));
    },
  },

  // ウォレット：週単位。タイムと同じ刻みで見るために揃えた。
  // 月あたりで持っている報酬は、既定値を出すときに4で割る。
  money: {
    kind: 'money',
    unit: 'week',
    of(date = new Date()) {
      return week(mondayOf(date));
    },
    fromKey(key) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? ''));
      if (!m) return null;
      const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (Number.isNaN(date.getTime())) return null;
      return week(mondayOf(date));
    },
    shift(key, offset) {
      const base = this.fromKey(key);
      if (!base) return null;
      return week(mondayOf(addDays(new Date(base.start), offset * 7)));
    },
  },
};

// 月あたりの報酬を、1週ぶんに均す。月を4週として割り切る。
export const weeklyShare = (monthly) => Math.round((Number(monthly) || 0) / 4);

export const currentWeek = (now = new Date()) => periods.time.of(now);
