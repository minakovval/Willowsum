import os, json, sys
sys.path.insert(0, os.path.dirname(__file__))
from common import page
import comps1, comps2, comps3, comps4, comps5, comps6, comps7
ALL = {}
for m in (comps1, comps2, comps3, comps4, comps5, comps6, comps7): ALL.update(m.C)
OUT = os.path.join(os.path.dirname(__file__), 'out', 'project', 'components')
heights = json.load(open('heights.json')) if os.path.exists('heights.json') else {}
for name, (g, h, sub, body, css) in ALL.items():
    d = os.path.join(OUT, name); os.makedirs(d, exist_ok=True)
    h = heights.get(name, h)
    open(os.path.join(d, 'preview.html'), 'w').write(page(g, h, sub, body, css))
os.makedirs(os.path.join(OUT, 'Cover'), exist_ok=True)
open(os.path.join(OUT, 'Cover', 'preview.html'), 'w').write(comps4.COVER)
print(len(ALL), sorted(ALL))
