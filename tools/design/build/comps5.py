"""DS-07 chart palette: categories = group tone + shade, sources/accounts = chart-cat order, «Інші · N» last."""
from common import *
from oklch import shades, cr, hex2oklch, oklch2hex, dark_shade
import comps3, comps4
from comps3 import card, donut, spark, SVGCSS, HATCH, MONTHS, ringp
C = {}

G = {  # group tone tokens
    'Житло': 'var(--chart-cat-1)', 'Харчування': 'var(--chart-cat-2)', 'Транспорт і авто': 'var(--chart-cat-3)',
    "Зв'язок і підписки": 'var(--chart-cat-4)', "Здоров'я і догляд": 'var(--chart-cat-5)', 'Родина': 'var(--chart-cat-6)',
    'Відпочинок': 'var(--chart-cat-7)', 'Фінанси і податки': 'var(--chart-cat-8)'}
_food = shades('#0E9161', 3); _rod = shades('#9B5BB6', 5); _tr = shades('#9C7305', 2); _com = shades('#097FCD', 2); _inc = shades('#BA4E84', 2)
CAT = {  # category shades (DS-07 п. 15; the first four are the DS-07 acceptance examples)
    'Продукти': '#045D2F', 'Кафе і ресторани': '#099673', 'Доставка їжі': _food[2],
    'Комунальні': '#494BAB', 'Дім': '#3968C2',
    'Діти': _rod[0], 'Одяг': _rod[1], 'Подарунки': _rod[2], 'Освіта': _rod[3],
    'Пальне': _tr[0], 'Таксі': _tr[1], 'Мобільний звʼязок': _com[0], 'Підписки': _com[1],
    'Зарплата': _inc[0], 'Премії': _inc[1]}
OTHER = 'var(--chart-other)'
CAT['Переказ'] = '#9DB2C8'
CAT_HEX = dict(CAT)
_names = list(CAT_HEX)
def _txt_light(h): return '#FFFFFF' if cr(h, '#FFFFFF') >= 4.5 else '#1B2230'
def _icon_light(h): return '#FFFFFF' if cr(h, '#FFFFFF') >= 3 else '#1B2230'
_l = []; _d = []
for i, n in enumerate(_names):
    h = CAT_HEX[n]; d = h if n == 'Переказ' else dark_shade(h)
    _l.append(f'--k{i}:{h};--kt{i}:{_txt_light(h)};--ki{i}:{_icon_light(h)};'); _d.append(f'--k{i}:{d};--kt{i}:#0B2545;--ki{i}:#0B2545;')
CATCSS = ':root{' + ''.join(_l) + '}[data-theme="dark"]{' + ''.join(_d) + '}'
DARK_HEX = {n: (CAT_HEX[n] if n == 'Переказ' else dark_shade(CAT_HEX[n])) for n in _names}
CAT = {n: f'var(--k{i})' for i, n in enumerate(_names)}
CATT = {n: f'var(--kt{i})' for i, n in enumerate(_names)}
CATI = {n: f'var(--ki{i})' for i, n in enumerate(_names)}

def on(c):  # text/icon on a filled cell: white if 4.5:1, else ink
    return '#FFFFFF' if c.startswith('#') and cr(c, '#FFFFFF') >= 4.5 else '#1B2230'

def key(c, hatch=False):
    return f'<span class="key{" hatch" if hatch else ""}" style="{"" if hatch else "background:" + c}"></span>'

REF = '<svg width="20" height="8" aria-hidden="true"><line x1="0" y1="4" x2="20" y2="4" class="ref" stroke-width="2" stroke-dasharray="{d}"/></svg>'
CSS5 = SVGCSS + '.ref{stroke:var(--chart-reference)}'

# ---------- BarChart ----------
def _bars():
    groups = [('Житло', 'var(--chart-cat-1)', [820, 840, 860, 830, 810, 800]), ('Харчування', 'var(--chart-cat-2)', [690, 720, 650, 700, 760, 740]),
              ('Транспорт і авто', 'var(--chart-cat-3)', [310, 280, 350, 330, 300, 360]), ('Родина', 'var(--chart-cat-6)', [420, 380, 510, 460, 400, 470])]
    other = [260, 300, 240, 280, 310, 290]
    W, H, L, T, B = 640, 270, 56, 12, 230
    mx = 3000; y = lambda v: B - (B - T) * v / mx
    g = ''.join(f'<line x1="{L}" x2="{W}" y1="{y(v):.1f}" y2="{y(v):.1f}" class="gl"/><text x="{L-8}" y="{y(v)+4:.1f}" text-anchor="end" class="ax">{v//1000 if v else 0}{(NB+"тис.") if v else ""}{NB}€</text>' for v in (0, 1000, 2000, 3000))
    bw = (W - L) / 6; bars = ''
    for i in range(6):
        x = L + i * bw + bw * .22; w = bw * .56; base = 0
        for n, c, vals in groups:
            v = vals[i]
            bars += f'<rect x="{x:.1f}" y="{y(base+v)+1:.1f}" width="{w:.1f}" height="{y(base)-y(base+v)-1:.1f}" style="fill:{c}"/>'
            base += v
        v = other[i]
        bars += f'<rect x="{x:.1f}" y="{y(base+v)+1:.1f}" width="{w:.1f}" height="{y(base)-y(base+v)-1:.1f}" fill="url(#h)"/>'
        bars += f'<text x="{x+w/2:.1f}" y="{B+16}" text-anchor="middle" class="ax">{MONTHS[6+i]}</text>'
    bars += f'<line x1="{L}" x2="{W}" y1="{y(2700):.1f}" y2="{y(2700):.1f}" class="ref" stroke-width="2" stroke-dasharray="12 4"/>'
    svg1 = f'<svg viewBox="0 0 {W} {H}" width="100%" role="img" aria-label="Витрати за групами за 6 місяців і бюджет 2 700,00 €">{HATCH}{g}{bars}</svg>'
    leg1 = '<div class="leg">' + ''.join(f'<span>{key(c)}{n}</span>' for n, c, _ in groups) + f'<span>{key("", True)}Інші · 4</span><span>{REF.format(d="12 4")}Бюджет · {eur("2 700,00")}</span></div>'
    # sources (not categories) → chart-cat order
    src = [('Зарплата Олени', 'var(--chart-cat-1)', [3400] * 4), ('Зарплата Андрія', 'var(--chart-cat-2)', [2100, 2100, 2250, 2250]), ('Оренда гаража', 'var(--chart-cat-3)', [150, 150, 150, 150])]
    W2, H2, L2, B2 = 420, 220, 48, 180; s = 150 / 6000
    b2 = ''.join(f'<line x1="{L2}" x2="{W2}" y1="{B2-v*s:.1f}" y2="{B2-v*s:.1f}" class="gl"/><text x="{L2-6}" y="{B2-v*s+4:.1f}" text-anchor="end" class="ax">{v//1000}{NB}тис.</text>' for v in (2000, 4000, 6000))
    for i, m in enumerate(['Лип.', 'Серп.', 'Вер.', 'Жовт.']):
        x = L2 + 16 + i * 90; base = 0
        for n, c, vals in src:
            v = vals[i]; b2 += f'<rect x="{x}" y="{B2-(base+v)*s+1:.1f}" width="44" height="{v*s-1:.1f}" style="fill:{c}"/>'; base += v
        b2 += f'<text x="{x+22}" y="{B2+16}" text-anchor="middle" class="ax">{m}</text>'
    svg2 = f'<svg viewBox="0 0 {W2} {H2}" width="100%" role="img" aria-label="Дохід за джерелами за 4 місяці">{b2}<line x1="{L2}" x2="{W2}" y1="{B2}" y2="{B2}" class="zl"/></svg>'
    leg2 = '<div class="leg">' + ''.join(f'<span>{key(c)}{n}</span>' for n, c, _ in src) + '</div>'
    rk = [('Продукти', 612.4, 100), ('Кафе і ресторани', 284.9, 46.5), ('Таксі', 132.6, 21.7), ('Підписки', 64.0, 10.5)]
    rows = ''.join(f'<div style="display:flex;align-items:center;gap:12px;height:28px"><span class="t1" style="width:32%;font-weight:400">{n}</span><span style="flex:1;height:14px"><i style="display:block;height:14px;width:{p}%;border-radius:0 4px 4px 0;background:{CAT[n]}"></i></span><span class="amt" style="width:90px;text-align:right;font-size:13px">{eur(("%.2f" % v).replace(".", ","))}</span></div>' for n, v, p in rk)
    rows += f'<div style="display:flex;align-items:center;gap:12px;height:28px"><span class="t1" style="width:32%;font-weight:400">Інші · 5</span><span style="flex:1;height:14px"><i class="hatch" style="display:block;height:14px;width:30%;border-radius:0 4px 4px 0"></i></span><span class="amt" style="width:90px;text-align:right;font-size:13px">{eur("183,70")}</span></div>'
    body = (f'<div class="stack">{card("Витрати за групами", "Травень — жовтень 2026 · накопичені стовпці, колір групи, бюджет — довгий штрих", svg1 + leg1)}'
            f'<div class="grid2">{card("Дохід за джерелами", "Джерела — не категорії: кольори chart-cat у сталому порядку", svg2 + leg2)}{card("Найбільші категорії", "Жовтень 2026 · колір категорії, «Інші · N» — останнім", rows)}</div></div>')
    return ('Графіки', 840, 'Палітра DS-07: групи, джерела, категорії, «Інші · N», лінія бюджету', body, CSS5)
C['BarChart'] = _bars()

# ---------- DonutChart ----------
def _donut():
    P = [(34, 'var(--chart-cat-1)', 'Житло'), (28, 'var(--chart-cat-2)', 'Харчування'), (16, 'var(--chart-cat-6)', 'Родина'), (12, 'var(--chart-cat-3)', 'Транспорт і авто'), (10, 'url(#h)', 'Інші · 4')]
    svg = donut([(p, c) for p, c, _ in P], center=('3' + NB + '289' + NB + '€', 'витрати жовтня')).replace('aria-label="Кільцева діаграма">', 'aria-label="Витрати жовтня за групами">' + HATCH)
    leg = ''.join(f'<div style="display:flex;align-items:center;gap:10px;height:32px;border-bottom:1px solid var(--surface-300)">{key(c, "url" in c)}<span style="flex:1">{n}</span><span class="tab muted">{p} %</span></div>' for p, c, n in P)
    a = f'<div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap">{svg}<div style="flex:1;min-width:200px">{leg}</div></div>'
    rows3 = [[(58, 'var(--chart-cat-1)'), (18, 'var(--chart-cat-2)'), (24, 'var(--chart-cat-3)')], [(45, 'var(--chart-cat-1)'), (30, 'var(--chart-cat-2)'), (25, 'var(--chart-cat-3)')]]
    rings = donut(None, r=78, w=14, size=180, rings=rows3)
    leg2 = '<table style="border-collapse:collapse;font-size:13px;width:100%"><tr class="muted"><td></td><td style="text-align:right;padding:4px 8px">Зараз</td><td style="text-align:right;padding:4px 0">Ціль</td></tr>' + ''.join(f'<tr style="border-top:1px solid var(--surface-300)"><td style="padding:6px 0"><span style="display:inline-flex;align-items:center;gap:8px">{key(c)}{n}</span></td><td class="tab" style="text-align:right;padding:6px 8px">{x} %</td><td class="tab" style="text-align:right">{y} %</td></tr>' for n, c, x, y in [('Акції', 'var(--chart-cat-1)', 58, 45), ('Облігації', 'var(--chart-cat-2)', 18, 30), ('Гроші', 'var(--chart-cat-3)', 24, 25)]) + '</table><span class="sub">Зовнішнє кільце — зараз, внутрішнє — ціль.</span>'
    b = f'<div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap">{rings}<div style="flex:1;min-width:200px">{leg2}</div></div>'
    body = '<div class="grid2">' + card('Витрати за групами', 'Тон групи chart-cat; «Інші · N» — штрихування, останнім', a) + card('Портфель: зараз і ціль', 'Класи — chart-cat у сталому порядку', b) + '</div>'
    return ('Графіки', 520, 'Групи — тоном групи; класи — chart-cat у сталому порядку', body, CSS5)
C['DonutChart'] = _donut()

# ---------- Treemap (DS-07, критерій 10) ----------
def _tree():
    def cell(n, p, c, w, h):
        col = CATT.get(n, '#1B2230')
        txt = f'<b>{n}</b><span>{p} %</span>' if p >= 4 else ''
        bg = f'background:{c};' if not c.startswith('url') else ''
        return f'<div class="tm{" hatch" if c.startswith("url") else ""}" style="{bg}color:{col};width:{w};height:{h}" title="{n} · {p} %" tabindex="0">{txt}</div>'
    other = 'var(--chart-other)'
    tm = ('<div class="tmw">'
          f'<div class="grp" style="width:44%">{cell("Продукти", 22, CAT["Продукти"], "100%", "62%")}{cell("Кафе і ресторани", 13, CAT["Кафе і ресторани"], "100%", "38%")}</div>'
          f'<div style="flex:1;display:flex;flex-direction:column;gap:2px">'
          f'<div class="grp" style="height:52%;flex-direction:row">{cell("Комунальні", 19, CAT["Комунальні"], "62%", "100%")}{cell("Дім", 11, CAT["Дім"], "38%", "100%")}</div>'
          f'<div class="grp" style="flex:1;flex-direction:row;flex-wrap:wrap">{cell("Діти", 12, CAT["Діти"], "calc(42% - 2px)", "100%")}{cell("Одяг", 9, CAT["Одяг"], "calc(30% - 2px)", "100%")}<div style="flex:1;display:flex;flex-direction:column;gap:2px">{cell("Подарунки", 6, CAT["Подарунки"], "100%", "50%")}{cell("Освіта", 5, CAT["Освіта"], "100%", "50%")}</div></div>'
          f'<div style="height:14%;display:flex">{cell("Інші · 1", 3, other, "100%", "100%")}</div>'
          '</div></div>')
    order = [('Харчування', [('Продукти', 22), ('Кафе і ресторани', 13)]), ('Житло', [('Комунальні', 19), ('Дім', 11)]), ('Родина', [('Діти', 12), ('Одяг', 9), ('Подарунки', 6), ('Освіта', 5)])]
    leg = '<div class="leg" style="flex-direction:column;gap:6px">' + ''.join(f'<span><b style="font-weight:600;width:110px">{g}</b>' + ''.join(f'<span style="display:inline-flex;align-items:center;gap:6px;margin-right:14px">{key(CAT[c])}{c} <span class="muted tab">{p} %</span></span>' for c, p in cs) + '</span>' for g, cs in order) + f'<span><b style="font-weight:600;width:110px"></b><span style="display:inline-flex;align-items:center;gap:6px">{key(other)}Інші · 1 (Благодійність) <span class="muted tab">3 %</span></span></span></div>'
    css = CSS5 + ('.tmw{display:flex;gap:2px;height:300px;background:var(--surface-200)}.grp{display:flex;flex-direction:column;gap:2px;outline:2px solid #FFFFFF;outline-offset:-1px}'
                  '.tm{display:flex;flex-direction:column;justify-content:flex-end;padding:8px 10px;font-size:12px;line-height:16px;overflow:hidden}.tm b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tm span{font-variant-numeric:tabular-nums}')
    return ('Графіки', 520, 'Категорії — відтінки тону групи; група в білій рамці 2 px; «Інші · N» сірим', card('Витрати жовтня за категоріями', 'Групи «Харчування», «Житло», «Родина»; DS-07, критерій 10', tm + leg), css)
C['Treemap'] = _tree()

# ---------- AllocationBar ----------
def _alloc():
    seg = [('EUR', 34, 'var(--chart-cat-1)', eur('11 400,00'), ''), ('UAH', 56, 'var(--chart-cat-2)', uah('829 680,00'), '≈ ' + eur('18 880,00')), ('USD', 10, 'var(--chart-cat-3)', '3' + NB + '500,00' + NB + '$', '≈ ' + eur('3 220,00'))]
    bar = ''.join(f'<div style="width:{p}%;background:{c}"></div>' for _, p, c, _, _ in seg)
    leg = ''.join(f'<span style="display:flex;align-items:flex-start;gap:8px"><span class="key" style="width:10px;height:10px;margin-top:5px;background:{c}"></span><span style="display:flex;flex-direction:column"><span><span class="muted">{n}</span> <b class="amt">{a}</b></span><span class="sub tab">{(s + " · ") if s else ""}{p} %</span></span></span>' for n, p, c, a, s in seg)
    inner1 = f'<div class="big">{eur("32 860,00")}</div><span style="color:var(--ink-muted);font-size:12px;letter-spacing:.06em">ЗА ВАЛЮТАМИ</span><div class="ab">{bar}</div><div class="leg" style="gap:8px 28px">{leg}</div>'
    seg2 = [('Нерухомість', 58, 'var(--chart-cat-1)'), ('Інвестиції', 18, 'var(--chart-cat-2)'), ('Гроші', 12, 'var(--chart-cat-3)'), ('Транспорт', 7, 'var(--chart-cat-4)')]
    bar2 = ''.join(f'<div style="width:{p}%;background:{c}"></div>' for _, p, c in seg2) + '<div class="hatch" style="width:5%"></div>'
    leg2 = ''.join(f'<span>{key(c)}{n} <span class="muted tab">{p} %</span></span>' for n, p, c in seg2) + f'<span>{key("", True)}Інші · 3 <span class="muted tab">5 %</span></span>'
    body = '<div class="grid2">' + card('Гроші разом', 'Валюти — некатегоріальні серії: chart-cat у сталому порядку', inner1) + card('Розподіл активів', '5 класів · у EUR · «Інші · N» — штрихування, останнім', f'<div class="ab">{bar2}</div><div class="leg">{leg2}</div>') + '</div>'
    return ('Графіки', 330, 'Смуга часток: chart-cat у сталому порядку, проміжки 2 px', body, '.ab{display:flex;height:10px;gap:2px;border-radius:4px;overflow:hidden;background:var(--surface-200)}')
C['AllocationBar'] = _alloc()

# ---------- SummaryWidget ----------
_s = comps4.C['SummaryWidget']
_sb = (_s[3].replace('var(--ca)', 'var(--chart-cat-1)').replace('var(--cplan)', 'var(--chart-cat-2)').replace('var(--cc)', 'var(--chart-cat-3)').replace('var(--cb)', 'var(--chart-cat-4)'))
C['SummaryWidget'] = (_s[0], _s[1], _s[2], _sb, _s[4])

# ---------- scales ----------
def interp(stops, pct):
    """OKLCH interpolation between (pos, hex) stops."""
    pct = max(0, min(100, pct))
    for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
        if p0 <= pct <= p1:
            t = 0 if p1 == p0 else (pct - p0) / (p1 - p0)
            a, b = hex2oklch(c0), hex2oklch(c1)
            dh = ((b[2] - a[2] + 180) % 360) - 180
            return oklch2hex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + dh * t)
    return stops[-1][1]
USAGE = [(0, '#0E7A3B'), (30, '#34A853'), (55, '#7CC242'), (75, '#C9C21A'), (95, '#FBBC05'), (100, '#FBBC05')]
GOAL = [(0, '#FFD000'), (25, '#E6CF1A'), (55, '#9ACD32'), (80, '#4CAF50'), (100, '#2E7D32')]

def brow(name, spent, limit, pct, state, color, right, over=0, overc=''):
    tail = f'<i style="position:absolute;left:100%;top:0;width:{over}%;height:6px;border-radius:0 999px 999px 0;background:{overc}"></i>' if over else ''
    return (f'<div class="br"><div style="display:flex;align-items:baseline;gap:4px 12px;flex-wrap:wrap"><b style="font-weight:600;font-size:16px;line-height:24px;flex:1" class="t1">{name}</b><span class="muted tab">{spent} з {limit}</span></div>'
            f'<div style="display:flex;align-items:center;gap:16px"><span class="bar" style="flex:1;margin-right:{over}%"><i style="width:{min(pct,100)}%;background:{color}"></i>{tail}</span><span style="width:150px;text-align:right;display:flex;flex-direction:column"><span class="amt">{right[0]}</span><span class="sub">{right[1]}</span></span></div>'
            f'<span style="font-size:13px;{state[1]}">{state[0]}</span></div>')

def _budget():
    rows = [
        brow('Продукти', eur('412,40'), eur('600,00'), 69, ('• є залишок', 'color:var(--ink-muted)'), interp(USAGE, 69), (eur('187,60'), '31 % ліміту залишилось')),
        brow('Кафе і ресторани', eur('258,00'), eur('300,00'), 86, ('! майже вичерпано · 86 %', 'color:var(--on-warning)'), interp(USAGE, 86), (eur('42,00'), '14 % ліміту')),
        brow('Комунальні', eur('188,20'), eur('188,20'), 100, ('✓ ліміт вичерпано', 'color:var(--ink-muted)'), interp(USAGE, 100), (eur('0,00'), 'обов’язкова')),
        brow('Подарунки', eur('150,00'), eur('150,00'), 100, ('! вичерпано', 'color:var(--loss)'), 'var(--over-1)', (eur('0,00'), 'необов’язкова')),
        brow('Таксі', eur('162,60'), eur('120,00'), 100, ('✕ перевищено · рівень 4', 'color:var(--loss)'), interp(USAGE, 100), (eur('42,60', '-'), '35 % понад ліміт'), over=12, overc='var(--over-4)'),
        brow('Розваги', eur('0,00'), eur('150,00'), 0, ('• не почато', 'color:var(--ink-muted)'), 'var(--line)', (eur('150,00'), '100 % ліміту')),
    ]
    scale = ('<div class="br" style="gap:10px"><span class="sh">Шкала використання ліміту (DS-06)</span><div style="height:10px;border-radius:999px;background:linear-gradient(90deg in oklch,var(--usage-0) 0%,var(--usage-30) 30%,var(--usage-55) 55%,var(--usage-75) 75%,var(--usage-95) 95%)"></div>'
             '<div style="display:flex;justify-content:space-between" class="sub tab"><span>0 %</span><span>30 %</span><span>55 %</span><span>75 %</span><span>95–100 %</span></div>'
             '<span class="sh">Перевищення, рівні 1–8</span><div style="display:flex;gap:2px">' + ''.join(f'<span style="flex:1;height:14px;background:var(--over-{i})"></span>' for i in range(1, 9)) + '</div>'
             '<div style="display:flex;justify-content:space-between" class="sub tab"><span>&lt; 5 %</span><span>5–10</span><span>10–20</span><span>20–50</span><span>50–100</span><span>100–200</span><span>200–500</span><span>≥ 500 %</span></div></div>')
    body = '<section class="card" style="max-width:720px;overflow:hidden">' + ''.join(rows) + scale + '</section>'
    return ('Продукт', 760, 'Смуга кольором шкали usage-*, перевищення — over-1…8', body, '.br{display:flex;flex-direction:column;gap:8px;padding:14px 20px;border-bottom:1px solid var(--surface-300)}.br:last-child{border-bottom:0}.bar{overflow:visible}')
C['BudgetRow'] = _budget()

# ---------- GoalProgress / RingProgress ----------
_g = comps4._c2.C['GoalProgress'] if hasattr(comps4, '_c2') else None
import comps2 as _c2
_gp = _c2.C['GoalProgress']
_gb = _gp[3]
for pct, old in [(52.5, 'var(--goal-55)'), (71.4, 'var(--goal-80)'), (28.8, 'var(--goal-25)'), (0, 'var(--goal-0)'), (100, 'var(--goal-100)')]:
    _gb = _gb.replace(f'width:{min(pct,100)}%;background:{old}', f'width:{min(pct,100)}%;background:{interp(GOAL, pct)}')
_gb += ('<div class="card" style="max-width:520px;margin-top:20px;padding:16px 20px;display:flex;flex-direction:column;gap:8px"><span class="sh">Шкала прогресу цілі (DS-06)</span>'
        '<div style="height:10px;border-radius:999px;background:linear-gradient(90deg in oklch,var(--goal-0) 0%,var(--goal-25) 25%,var(--goal-55) 55%,var(--goal-80) 80%,var(--goal-100) 100%)"></div>'
        '<div style="display:flex;justify-content:space-between" class="sub tab"><span>0 %</span><span>25 %</span><span>55 %</span><span>80 %</span><span>100 %</span></div>'
        '<span class="sub">Колір смуги — колір шкали в точці відсотка (інтерполяція OKLCH); «На паузі» — goal-paused.</span></div>')
C['GoalProgress'] = (_gp[0], 700, 'Смуга кольором шкали goal-* у точці відсотка; відстає, досягнуто, на паузі', _gb, _gp[4])

C['RingProgress'] = ('Графіки', 220, 'Дуга кольором шкали goal-* у точці відсотка', '<div class="row" style="gap:16px">' + ''.join(ringp(p, l, interp(GOAL, p)) for p, l in [(0, 'Новий ноутбук'), (29, 'Ремонт кухні'), (53, 'Відпустка в Італії'), (71, 'Подушка безпеки'), (100, 'Машина')]) + ringp(30, 'Весілля · на паузі', 'var(--goal-paused)') + '</div>', '.tk{stroke:var(--surface-300)}')

# ---------- LineChart: add category trend with reference lines ----------
def _cat_lines():
    W, H, L, T, B = 640, 220, 56, 12, 186
    a = [540, 580, 560, 610, 590, 612]; b = [240, 310, 260, 300, 270, 285]
    x = lambda i: L + i * (W - L - 16) / 5; y = lambda v: B - (B - T) * v / 800
    grid = ''.join(f'<line x1="{L}" x2="{W}" y1="{y(v):.1f}" y2="{y(v):.1f}" class="gl"/><text x="{L-8}" y="{y(v)+4:.1f}" text-anchor="end" class="ax">{v}{NB}€</text>' for v in (0, 200, 400, 600, 800))
    lab = ''.join(f'<text x="{x(i):.1f}" y="{B+18}" text-anchor="middle" class="ax">{MONTHS[6+i]}</text>' for i in range(6))
    pl = lambda vs: ' '.join(f'{x(i):.1f},{y(v):.1f}' for i, v in enumerate(vs))
    svg = (f'<svg viewBox="0 0 {W} {H}" width="100%" role="img" aria-label="Продукти і кафе за 6 місяців проти бюджету і плану">{grid}{lab}'
           f'<line x1="{L}" x2="{W}" y1="{y(600):.1f}" y2="{y(600):.1f}" class="ref" stroke-width="2" stroke-dasharray="12 4"/><line x1="{L}" x2="{W}" y1="{y(300):.1f}" y2="{y(300):.1f}" class="ref" stroke-width="2" stroke-dasharray="4 4"/>'
           f'<polyline points="{pl(a)}" fill="none" style="stroke:{CAT["Продукти"]}" stroke-width="2.4" stroke-linejoin="round"/><circle cx="{x(5):.1f}" cy="{y(a[5]):.1f}" r="5" style="fill:{CAT["Продукти"]};stroke:var(--surface-200)" stroke-width="2"/>'
           f'<polyline points="{pl(b)}" fill="none" style="stroke:{CAT["Кафе і ресторани"]}" stroke-width="2.4" stroke-dasharray="7 5"/><rect x="{x(5)-5:.1f}" y="{y(b[5])-5:.1f}" width="10" height="10" rx="2" style="fill:{CAT["Кафе і ресторани"]};stroke:var(--surface-200)" stroke-width="2"/></svg>')
    leg = (f'<div class="leg"><span>{key(CAT["Продукти"])}Продукти · <b class="amt">{eur("612,40")}</b></span><span>{key(CAT["Кафе і ресторани"])}Кафе і ресторани · <b class="amt">{eur("284,90")}</b></span>'
           f'<span>{REF.format(d="12 4")}Бюджет «Продукти» · {eur("600,00")}</span><span>{REF.format(d="4 4")}План «Кафе» · {eur("300,00")}</span></div>')
    return card('Категорії в часі', 'Серія-категорія — колір категорії; бюджет — штрих 12/4, план — 4/4, обидва chart-reference', svg + leg)
_l = comps3.C['LineChart']
_lb = _l[3].replace('<div class="grid2">', _cat_lines() + '<div class="grid2">', 1)
_lb = _lb.replace('12 місяців · лінія з площею, друга серія — штрих, підказка на кроці', '12 місяців · лінія тренду P0 (series-1), друга серія — штрих, підказка на кроці')
C['LineChart'] = (_l[0], 1000, 'Тренд P0 (series-*) і серії-категорії в кольорі категорії з опорними лініями', _lb, _l[4] + '.ref{stroke:var(--chart-reference)}')

# ---------- Sparkline / SmallMultiples: category colour ----------
def cspark(pts, color, w=120, h=32):
    mn, mx = min(pts), max(pts)
    xs = [i * (w - 4) / (len(pts) - 1) + 2 for i in range(len(pts))]
    ys = [h - 3 - (h - 6) * (p - mn) / ((mx - mn) or 1) for p in pts]
    pl = ' '.join(f'{a:.1f},{b:.1f}' for a, b in zip(xs, ys))
    return f'<svg width="100%" height="{h}" viewBox="0 0 {w} {h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="{pl}" fill="none" style="stroke:{color}" stroke-width="1.8" vector-effect="non-scaling-stroke"/><circle cx="{xs[-1]:.1f}" cy="{ys[-1]:.1f}" r="2.5" style="fill:{color}"/></svg>'

_sp = comps3.C['Sparkline']
_spb = _sp[3].replace(spark([6, 5, 7, 6, 8, 7, 9, 8], cls="sb"), cspark([6, 5, 7, 6, 8, 7, 9, 8], CAT['Продукти']))
C['Sparkline'] = (_sp[0], _sp[1], 'Тренд без осей; категорія — у своєму кольорі', _spb, _sp[4])

C['SmallMultiples'] = ('Графіки', 300, 'Категорії — кожна у своєму кольорі', '<div class="sm-g">' + ''.join(
    f'<div class="smc"><span style="font:500 13px/18px Inter,sans-serif" class="muted">{n}</span><b class="amt" style="font:600 18px/24px \'Inter Tight\',Inter,sans-serif">{v}</b><span class="{d[0]} tab" style="font-size:13px">{d[1]}</span>{cspark(p, CAT[n])}</div>'
    for n, v, d, p in [
        ('Продукти', eur('612,40'), ('dn', '▲ 8,2 % м/м'), [5, 6, 5, 7, 6, 8]),
        ('Кафе і ресторани', eur('284,90'), ('up', '▼ 12,0 % м/м'), [8, 7, 7, 6, 5, 5]),
        ('Таксі', eur('132,60'), ('dn', '▲ 3,1 % м/м'), [3, 4, 3, 4, 4, 5]),
        ('Підписки', eur('64,00'), ('', '— м/м'), [4, 4, 4, 4, 4, 4]),
        ('Комунальні', eur('188,20'), ('up', '▼ 5,4 % м/м'), [6, 7, 8, 7, 6, 5]),
        ('Пальне', eur('146,00'), ('dn', '▲ 9,9 % м/м'), [4, 3, 5, 4, 6, 6]),
    ]) + '</div>', SVGCSS + '.sm-g{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}.smc{display:flex;flex-direction:column;gap:4px;padding:12px 16px;border:1px solid var(--line);border-radius:8px;background:var(--surface-200)}')

# ---------- category chips: same category = same colour everywhere ----------
_CHIPMAP = {'#045D2F': 'Продукти', '#7A165C': 'Підписки', '#494BAB': 'Таксі', '#796000': 'Пальне', '#566174': 'Переказ', '#02537A': 'Зарплата'}
def _chips(body):
    for hx, n in _CHIPMAP.items():
        body = body.replace(f'<span class="catc"><span style="background:{hx}">', f'<span class="catc"><span style="background:{CAT[n]};color:{CATI[n]}">')
    return body
for _n in ('Table', 'TransactionRow', 'Chip'):
    _e = _c2.C[_n]
    _b = _chips(_e[3])
    assert '<span class="catc"><span style="background:#' not in _b, _n
    C[_n] = (_e[0], _e[1], _e[2], _b, _e[4])

# ---------- Heatmap: brand levels (DS-07 п. 9) ----------
_h = comps3.C['Heatmap']
C['Heatmap'] = (_h[0], _h[1], 'П’ять рівнів brand (v1)', _h[3].replace('var(--brand-2)', 'var(--brand)'), _h[4])

for _k in list(C):
    e = C[_k]; C[_k] = (e[0], e[1], e[2], e[3], e[4] + CATCSS)
