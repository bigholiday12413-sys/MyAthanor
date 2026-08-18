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

    /* 週のタイムは塗りで持ち、時間数はその塗りから数える。
       数字だけで持つと、設定画面の表が空のまま「14h ある」ことになって食い違う。
       平日の夜（20-22時）と土日の午前（9-12時）で16時間。 */
    const grid = Array.from({ length: 7 * 24 }, (_, cell) => {
      const day = Math.floor(cell / 24);
      const hour = cell % 24;
      const weekday = day < 5 && hour >= 20 && hour < 22;
      const weekend = day >= 5 && hour >= 9 && hour < 12;
      return weekday || weekend ? '1' : '0';
    }).join('');

    run(
      `UPDATE settings
          SET weekly_time = ?, monthly_money = ?, vault_initial = ?, time_grid = ?
        WHERE id = 1`,
      [...grid].filter((cell) => cell === '1').length * 60,
      60000,  // 月の報酬。4で割った 15,000 が1週ぶんになる
      48000,
      grid,
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

    // 買ったもの。糧は食べれば消え、装備は残る。
    const bought = (title, days, money, goods) =>
      idOf(
        `INSERT INTO log (title, occurred_at, time_spent, money_spent, goods)
         VALUES (?, ?, 0, ?, ?)`,
        title,
        iso(days),
        money,
        goods,
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

    const soil = doneMission('土を入れ替える', 'idea', garden, 240, 4800, 32);
    const stone = doneMission('石を並べる', 'log', soil.log, 480, 9800, 21);
    run(`UPDATE log SET is_legacy = 1 WHERE id = ?`, stone.log);

    activeMission('灯籠を据える', 'log', stone.log, 180, 12000, ymd(4));

    const moss = activeMission('苔を張る', 'log', stone.log, 300, 3000, null);
    run(`UPDATE mission SET status = 'abandoned' WHERE id = ?`, moss);

    const step = doneMission('飛石を打つ', 'log', stone.log, 200, 3200, 9);
    activeMission('延段を継ぐ', 'log', step.log, 150, 2400, ymd(12));
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
    const maple = activeMission('楓を選ぶ', 'idea', garden, 60, 6000, null, cauldron);
    run(
      `UPDATE mission SET status = 'done', completed_at = ? WHERE id = ?`,
      iso(3),
      maple,
    );
    log('楓を選ぶ', 3, 60, 6000, maple);
    activeMission('苔を注文', 'idea', garden, 30, 2600, null, cauldron);
    activeMission('土壌を検査', 'idea', garden, 90, 1800, null, cauldron);

    /* 書物 */
    const book = idea('写本を仕上げる', 26, 312);
    const paper = doneMission('料紙を漉く', 'idea', book, 360, 6400, 11);
    run(`UPDATE mission SET is_legacy = 1 WHERE id = ?`, paper.id);
    activeMission('罫を引く', 'log', paper.log, 90, 1200, ymd(2));

    /* 冷めかけのアイデアと、スペル */
    const kiln = idea('小さな窯をつくる', 120, 366);

    const spell = idOf(
      `INSERT INTO idea (title, created_at, is_spell, body, temperature, temperature_at)
       VALUES (?, ?, 1, ?, 273, ?)`,
      '手入れの要るものだけを持つ',
      iso(18),
      '直せないものは増やさない。手を入れるたびに愛着が乗るものを選ぶ。\n'
        + '道具は買うときではなく、直すときに自分のものになる。',
      iso(18),
    );

    /* 単独のログ */
    log('古書店で拾った断簡', 5, 60, 3400);
    log('鑿を研いだ', 2, 45, 0);

    /* 先月ぶんの消費。金庫の積み上がりを見せるため */
    log('石材の下見', 38, 120, 5200);
    log('苗床の土', 45, 90, 3400);

    /* ふだんの買い物。出来事という出来事は無くても、これは記録する */
    for (const [title, days, money] of [
      ['八百屋で野菜', 0, 1240],
      ['米を買う', 1, 4180],
      ['豆腐と油揚げ', 2, 380],
      ['珈琲豆', 4, 1680],
      ['朝の焼き立て', 5, 680],
      ['蕎麦と天ぷら', 7, 1450],
      ['卵と牛乳', 9, 720],
      ['八百屋で野菜', 11, 1080],
      ['米を買う', 16, 4180],
      ['乾物をまとめて', 20, 3240],
    ]) {
      bought(title, days, money, 'food');
    }
    bought('剪定鋏', 6, 4200, 'gear');
    bought('鉄瓶', 13, 5600, 'gear');
    bought('作業用の前掛け', 24, 3600, 'gear');

    /* 繰り返すプロセス。種だけ置いておくと、開いたときに先の回が生えてくる。
       固定費として可処分から先に引かれるので、タイムだけのものと
       ウォレットだけのものを両方置いて、両方の管が減るのを見せる。 */
    const seedOf = (title, days, minutes, money) =>
      run(
        `INSERT INTO mission
           (title, source_type, source_id, status, estimated_time, estimated_money,
            created_at, repeat_days)
         VALUES (?, 'idea', ?, 'active', ?, ?, ?, ?)`,
        title,
        garden,
        minutes,
        money,
        iso(28),
        days,
      );

    seedOf('庭の水やり', 3, 45, 0);
    seedOf('炭と灯油', 30, 0, 12000);
  });
}
