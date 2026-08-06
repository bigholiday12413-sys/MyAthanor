// 集計期間の算出。
// タイムは「週あたり」、ウォレットは「月あたり」の可処分量に対して集計する。
// 週は月曜始まり。境界はサーバのローカルタイムゾーンで判定する。

function toLocalIso(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

// SQLite に格納した ISO(UTC) 文字列と比較するため、境界も UTC の ISO に揃える。
function boundaries(start, end) {
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    start_local: toLocalIso(start),
    end_local: toLocalIso(end),
  };
}

export function currentWeek(now = new Date()) {
  const start = new Date(now);
  const dayFromMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - dayFromMonday);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  const last = new Date(end.getTime() - 1);
  const label =
    `${start.getMonth() + 1}/${start.getDate()}-${last.getMonth() + 1}/${last.getDate()}`;

  return { unit: 'week', label, ...boundaries(start, end) };
}

export function currentMonth(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  const label = `${start.getFullYear()}/${String(start.getMonth() + 1).padStart(2, '0')}`;
  return { unit: 'month', label, ...boundaries(start, end) };
}
