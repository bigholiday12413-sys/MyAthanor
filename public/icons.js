/* ドット絵アイコン。
   16x16 のグリッドを文字で持ち、横に連続する同色をまとめて <rect> にする。
   拡大しても滲まないよう shape-rendering="crispEdges" で描く。 */

const INK = '#241a0c'; // 輪郭に使う焦茶
const GOLD = '#e0aa3c';
const GOLD_DARK = '#a97c22';
const GREEN = '#7ab648';
const GREEN_DARK = '#4e7c2c';
const WOOD = '#8a5a2b';
const WOOD_DARK = '#5d3a18';
const CREAM = '#ecd9a8';
const STONE = '#8d8f7a';
const STONE_DARK = '#5f6152';
const STEEL = '#aebcc0';
const STEEL_DARK = '#6d7e85';
const SHINE = '#e8f1f3';
const GLASS = '#b9c9c2';

// アイデア＝石。刻まれたルーンが光っている。
const STONE_ROCK = {
  rows: [
    '................',
    '................',
    '.....oooooo.....',
    '...oohhhhhhoo...',
    '..ohhhhhhhhhho..',
    '.ohhhhhhhhhhhho.',
    '.ohhhh1111hhhho.',
    'ohhhhh1111hhhhho',
    'ohhhhhh11hhhhhho',
    'ohhhhh11hhhhhhho',
    'ohhhhhhhhhhhhhho',
    '.ohhhhhhhhhhhho.',
    '..osssssssssso..',
    '...oooooooooo...',
    '................',
    '................',
  ],
  palette: { o: INK, h: STONE, s: STONE_DARK, 1: GOLD },
};

// ログ（出来事）＝剣。
const SWORD = {
  rows: [
    '.......ws.......',
    '......ewsd......',
    '......ewsd......',
    '......ewsd......',
    '......ewsd......',
    '......ewsd......',
    '......ewsd......',
    '......ewsd......',
    '......ewsd......',
    '......ewsd......',
    '..gggggggggggg..',
    '.......hh.......',
    '.......hh.......',
    '.......hh.......',
    '......gggg......',
    '................',
  ],
  palette: { w: SHINE, s: STEEL, e: STEEL, d: STEEL_DARK, g: GOLD, h: WOOD },
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
  palette: { g: GOLD },
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
  palette: { g: '#1e2a12' },
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
  palette: { g: CREAM },
};

// 横方向の連続をまとめて矩形にする。
function toRects({ rows, palette }) {
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

const SOURCES = {
  stone: STONE_ROCK,
  sword: SWORD,
  parchment: PARCHMENT,
  hourglass: HOURGLASS,
  key: KEY,
  shield: SHIELD,
  book: BOOK,
  gate: GATE,
  chest: CHEST,
  plus: PLUS,
  chevron: CHEVRON,
};

const RENDERED = Object.fromEntries(
  Object.entries(SOURCES).map(([name, source]) => [name, toRects(source)]),
);

export function icon(name, className = '') {
  const body = RENDERED[name];
  if (!body) return '';
  return (
    `<svg class="px ${className}" viewBox="0 0 16 16" shape-rendering="crispEdges" ` +
    `aria-hidden="true" focusable="false">${body}</svg>`
  );
}

// 種別からアイコン名を引く。
export const KIND_ICON = {
  idea: 'stone',
  log: 'sword',
  mission: 'parchment',
  recurrence: 'hourglass',
};
