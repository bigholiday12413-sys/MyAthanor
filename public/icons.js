/* ドット絵アイコン。
   16x16 のグリッドを文字で持ち、横に連続する同色をまとめて <rect> にする。
   拡大しても滲まないよう shape-rendering="crispEdges" で描く。 */

const INK = '#23281f'; // 輪郭に使う墨
const GOLD = '#a8802a';
const GOLD_DARK = '#7d5f18';
const GREEN = '#4e8b3a';
const GREEN_DARK = '#2f5e26';
const WOOD = '#8a5a2b';
const WOOD_DARK = '#5d3a18';
const CREAM = '#c9b78a'; // 明るい面。紙の上なので、白に近づけすぎない
const STONE = '#7d8175';
const TRAIL = '#8a7a55'; // 踏んだ跡
const GLASS = '#8fa79c';

// アイデア＝賢者の石。上面を磨いた赤い宝石として切り、下半分にファセットを入れる。
const PHILOSOPHERS_STONE = {
  rows: [
    '................',
    '....oooooooo....',
    '...ossllllllo...',
    '..oslllllllllo..',
    '.orrrrrrrrrrrro.',
    '.orrrrrrrrrrrro.',
    '..oddrrrrrrddo..',
    '...oddrrrrddo...',
    '...oddrrrrddo...',
    '....odrrrrdo....',
    '.....odrrdo.....',
    '......oddo......',
    '.......oo.......',
    '................',
    '................',
    '................',
  ],
  palette: {
    o: '#4a1410', // 縁
    s: '#ffd9c8', // きらめき
    l: '#e8624a', // 天面
    r: '#cc3a2a', // 本体
    d: '#7d1f18', // 側面のファセット
  },
};

/* アイデアそのものの終わり＝金色の宝石。賢者の石と同じ形を金で磨き直す。
   子のプロセスをいくつ完了しても付かない、アイデア自身の締めくくりだけの印。 */
const PHILOSOPHERS_STONE_GOLD = {
  rows: PHILOSOPHERS_STONE.rows,
  palette: {
    o: '#4a3410', // 縁
    s: '#fff3c8', // きらめき
    l: '#e8b23a', // 天面
    r: '#c9932a', // 本体
    d: GOLD_DARK, // 側面のファセット
  },
};

// ログ（出来事）＝歩いた足跡。
// くびれは片側だけ削って土踏まずにする。両側から削ると細くなりすぎて足に見えない。
// 右上が前（右足）、左下が後ろ（左足）で、歩いている向きを出す。
const FOOTSTEPS = {
  rows: [
    '.........pppp...',
    '........pppppp..',
    '........pppppp..',
    '.........ppppp..',
    '..........pppp..',
    '.........ppppp..',
    '.........pppp...',
    '..........ppp...',
    '...pppp.........',
    '..pppppp........',
    '..pppppp........',
    '..ppppp.........',
    '..pppp..........',
    '..ppppp.........',
    '...pppp.........',
    '...ppp..........',
  ],
  palette: { p: '#7d6f4c' },
};

// ミッション＝羊皮紙の巻物。
const PARCHMENT = {
  rows: [
    '................',
    '..hhhhhhhhhhhh..',
    '..hHHHHHHHHHHh..',
    '..occcccccccco..',
    '..oclllllllcco..',
    '..occcccccccco..',
    '..oclllllllcco..',
    '..occcccccccco..',
    '..oclllllcccco..',
    '..occcccccccco..',
    '..oclllllllcco..',
    '..occcccccccco..',
    '..hHHHHHHHHHHh..',
    '..hhhhhhhhhhhh..',
    '................',
    '................',
  ],
  palette: { h: WOOD_DARK, H: WOOD, o: GOLD_DARK, c: CREAM, l: WOOD_DARK },
};

// 定期イベント＝砂時計。
const HOURGLASS = {
  rows: [
    '................',
    '..wwwwwwwwwwww..',
    '..wssssssssssw..',
    '...gssssssssg...',
    '....gssssssg....',
    '.....gssssg.....',
    '......gssg......',
    '.......gg.......',
    '......g..g......',
    '.....g....g.....',
    '....g..ss..g....',
    '...g.ssssss.g...',
    '..wssssssssssw..',
    '..wwwwwwwwwwww..',
    '................',
    '................',
  ],
  palette: { w: WOOD, s: GOLD, g: GLASS },
};

// 設定＝鍵。
const KEY = {
  rows: [
    '................',
    '................',
    '................',
    '...ggggg........',
    '..gg...gg.......',
    '..g.....g.......',
    '..g.....g.......',
    '..gg...gg.......',
    '...ggggggggggggg',
    '..........g...g.',
    '..........g...g.',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  palette: { g: GOLD_DARK },
};

// ホームタブ＝紋章の盾。
const SHIELD = {
  rows: [
    '................',
    '..oooooooooooo..',
    '..oggg1111gggo..',
    '..oggg1111gggo..',
    '..oggg1111gggo..',
    '..oggg1111gggo..',
    '..oggg1111gggo..',
    '...ogg1111ggo...',
    '...ogg1111ggo...',
    '....og1111go....',
    '....og1111go....',
    '.....o1111o.....',
    '.....o1111o.....',
    '......o11o......',
    '.......oo.......',
    '................',
  ],
  palette: { o: GREEN_DARK, g: GREEN, 1: GOLD },
};

// ストリームタブ＝年代記の本。
const BOOK = {
  rows: [
    '................',
    '..oooo....oooo..',
    '.occcco..occcco.',
    '.occcccooccccco.',
    '.oclllcooclllco.',
    '.occcccooccccco.',
    '.oclllcooclllco.',
    '.occcccooccccco.',
    '.oclllcooclllco.',
    '.occcccooccccco.',
    '.oclllcooclllco.',
    '.occcccooccccco.',
    '.oooooooooooooo.',
    '................',
    '................',
    '................',
  ],
  palette: { o: WOOD_DARK, c: CREAM, l: WOOD },
};

const PLUS = {
  rows: [
    '................',
    '................',
    '................',
    '......gggg......',
    '......gggg......',
    '......gggg......',
    '...gggggggggg...',
    '...gggggggggg...',
    '...gggggggggg...',
    '...gggggggggg...',
    '......gggg......',
    '......gggg......',
    '......gggg......',
    '................',
    '................',
    '................',
  ],
  palette: { g: '#33230a' },
};

// ダンジョンタブ＝石の門。
const GATE = {
  rows: [
    '................',
    '.....oooooo.....',
    '...oossssssoo...',
    '..ossddddddsso..',
    '.osssddddddssso.',
    '.ossddddddddsso.',
    '.ossddddddddsso.',
    '.ossddddddddsso.',
    '.ossddddddddsso.',
    '.ossddddddddsso.',
    '.ossddddddddsso.',
    '.ossddddddddsso.',
    '.ossddddddddsso.',
    '.oooooooooooooo.',
    '................',
    '................',
  ],
  palette: { o: INK, s: STONE, d: '#120e06' },
};

// レガシー＝宝箱。
const CHEST = {
  rows: [
    '................',
    '................',
    '....oooooooo....',
    '...owwwwwwwwo...',
    '..owwwwwwwwwwo..',
    '..obbbbbbbbbbo..',
    '..owwwwggwwwwo..',
    '..owwwwggwwwwo..',
    '..obbbbggbbbbo..',
    '..owwwwwwwwwwo..',
    '..owwwwwwwwwwo..',
    '..oooooooooooo..',
    '................',
    '................',
    '................',
    '................',
  ],
  palette: { o: INK, w: WOOD, b: GOLD_DARK, g: GOLD },
};

// 大釜＝素材を集めて錬成する器。
const CAULDRON = {
  rows: [
    '................',
    '....gg....gg....',
    '.....g....g.....',
    '..oooooooooooo..',
    '..oggggggggggo..',
    '.obbbbbbbbbbbbo.',
    '.obbbbbbbbbbbbo.',
    '.obbbbbbbbbbbbo.',
    '.obbbbbbbbbbbbo.',
    '..obbbbbbbbbbo..',
    '...obbbbbbbbo...',
    '....oooooooo....',
    '.....o....o.....',
    '....oo....oo....',
    '................',
    '................',
  ],
  palette: { o: INK, b: '#4a4038', g: GREEN },
};

// スペルブック＝閉じた魔導書。背表紙・小口・表紙の紋章で組む。
const GRIMOIRE = {
  rows: [
    '................',
    '..oooooooooooo..',
    '..oSSccccccccpo.',
    '..oSSccccccccpo.',
    '..oSSccc11cccpo.',
    '..oSScc1111ccpo.',
    '..oSSc111111cpo.',
    '..oSSc111111cpo.',
    '..oSScc1111ccpo.',
    '..oSSccc11cccpo.',
    '..oSSccccccccpo.',
    '..oSSccccccccpo.',
    '..oSSccccccccpo.',
    '..oooooooooooo..',
    '................',
    '................',
  ],
  palette: { o: INK, S: WOOD_DARK, c: GREEN_DARK, p: CREAM, 1: GOLD },
};

// スペル1つ＝刻んだ紋。
const SIGIL = {
  rows: [
    '................',
    '.......gg.......',
    '.......gg.......',
    '......gggg......',
    '......gggg......',
    '.g...gggggg...g.',
    '..gg.gggggg.gg..',
    '...gggccccggg...',
    '...gggccccggg...',
    '..gg.gggggg.gg..',
    '.g...gggggg...g.',
    '......gggg......',
    '......gggg......',
    '.......gg.......',
    '.......gg.......',
    '................',
  ],
  palette: { g: GOLD_DARK, c: '#c9a24a' },
};

// 金庫＝積み上がった金貨。宝箱（レガシー）とは別物なので硬貨の段で表す。
const COINS = {
  rows: [
    '................',
    '................',
    '................',
    '...oooooooooo...',
    '...ohhhhhhhho...',
    '...oggggggggo...',
    '...oddddddddo...',
    '...oggggggggo...',
    '...oddddddddo...',
    '...oggggggggo...',
    '...oddddddddo...',
    '...oooooooooo...',
    '................',
    '................',
    '................',
    '................',
  ],
  palette: { o: INK, h: '#ffeab4', g: GOLD, d: GOLD_DARK },
};

// アイデアの温度＝炎。熱さに応じて色を差し替えて使う（icon の第3引数）。
const FLAME = {
  rows: [
    '................',
    '.......ff.......',
    '......ffff......',
    '......ffff......',
    '.....ffffff.....',
    '.....ffffff.....',
    '....ffffffff....',
    '....ffffffff....',
    '...fffccccfff...',
    '...fffccccfff...',
    '...fffccccfff...',
    '...fffccccfff...',
    '....ffccccff....',
    '.....ffccff.....',
    '......ffff......',
    '................',
  ],
  palette: { f: '#b07f14', c: '#e0bf6a' },
};

// 冷めきったアイデア＝霜の結晶。
const FROST = {
  rows: [
    '................',
    '.......cc.......',
    '....c..cc..c....',
    '.....c.cc.c.....',
    '......cccc......',
    '..c...cccc...c..',
    '...cc.cccc.cc...',
    'cccccccccccccccc',
    'cccccccccccccccc',
    '...cc.cccc.cc...',
    '..c...cccc...c..',
    '......cccc......',
    '.....c.cc.c.....',
    '....c..cc..c....',
    '.......cc.......',
    '................',
  ],
  palette: { c: '#5f93ad' },
};

const CHEVRON = {
  rows: [
    '................',
    '................',
    '................',
    '................',
    '.......gg.......',
    '......gg........',
    '.....gg.........',
    '....gg..........',
    '....gg..........',
    '.....gg.........',
    '......gg........',
    '.......gg.......',
    '................',
    '................',
    '................',
    '................',
  ],
  palette: { g: '#6f7568' },
};

// 横方向の連続をまとめて矩形にする。
export function toRects({ rows, palette }) {
  const parts = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const fill = palette[row[x]];
      if (!fill) {
        x += 1;
        continue;
      }
      let run = 1;
      while (x + run < row.length && row[x + run] === row[x]) run += 1;
      parts.push(`<rect x="${x}" y="${y}" width="${run}" height="1" fill="${fill}"/>`);
      x += run;
    }
  });
  return parts.join('');
}

// 糧＝消え物。丸パン。上面に切り込みを入れて、焼き上がりの向きを出す。
const PROVISION = {
  rows: [
    '................',
    '................',
    '................',
    '.....oooooo.....',
    '...oohhhhhhoo...',
    '..ohhhhhhhhhho..',
    '..ohhcchhcchho..',
    '..ohhcchhcchho..',
    '..obhhhhhhhhho..',
    '..obbhhhhhhhbo..',
    '..obbbbbbbbbbo..',
    '...oobbbbbboo...',
    '.....oooooo.....',
    '................',
    '................',
    '................',
  ],
  palette: {
    o: '#5d3a18', // 焼き縁
    h: '#e0b070', // 上面
    c: '#8a5a2b', // 切り込み
    b: '#b07a3c', // 底
  },
};

// 装備＝残るもの。兜。細い天面から裾へ広げ、面頬の一文字と呼吸孔を入れる。
// 箱のまま描くと書物のアイコンと見分けが付かないので、輪郭で silhouette を作る。
const HELM = {
  rows: [
    '................',
    '................',
    '......oooo......',
    '.....ollllo.....',
    '....ollllllo....',
    '....ommmmmmo....',
    '....odddddddo...',
    '....ommmmmmo....',
    '...ommmmmmmmo...',
    '...omddmmddmo...',
    '...osssssssso...',
    '..osssssssssso..',
    '..oooooooooooo..',
    '................',
    '................',
    '................',
  ],
  palette: {
    o: '#241a0c', // 縁
    l: '#cfd6d8', // 天面の照り
    m: '#9aa5ab', // 鋼
    d: '#141410', // 面頬の隙間と呼吸孔
    s: '#6e777c', // 裾の陰
  },
};

/* 祭事＝その場限りのもの。幟（のぼり）。竿に長い旗を掛けて、裾を切り込む。
   糧（食い物）も装備（兜）も物の形をしているので、三つ目は物でないと分かる形にする。
   幟は立てて畳むもので、終われば何も残らない。 */
const BANNER = {
  rows: [
    '.....p..........',
    '.....p..........',
    '.....poooooooo..',
    '.....pobbbbbbo..',
    '.....pobggggbo..',
    '.....pobgrrgbo..',
    '.....pobgrrgbo..',
    '.....pobggggbo..',
    '.....pobbbbbbo..',
    '.....pobobbobo..',
    '.....pooboobo...',
    '.....p..........',
    '.....p..........',
    '....ppp.........',
    '...ppppp........',
    '................',
  ],
  palette: {
    p: '#5d3a18', // 竿と台
    o: '#7d5f18', // 旗の縁
    b: '#c9b78a', // 生成りの布
    g: '#4e8b3a', // 染めの帯
    r: '#a8802a', // 紋
  },
};

// 週の紙。7枚並べて曜日を数える。右下が折れていて、左の縁が少し欠けている。
// 面は白より温かくしておく。白いカードの上に白い紙を置くと枠しか見えず、
// 「点線の四角」になってしまう。欠けも1か所だけ。増やすと点線に戻る。
const SHEET = {
  rows: [
    '................',
    '................',
    '..oooooooooooo..',
    '..oppppppppppo..',
    '..oppppppppppo..',
    '..oppppppppppo..',
    '..oppppppppppo..',
    '..oppppppppppo..',
    '...ppppppppppo..',
    '..oppppppppppo..',
    '..opppppppppof..',
    '..oppppppppoff..',
    '..opppppppoffd..',
    '..oppppppoffdd..',
    '..oooooooffddd..',
    '................',
  ],
  palette: { o: TRAIL, p: '#f6f2e3', f: '#ded2b0', d: '#c2b287' },
};

// 済んだ日の紙。印を入れる。
const SHEET_DONE = {
  rows: [
    '................',
    '................',
    '..oooooooooooo..',
    '..oppppppppppo..',
    '..oppppppppppo..',
    '..opppppppvppo..',
    '..oppppppvvppo..',
    '..opvpppvvvppo..',
    '...pvvpvvvpppo..',
    '..opvvvvvppppo..',
    '..oppvvvppppof..',
    '..opppvppppoff..',
    '..opppppppoffd..',
    '..oppppppoffdd..',
    '..oooooooffddd..',
    '................',
  ],
  palette: { o: TRAIL, p: '#f6f2e3', f: '#ded2b0', d: '#c2b287', v: GREEN },
};

// プロセス＝調合の1工程。丸底フラスコ。棚に並ぶものと同じ形にしてある。
const FLASK = {
  rows: [
    '......cccc......',
    '......cccc......',
    '......oggo......',
    '......oggo......',
    '......oggo......',
    '.....og..go.....',
    '....og....go....',
    '...og.lllll.o...',
    '..og.lllllll.o..',
    '..ogllllllllgo..',
    '.ogllllllllllgo.',
    '.ogllllllllllgo.',
    '.ogllllllllllgo.',
    '..ogllllllllgo..',
    '..oogllllllgoo..',
    '....oooooooo....',
  ],
  palette: { o: '#5f6d73', g: '#cfe0d8', c: WOOD, l: GREEN },
};

// ログの中の「プロセス」＝注ぎ終えた後の丸底フラスコ。形はプロセスの器と同じにして、
// 中だけ空にする。満ちているか空かで、これからやることか、もう済んだことかを分ける。
const FLASK_EMPTY = {
  rows: FLASK.rows,
  palette: { ...FLASK.palette, l: FLASK.palette.g },
};

// アストロラーベ＝天体の位置を読む器具。同心の輪と、中を渡す横木。
const ASTROLABE = {
  rows: [
    '................',
    '.....oooooo.....',
    '...oo......oo...',
    '..o..oooooo..o..',
    '.o..o......o..o.',
    '.o.o..oooo..o.o.',
    'o..o.o....o.o..o',
    'o..o.o....o.o..o',
    'o..o.o....o.o..o',
    'o..o..oooo..o..o',
    '.o.o........o.o.',
    '.o..o......o..o.',
    '..o..oooooo..o..',
    '...oo......oo...',
    '.....oooooo.....',
    '................',
  ],
  palette: { o: STONE },
};

// 輝き。レガシーの節に添える四光の星。
const SPARK = {
  rows: [
    '................',
    '................',
    '.......gg.......',
    '.......gg.......',
    '......gggg......',
    '..g...gggg...g..',
    '...gg.gggg.gg...',
    '....gggggggg....',
    '....gggggggg....',
    '...gg.gggg.gg...',
    '..g...gggg...g..',
    '......gggg......',
    '.......gg.......',
    '.......gg.......',
    '................',
    '................',
  ],
  palette: { g: GOLD },
};

// 棚番＝フラスコを1つずつ見て回る小さいもの。
// 2等身。仕立てた服ではなく、白い布をただ巻いて頭からかぶっただけ。
// いつも横を向いている（進む向き）。布は右前だけ開けて、前髪と、鼻と顎の
// 輪郭だけを出す。目は描かない。点で目を入れると顔が主役になってしまう。
// 頭には黒い魔女帽を斜めにかぶせる。つばから右上へ立ち上げ、途中で折って、
// 先端は後頭部の側へ垂らす。真っ直ぐ尖らせると硬い三角にしか見えない。
// 体は裾に向けて丸めない。丸めると雪だるまになるので、真っ直ぐ落として裾で切り、
// 後ろ（進む向きの反対）へ布を引きずらせる。
// 帽子のぶん縦に伸びるので、この絵だけ 16x20 で持ち、viewBox も合わせる。
// 歩く柄を3枚。輪郭は同じで、布の皺の寄り方と裾の広がりだけが違う。
// 1歩ごとに柄を替えることで、滑って動くのではなく歩いて見える。
// 左右対称の合わせ目を入れると仕立て服に見えるので、皺は斜めに短く散らす。
// 裾も揃えない。布は真っ直ぐには落ちない。
// 白のままだと紙の上で消えるので、輪郭を1本回して縁を拾う。
const KEEPER = {
  rows: [
    '..kkk...........',
    '..kkkkk.........',
    '....kkkkk.......',
    '.......kkkk.....',
    '.......kkkkk....',
    '.....kkkkkkk....',
    '.kkkkkkkkkkkk...',
    '.kkkooooooo.....',
    '...owwwwhhho....',
    '...owwwhffffo...',
    '...owwwffffo....',
    '...owwwwffo.....',
    '....owwwwo......',
    '...owwwwwwwo....',
    '..owwwwwwwwwo...',
    '..owwwwwwswwo...',
    '..owwwwwwwswo...',
    '..owswwwwwwwo...',
    '..owwswwwwwwo...',
    'owwwwwwwwwwwo...',
  ],
  palette: { o: '#8a8778', w: '#fbf8ec', s: '#dcd8c5', h: '#6b5a3a', f: '#e8c9a0', k: '#23281f' },
};

const KEEPER_B = {
  rows: [
    '..kkk...........',
    '..kkkkk.........',
    '....kkkkk.......',
    '.......kkkk.....',
    '.......kkkkk....',
    '.....kkkkkkk....',
    '.kkkkkkkkkkkk...',
    '.kkkooooooo.....',
    '...owwwwhhho....',
    '...owwwhffffo...',
    '...owwwffffo....',
    '...owwwwffo.....',
    '....owwwwo......',
    '...owwwwwwwo....',
    '..owwwwwswwwo...',
    '..owwwwwwwwwo...',
    '..owwwwwwswwo...',
    '..owwswwwwwwo...',
    '..owswwwwwwwo...',
    '.owwwwwwwwwwo...',
  ],
  palette: { o: '#8a8778', w: '#fbf8ec', s: '#dcd8c5', h: '#6b5a3a', f: '#e8c9a0', k: '#23281f' },
};

const KEEPER_C = {
  rows: [
    '..kkk...........',
    '..kkkkk.........',
    '....kkkkk.......',
    '.......kkkk.....',
    '.......kkkkk....',
    '.....kkkkkkk....',
    '.kkkkkkkkkkkk...',
    '.kkkooooooo.....',
    '...owwwwhhho....',
    '...owwwhffffo...',
    '...owwwffffo....',
    '...owwwwffo.....',
    '....owwwwo......',
    '...owwwwwwwo....',
    '..owwwwwwwswo...',
    '..owwwwwswwwo...',
    '..owwwwwwwwwo...',
    '..oswwwwwwwwo...',
    '..owwwswwwwwo...',
    'owwwwwwwwwwo....',
  ],
  palette: { o: '#8a8778', w: '#fbf8ec', s: '#dcd8c5', h: '#6b5a3a', f: '#e8c9a0', k: '#23281f' },
};










// 週の表。曜日を縦の仕切りで割り、塗ったマスを緑で出す。
// 設定の「週のタイム」へ行くための札。
const TIMEGRID = {
  rows: [
    '................',
    '................',
    '..oooooooooooo..',
    '..o..oggo..o.o..',
    '..oggoggo..ogo..',
    '..oggoggo..ogo..',
    '..oggo..oggogo..',
    '..o..o..oggogo..',
    '..o..o..oggo.o..',
    '..o..o..oggo.o..',
    '..o..o..o..o.o..',
    '..o..o..o..o.o..',
    '..o..o..o..o.o..',
    '..oooooooooooo..',
    '................',
    '................',
  ],
  palette: { o: STONE, g: GREEN },
};

// 循環。2本の弧が輪になって追いかけ合う印。繰り返すプロセスに添える。
// 線は2ドット。1ドットだと13px まで縮めたとき輪が消えて点線に見える。
/* 循環の印。これだけドット絵にしない。

   16x16 の枡では、輪と2本の鏃を同時に置くと、どちらも潰れて団子になる。
   札に添える大きさ（11〜13px）だと、なおさら矢印だと読めない。
   ここは「循環だ」と一目で分かることが要るので、滑らかな線で描いて
   白く塗り、墨で縁取る。紙の上でも管の上でも、白い札として浮く。 */
const CYCLE = {
  body:
    '<path d="M 1.99 10.19 A 6.4 6.4 0 0 1 9.76 1.85 L 10.21 0.31 L 11.49 4.86 ' +
    'L 8.39 6.65 L 8.83 5.12 A 3.0 3.0 0 0 0 5.18 9.03 Z ' +
    'M 14.01 5.81 A 6.4 6.4 0 0 1 6.24 14.15 L 5.79 15.69 L 4.51 11.14 ' +
    'L 7.61 9.35 L 7.17 10.88 A 3.0 3.0 0 0 0 10.82 6.97 Z" ' +
    `fill="#ffffff" stroke="${INK}" stroke-width="0.8" stroke-linejoin="round" />`,
};

const SOURCES = {
  stone: PHILOSOPHERS_STONE,
  'stone-gold': PHILOSOPHERS_STONE_GOLD,
  footsteps: FOOTSTEPS,
  parchment: PARCHMENT,
  hourglass: HOURGLASS,
  key: KEY,
  shield: SHIELD,
  book: BOOK,
  gate: GATE,
  chest: CHEST,
  cauldron: CAULDRON,
  coins: COINS,
  provision: PROVISION,
  helm: HELM,
  grimoire: GRIMOIRE,
  sigil: SIGIL,
  flame: FLAME,
  frost: FROST,
  plus: PLUS,
  chevron: CHEVRON,
  cycle: CYCLE,
  timegrid: TIMEGRID,
  keeper: KEEPER,
  'keeper-b': KEEPER_B,
  'keeper-c': KEEPER_C,
  astrolabe: ASTROLABE,
  spark: SPARK,
  flask: FLASK,
  'flask-empty': FLASK_EMPTY,
  banner: BANNER,
  sheet: SHEET,
  'sheet-done': SHEET_DONE,
};

// 滑らかに描くものは、そのまま持っている中身を使う。
const RENDERED = Object.fromEntries(
  Object.entries(SOURCES).map(([name, source]) => [
    name,
    source.body ?? toRects(source),
  ]),
);

// 地図など、外側の SVG に埋め込みたいときは矩形だけ取り出す。
export function iconBody(name, overrides = null) {
  const source = SOURCES[name];
  if (!source) return '';
  return overrides && source.rows
    ? toRects({ rows: source.rows, palette: { ...source.palette, ...overrides } })
    : RENDERED[name];
}

// overrides を渡すと配色だけ差し替えて描き直す（温度による炎の色など）。
export function icon(name, className = '', overrides = null) {
  const source = SOURCES[name];
  if (!source) return '';
  const body = overrides && source.rows
    ? toRects({ rows: source.rows, palette: { ...source.palette, ...overrides } })
    : RENDERED[name];
  // 枡で描いたものだけ枡に合わせる。滑らかに描くものに掛けると角が立つ。
  const crisp = source.body ? '' : 'shape-rendering="crispEdges" ';
  return (
    `<svg class="px ${className}" viewBox="0 0 16 16" ${crisp}` +
    `aria-hidden="true" focusable="false">${body}</svg>`
  );
}

// 種別からアイコン名を引く。
export const KIND_ICON = {
  idea: 'stone',
  food: 'provision',
  gear: 'helm',
  feast: 'banner',
  log: 'footsteps',
  mission: 'flask',
  process: 'flask-empty',
};
