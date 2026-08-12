/* プレビュー版の見本。空の画面では手ざわりが分からないので、
   どの画面にも何かが出ている状態から始める。
   日付は「今」から逆算して入れる。置いた日付を焼き込むと、
   時間が経つほど古びて、期限や試験管の見え方が変わってしまうため。 */

const DAY = 86400000;

const iso = (daysAgo, hour = 10) => {
  const d = new Date(Date.now() - daysAgo * DAY);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

const ymd = (daysFromNow) => {
  const d = new Date(Date.now() + daysFromNow * DAY);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function seed(db, transaction) {
  transaction(() => {
    const run = (sql, ...params) => db.prepare(sql).run(...params);
    const idOf = (sql, ...params) => Number(run(sql, ...params).lastInsertRowid);

    run(
      `UPDATE settings SET weekly_time = ?, monthly_money = ?, vault_initial = ? WHERE id = 1`,
      14 * 60,
      60000,
      48000,
    );

    /* タグ */
    const tagIds = {};
    for (const name of ['庭', '書物', '道具']) {
      tagIds[name] = idOf(`INSERT INTO tag (name, created_at) VALUES (?, ?)`, name, iso(60));
    }
    const tie = (kind, entryId, name) =>
      run(
        `INSERT INTO entry_tag (kind, entry_id, tag_id) VALUES (?, ?, ?)`,
        kind,
        entryId,
        tagIds[name],
      );

    const idea = (title, days, temperature) =>
      idOf(
        `INSERT INTO idea (title, created_at, temperature, temperature_at) VALUES (?, ?, ?, ?)`,
        title,
        iso(days),
        temperature,
        iso(days),
      );

    const log = (title, days, time, money, missionId = null) =>
      idOf(
        `INSERT INTO log (title, occurred_at, time_spent, money_spent, source_mission_id)
         VALUES (?, ?, ?, ?, ?)`,
        title,
        iso(days),
        time,
        money,
        missionId,
      );

    const doneMission = (title, source, sourceId, time, money, days) => {
      const id = idOf(
        `INSERT INTO mission
           (title, source_type, source_id, status, estimated_time, estimated_money,
            created_at, completed_at)
         VALUES (?, ?, ?, 'done', ?, ?, ?, ?)`,
        title,
        source,
        sourceId,
        time,
        money,
        iso(days + 2),
        iso(days),
      );
      return { id, log: log(title, days, time, money, id) };
    };

    const activeMission = (title, source, sourceId, time, money, due, cauldronId = null) =>
      idOf(
        `INSERT INTO mission
           (title, source_type, source_id, status, estimated_time, estimated_money,
            created_at, due_date, cauldron_id)
         VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
        title,
        source,
        sourceId,
        time,
        money,
        iso(6),
        due,
        cauldronId,
      );

    /* 庭：いちばん深い道。入口から掘削中まで灯りが通る */
    const garden = idea('月見の庭をつくる', 40, 344);
    tie('idea', garden, '庭');

    const soil = doneMission('土を入れ替える', 'idea', garden, 240, 18000, 32);
    const stone = doneMission('石を並べる', 'log', soil.log, 480, 42000, 21);
    run(`UPDATE log SET is_legacy = 1 WHERE id = ?`, stone.log);
    tie('log', stone.log, '庭');

    activeMission('灯籠を据える', 'log', stone.log, 180, 60000, ymd(4));

    const moss = activeMission('苔を張る', 'log', stone.log, 300, 12000, null);
    run(`UPDATE mission SET status = 'abandoned' WHERE id = ?`, moss);

    const step = doneMission('飛石を打つ', 'log', stone.log, 200, 9000, 9);
    activeMission('延段を継ぐ', 'log', step.log, 150, 7000, ymd(12));
    activeMission('井戸を探す', 'log', soil.log, 120, 0, null);

    // 大釜：素材が1つだけ済んだ状態
    const cauldron = idOf(
      `INSERT INTO cauldron (title, source_type, source_id, created_at, due_date)
       VALUES (?, 'idea', ?, ?, ?)`,
      '苗の手配',
      garden,
      iso(14),
      ymd(9),
    );
    const maple = activeMission('楓を選ぶ', 'idea', garden, 60, 30000, null, cauldron);
    run(
      `UPDATE mission SET status = 'done', completed_at = ? WHERE id = ?`,
      iso(3),
      maple,
    );
    log('楓を選ぶ', 3, 60, 30000, maple);
    activeMission('苔を注文', 'idea', garden, 30, 8000, null, cauldron);
    activeMission('土壌を検査', 'idea', garden, 90, 5000, null, cauldron);

    /* 書物 */
    const book = idea('写本を仕上げる', 26, 312);
    tie('idea', book, '書物');
    const paper = doneMission('料紙を漉く', 'idea', book, 360, 24000, 11);
    run(`UPDATE mission SET is_legacy = 1 WHERE id = ?`, paper.id);
    activeMission('罫を引く', 'log', paper.log, 90, 1200, ymd(2));

    /* 冷めかけのアイデアと、スペル */
    const kiln = idea('小さな窯をつくる', 120, 366);
    tie('idea', kiln, '道具');

    const spell = idOf(
      `INSERT INTO idea (title, created_at, is_spell, body, temperature, temperature_at)
       VALUES (?, ?, 1, ?, 273, ?)`,
      '手入れの要るものだけを持つ',
      iso(18),
      '直せないものは増やさない。手を入れるたびに愛着が乗るものを選ぶ。\n'
        + '道具は買うときではなく、直すときに自分のものになる。',
      iso(18),
    );
    tie('idea', spell, '道具');

    /* 単独のログ */
    const scrap = log('古書店で拾った断簡', 5, 60, 3400);
    tie('log', scrap, '書物');
    log('鑿を研いだ', 2, 45, 0);

    /* 先月ぶんの消費。金庫の積み上がりを見せるため */
    log('石材の下見', 38, 120, 21000);
    log('苗床の土', 45, 90, 12500);

    /* 定期イベント */
    run(
      `INSERT INTO recurrence
         (title, freq, weekday, time_spent, money_spent, start_date, active, created_at)
       VALUES (?, 'weekly', 5, ?, ?, ?, 1, ?)`,
      '庭の水やり',
      45,
      0,
      ymd(-28),
      iso(28),
    );
  });
}
