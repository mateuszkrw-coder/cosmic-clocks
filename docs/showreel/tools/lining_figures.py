"""Make lining, tabular figures the default in Cormorant, for the numbers on screen.

    python docs/showreel/tools/lining_figures.py

Canvas 2D has no font-variant-numeric, and Cormorant's default figures are old-style
(the 3 and 7 drop below the line). The site sets `lining-nums tabular-nums` in CSS;
this does the same once, by pointing the digits in the font's character map at the
glyphs its own `lnum` and `tnum` features substitute. Needs fontTools and brotli.
"""
from pathlib import Path

from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent.parent / 'fonts'


def substitutions(font, tag):
    gsub = font['GSUB'].table
    out = {}
    for rec in gsub.FeatureList.FeatureRecord:
        if rec.FeatureTag != tag:
            continue
        for index in rec.Feature.LookupListIndex:
            for sub in gsub.LookupList.Lookup[index].SubTable:
                if sub.LookupType == 7:          # extension lookup
                    sub = sub.ExtSubTable
                if hasattr(sub, 'mapping'):
                    out.update(sub.mapping)
    return out


for style in ('normal', 'italic'):
    font = TTFont(HERE / f'Cormorant-{style}-latin.woff2')
    lnum, tnum = substitutions(font, 'lnum'), substitutions(font, 'tnum')
    for table in font['cmap'].tables:
        for code in range(0x30, 0x3A):
            if code in table.cmap:
                glyph = table.cmap[code]
                glyph = lnum.get(glyph, glyph)
                glyph = tnum.get(glyph, glyph)
                table.cmap[code] = glyph
    font.flavor = 'woff2'
    font.save(HERE / f'CormorantLining-{style}-latin.woff2')
    print(f'CormorantLining-{style}-latin.woff2')
