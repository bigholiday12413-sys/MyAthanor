#!/usr/bin/env python3
"""Kaisei Opti を配信できる形にする。

元の TTF は1つ4MB超あり、そのままでは載せられない。
WOFF2 に詰め直したうえで、符号位置で切り分けて置く。
ふだんの画面は欧文・記号・かなだけで足りるので、漢字は書いた字に
当たったぶんだけ落ちてくる。

出来上がりはリポジトリに入れてあるので、ふだん動かす必要はない。
書体を差し替えるときだけ:

    pip install "fonttools[woff]" brotli
    python3 scripts/build-fonts.py <元のTTFが入った場所>
"""

import os
import sys
from fontTools import subset

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'fonts')

# 使う太さは CSS に出てくる 400 と 700 だけ。
# Medium(500) も見比べたが、15px では Regular と見分けが付かず、
# 積むと2MB増えるだけなので載せていない。
FACES = [('Regular', 400), ('Bold', 700)]

SLICES = [
    # ふだんの画面はここだけで足りる
    ('base', 'U+0-2FFF,U+3000-30FF,U+3100-4DFF,U+A000-FEFF,U+FF00-FFEF,U+2F800-2FA1F'),
    ('kanji1', 'U+4E00-5FFF'),
    ('kanji2', 'U+6000-6FFF'),
    ('kanji3', 'U+7000-7FFF'),
    ('kanji4', 'U+8000-9FFF'),
]

# 縦組みは使わないので落とす。詰めと合字だけ残す。
FEATURES = 'kern,palt,liga,clig,ccmp,locl'


def main(src_dir):
    os.makedirs(OUT, exist_ok=True)
    for face, weight in FACES:
        src = os.path.join(src_dir, f'KaiseiOpti{face}.ttf')
        if not os.path.exists(src):
            sys.exit(f'見つかりません: {src}')
        for name, ranges in SLICES:
            out = os.path.join(OUT, f'kaisei-opti-{weight}-{name}.woff2')
            subset.main([
                src,
                f'--unicodes={ranges}',
                f'--output-file={out}',
                '--flavor=woff2',
                f'--layout-features={FEATURES}',
                '--no-hinting',
                '--desubroutinize',
                '--drop-tables+=DSIG',
            ])
            print(f'{weight} {name:7} {os.path.getsize(out) / 1024:8.1f} KB')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'fonts-src'))
