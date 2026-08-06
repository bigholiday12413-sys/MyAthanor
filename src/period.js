// 集計期間の算出。
// タイムは「週あたり」（月曜始まり）、ウォレットは「月あたり」で管理する。
// 境界はサーバのローカルタイムゾーンで判定し、SQLite に格納した ISO(UTC)
// 文字列と比較できるよう UTC の ISO に揃えて返す。

const pad = (n) => String(n).padStart(2, '0');

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
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

function month(start) {
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  return {
    unit: 'month',
    key: `${start.getFullYear()}-${pad(start.getMonth() + 1)}`,
    label: `${start.getFullYear()}/${pad(start.getMonth() + 1)}`,
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

  // ウォレット：月単位
  money: {
    kind: 'money',
    unit: 'month',
    of(date = new Date()) {
      return month(new Date(date.getFullYear(), date.getMonth(), 1));
    },
    // キーは YYYY-MM。
    fromKey(key) {
      const m = /^(\d{4})-(\d{2})$/.exec(String(key ?? ''));
      if (!m) return null;
      const monthNumber = Number(m[2]);
      if (monthNumber < 1 || monthNumber > 12) return null;
      return month(new Date(Number(m[1]), monthNumber - 1, 1));
    },
    shift(key, offset) {
      const base = this.fromKey(key);
      if (!base) return null;
      const start = new Date(base.start);
      return month(new Date(start.getFullYear(), start.getMonth() + offset, 1));
    },
  },
};

export const currentWeek = (now = new Date()) => periods.time.of(now);
export const currentMonth = (now = new Date()) => periods.money.of(now);
