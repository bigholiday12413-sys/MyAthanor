# 書体

**Kaisei Opti** — Font-Kai（金井和夫） https://font-kai.jp
Copyright 2020 The Kaisei Project Authors https://github.com/Font-Kai/Kaisei

SIL Open Font License 1.1（全文は `OFL.txt`）。
OFL は複製・改変・再配布を認めるかわりに、**ライセンス全文を必ず一緒に配ること**を
求めているので、`OFL.txt` は消さないこと。

## ここに入っている物

元の TTF（1つ4MB超）そのままではなく、WOFF2 に詰め直して符号位置で切り分けたもの。

| | 中身 | 大きさ |
|---|---|---|
| `*-base.woff2` | 欧文・記号・かな・全角 | 約130KB |
| `*-kanji1.woff2` | U+4E00–5FFF | 約350KB |
| `*-kanji2.woff2` | U+6000–6FFF | 約370KB |
| `*-kanji3.woff2` | U+7000–7FFF | 約340KB |
| `*-kanji4.woff2` | U+8000–9FFF | 約640KB |

太さは 400（Regular）と 700（Bold）の2つ。CSS に出てくるのがこの2つで、
Medium(500) は 15px では Regular と見分けが付かなかったため入れていない。

`styles.css` の `@font-face` に `unicode-range` を書いてあるので、
書いた字に当たった切れ端だけが落ちてくる。ふだんの画面は `base` で足りる。

縦組みは使わないので `vert` などの機能は落とし、詰め（`kern` `palt`）と
合字だけ残してある。

## 作り直し方

書体を差し替えるときだけ。出来上がりはリポジトリに入っているので、
ふだん動かす必要はない。

```bash
pip install "fonttools[woff]" brotli
python3 scripts/build-fonts.py <元のTTFが入った場所>
```

元の TTF は `KaiseiOptiRegular.ttf` / `KaiseiOptiBold.ttf` という名前で置く。
