from common import *
import math
C = {}

SVGCSS = ('.fa{fill:var(--ca)}.fb{fill:var(--cb)}.fc{fill:var(--cc)}.fd{fill:var(--cplan)}.fbr{fill:var(--brand-2)}.fn{fill:var(--brand)}'
          '.sa{stroke:var(--ca)}.sb{stroke:var(--cb)}.sp{stroke:var(--cplan)}.sm{stroke:var(--chk)}'
          '.fg{fill:var(--gain)}.fl{fill:var(--loss)}.fs3{fill:var(--surface-300)}.fs2{fill:var(--surface-200)}.zl{stroke:var(--ink-muted);stroke-width:1.5}'
          '.vl{font:600 11px Inter,sans-serif;fill:var(--ink);font-variant-numeric:tabular-nums}')
HATCH = '<defs><pattern id="h" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="fs2"/><rect width="3" height="6" style="fill:var(--ink-muted)"/></pattern><pattern id="hl" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="fs2"/><rect width="3" height="6" class="fl"/></pattern></defs>'
MONTHS = ['лист.','груд.','січ.','лют.','бер.','квіт.','трав.','черв.','лип.','серп.','вер.','жовт.']

def card(title, sub, inner, extra=''):
    return f'<section class="card" style="padding:20px 24px;display:flex;flex-direction:column;gap:12px{extra}"><span style="display:flex;flex-direction:column;gap:2px"><span class="lbl">{title}</span><span class="sub">{sub}</span></span>{inner}</section>'

# ---------- AllocationBar ----------
def _alloc():
    seg = [('EUR', 34, '1D4E89', eur('11 400,00'), ''), ('UAH', 56, '4F7CAC', uah('829 680,00'), '≈ ' + eur('18 880,00')), ('USD', 10, '9DB2C8', '$' + NB + '3' + NB + '500,00', '≈ ' + eur('3 220,00'))]
    bar = ''.join(f'<div style="width:{p}%;background:#{c}"></div>' for _, p, c, _, _ in seg)
    leg = ''.join(f'<span style="display:flex;align-items:flex-start;gap:8px"><span class="key" style="width:10px;height:10px;margin-top:5px;background:#{c}"></span><span style="display:flex;flex-direction:column"><span><span class="muted">{n}</span> <b class="amt">{a}</b></span><span class="sub tab">{(s + " · ") if s else ""}{p} %</span></span></span>' for n, p, c, a, s in seg)
    inner1 = f'<div class="big">{eur("32 860,00")}</div><span style="color:var(--ink-muted);font-size:12px;letter-spacing:.06em">ЗА ВАЛЮТАМИ</span><div class="ab">{bar}</div><div class="leg" style="gap:8px 28px">{leg}</div>'
    seg2 = [('Нерухомість', 58, 'var(--ca)'), ('Інвестиції', 18, 'var(--cb)'), ('Гроші', 12, 'var(--cplan)'), ('Транспорт', 7, 'var(--cc)')]
    bar2 = ''.join(f'<div style="width:{p}%;background:{c}"></div>' for _, p, c in seg2) + '<div class="hatch" style="width:5%"></div>'
    leg2 = ''.join(f'<span><span class="key" style="background:{c}"></span>{n} <span class="muted tab">{p} %</span></span>' for n, p, c in seg2) + '<span><span class="key hatch"></span>Інші · 3 <span class="muted tab">5 %</span></span>'
    body = '<div class="grid2">' + card('Гроші разом', 'готівкові мінус кредитні · у валюті профілю EUR', inner1) + card('Розподіл активів', '5 класів · у EUR', f'<div class="ab">{bar2}</div><div class="leg">{leg2}</div>') + '</div>'
    return ('Графіки', 300, 'Смуга часток з легендою, як «Гроші разом» на полотні', body, '.ab{display:flex;height:10px;gap:2px;border-radius:4px;overflow:hidden}')
C['AllocationBar'] = _alloc()

# ---------- BarChart ----------
def _bars():
    vals = [2496, 3288, 2810, 2950, 3120, 2700, 3050, 2980, 3400, 3130, 2890, 3510]
    plan = 3000
    W, H, L, T, B = 640, 260, 52, 12, 228
    mx = 4000
    y = lambda v: B - (B - T) * v / mx
    g = ''.join(f'<line x1="{L}" x2="{W}" y1="{y(v):.1f}" y2="{y(v):.1f}" class="gl"/><text x="{L-8}" y="{y(v)+4:.1f}" text-anchor="end" class="ax">{v//1000 if v else 0}{NB+"тис."+NB+"€" if v else NB+"€"}</text>' for v in (0, 1000, 2000, 3000, 4000))
    bw = (W - L) / 12
    bars = ''
    for i, v in enumerate(vals):
        x = L + i * bw + bw * .2
        cls = 'fa'
        bars += f'<rect x="{x:.1f}" y="{y(v):.1f}" width="{bw*.6:.1f}" height="{B-y(v):.1f}" rx="2" class="{cls}"/><text x="{x+bw*.3:.1f}" y="{B+16}" text-anchor="middle" class="ax">{MONTHS[i]}</text>'
    bars += f'<line x1="{L}" x2="{W}" y1="{y(plan):.1f}" y2="{y(plan):.1f}" class="sp" stroke-width="2" stroke-dasharray="12 4"/>'
    svg1 = f'<svg viewBox="0 0 {W} {H}" width="100%" role="img" aria-label="Витрати за 12 місяців проти плану {eur("3 000,00")}">{g}{bars}</svg>'
    leg1 = f'<div class="leg"><span><span class="key" style="background:var(--ca)"></span>Витрати</span><span><svg width="16" height="8" aria-hidden="true"><line x1="0" y1="4" x2="16" y2="4" class="sp" stroke-width="2" stroke-dasharray="6 4"/></svg>План · {eur("3 000,00")}</span></div>'
    # grouped income vs expense with negative
    data = [('Січ.', 5450, 3290), ('Лют.', 5380, 2810), ('Бер.', 5450, 3290), ('Квіт.', 5500, 4120)]
    W2, H2, L2, Z = 420, 220, 44, 150
    s = 120 / 6000
    bars2 = ''
    for i, (m, inc, exp) in enumerate(data):
        x = L2 + 10 + i * 92
        bars2 += f'<rect x="{x}" y="{Z-inc*s:.1f}" width="28" height="{inc*s:.1f}" rx="2" class="fa"/><rect x="{x+30}" y="{Z-exp*s:.1f}" width="28" height="{exp*s:.1f}" rx="2" class="fb"/><text x="{x+29}" y="{Z+40}" text-anchor="middle" class="ax">{m}</text>'
    neg = f'<rect x="{L2+10+3*92+62}" y="{Z}" width="20" height="{620*s:.1f}" rx="2" class="fd"/><text x="{L2+10+3*92+72}" y="{Z+620*s+12:.1f}" text-anchor="middle" class="vl">{MINUS}620</text>'
    svg2 = f'<svg viewBox="0 0 {W2} {H2}" width="100%" role="img" aria-label="Дохід і витрати за 4 місяці">{"".join(f"<line x1={L2} x2={W2} y1={Z-v*s:.1f} y2={Z-v*s:.1f} class=gl />" for v in (2000,4000,6000))}{bars2}{neg}<line x1="{L2}" x2="{W2}" y1="{Z}" y2="{Z}" class="zl"/></svg>'
    leg2 = '<div class="leg"><span><span class="key" style="background:var(--ca)"></span>Дохід</span><span><span class="key" style="background:var(--cb)"></span>Витрати</span><span><span class="key" style="background:var(--cplan)"></span>Різниця нижче нуля</span></div>'
    # horizontal ranking
    rk = [('Продукти', 612.4, 100), ('Кафе і ресторани', 284.9, 46.5), ('Таксі', 132.6, 21.7), ('Підписки', 64.0, 10.5)]
    rows = ''.join(f'<div style="display:flex;align-items:center;gap:12px;height:28px"><span class="t1" style="width:30%;font-weight:400">{n}</span><span style="flex:1;height:14px"><i style="display:block;height:14px;width:{p}%;border-radius:0 4px 4px 0;background:var(--ca)"></i></span><span class="amt" style="width:90px;text-align:right;font-size:13px">{eur(("%.2f" % v).replace(".", ","))}</span></div>' for n, v, p in rk)
    body = (f'<div class="stack">{card("Витрати", "Листопад 2025 — жовтень 2026 · стовпці і план", svg1 + leg1)}'
            f'<div class="grid2">{card("Дохід і витрати", "Січень — квітень 2026 · згруповані", svg2 + leg2)}{card("Найбільші категорії", "Жовтень 2026 · рядки", rows)}</div></div>')
    return ('Графіки', 900, 'Стовпці #2E69B2, план — штрих; згруповані, від’ємні, рядки', body, SVGCSS)
C['BarChart'] = _bars()

# ---------- DonutChart ----------
def donut(parts, r=70, w=18, size=180, center=('',''), rings=None):
    cx = cy = size / 2
    out = ''
    def ring(parts, r):
        nonlocal out
        a0 = -90
        circ = 2 * math.pi * r
        for p, cls in parts:
            dash = circ * p / 100 - 2
            out += f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke-width="{w}" style="stroke:{cls}" stroke-dasharray="{max(dash,0):.2f} {circ:.2f}" transform="rotate({a0:.2f} {cx} {cy})"/>'
            a0 += 360 * p / 100
    if rings:
        rr = r
        for pr in rings:
            ring(pr, rr); rr -= w + 6
    else:
        ring(parts, r)
    t = f'<text x="{cx}" y="{cy-2}" text-anchor="middle" style="font:600 15px Inter,sans-serif;fill:var(--ink);font-variant-numeric:tabular-nums">{center[0]}</text><text x="{cx}" y="{cy+16}" text-anchor="middle" class="ax">{center[1]}</text>'
    return f'<svg width="{size}" height="{size}" viewBox="0 0 {size} {size}" role="img" aria-label="Кільцева діаграма">{out}{t}</svg>'

def _donut():
    P = [(58, 'var(--ca)'), (18, 'var(--cb)'), (12, 'var(--cplan)'), (7, 'var(--cc)'), (5, 'url(#h)')]
    names = ['Нерухомість', 'Інвестиції', 'Гроші', 'Транспорт', 'Інші · 3']
    leg = ''.join(f'<div style="display:flex;align-items:center;gap:10px;height:32px;border-bottom:1px solid var(--surface-300)"><span class="key {"hatch" if "url" in c else ""}" style="{"" if "url" in c else "background:"+c}"></span><span style="flex:1">{n}</span><span class="tab muted">{p} %</span></div>' for (p, c), n in zip(P, names))
    svg = donut(P, center=('468' + NB + 'тис.' + NB + '€', 'активи разом')).replace('<svg ', '<svg style="overflow:visible" ').replace('role="img"', 'role="img"', 1)
    svg = svg.replace('<circle', HATCH.replace('<defs>', '<defs>') + '<circle', 1) if False else svg
    svg = svg.replace('aria-label="Кільцева діаграма">', 'aria-label="Кільцева діаграма">' + HATCH)
    a = f'<div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap">{svg}<div style="flex:1;min-width:200px">{leg}</div></div>'
    rings = donut(None, r=78, w=14, size=180, center=('', ''), rings=[[(58, 'var(--ca)'), (18, 'var(--cb)'), (24, 'var(--cplan)')], [(45, 'var(--ca)'), (30, 'var(--cb)'), (25, 'var(--cplan)')]])
    leg2 = '<table style="border-collapse:collapse;font-size:13px;width:100%"><tr class="muted"><td></td><td style="text-align:right;padding:4px 8px">Зараз</td><td style="text-align:right;padding:4px 0">Ціль</td></tr>' + ''.join(f'<tr style="border-top:1px solid var(--surface-300)"><td style="padding:6px 0"><span style="display:inline-flex;align-items:center;gap:8px"><span class="key" style="background:{c}"></span>{n}</span></td><td class="tab" style="text-align:right;padding:6px 8px">{a} %</td><td class="tab" style="text-align:right">{b} %</td></tr>' for n, c, a, b in [('Акції', 'var(--ca)', 58, 45), ('Облігації', 'var(--cb)', 18, 30), ('Гроші', 'var(--cplan)', 24, 25)]) + '</table><span class="sub">Зовнішнє кільце — зараз, внутрішнє — ціль.</span>'
    b = f'<div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap">{rings}<div style="flex:1;min-width:200px">{leg2}</div></div>'
    body = '<div class="grid2">' + card('Розподіл активів', 'Одне кільце, сума в центрі', a) + card('Портфель: зараз і ціль', 'Два кільця', b) + '</div>'
    return ('Графіки', 380, 'Кільце з сумою в центрі; два кільця «зараз і ціль»', body, SVGCSS)
C['DonutChart'] = _donut()

# ---------- LineChart ----------
def _line():
    W, H, L, T, B = 640, 240, 56, 12, 206
    v1 = [24.1, 25.0, 24.6, 26.2, 27.0, 26.4, 28.1, 29.0, 28.6, 30.2, 31.5, 32.86]
    v2 = [26.0] * 12
    mn, mx = 20, 35
    x = lambda i: L + i * (W - L - 12) / 11
    y = lambda v: B - (B - T) * (v - mn) / (mx - mn)
    grid = ''.join(f'<line x1="{L}" x2="{W}" y1="{y(v):.1f}" y2="{y(v):.1f}" class="gl"/><text x="{L-8}" y="{y(v)+4:.1f}" text-anchor="end" class="ax">{v}{NB}тис.</text>' for v in (20, 25, 30, 35))
    lab = ''.join(f'<text x="{x(i):.1f}" y="{B+18}" text-anchor="middle" class="ax">{MONTHS[i]}</text>' for i in range(0, 12, 2))
    area = 'M' + ' L'.join(f'{x(i):.1f},{y(v):.1f}' for i, v in enumerate(v1)) + f' L{x(11):.1f},{B} L{x(0):.1f},{B} Z'
    l1 = ' '.join(f'{x(i):.1f},{y(v):.1f}' for i, v in enumerate(v1))
    l2 = ' '.join(f'{x(i):.1f},{y(v):.1f}' for i, v in enumerate([25.5, 25.6, 25.9, 26.1, 26.0, 26.4, 26.8, 27.0, 27.4, 27.9, 28.3, 28.7]))
    hx = x(8)
    svg = (f'<svg viewBox="0 0 {W} {H}" width="100%" role="img" aria-label="Гроші разом за 12 місяців: від {eur("24 100,00")} до {eur("32 860,00")}">{grid}{lab}'
           f'<path d="{area}" style="fill:var(--ca);opacity:.14"/><polyline points="{l2}" fill="none" class="sp" stroke-width="2" stroke-dasharray="7 5"/><polyline points="{l1}" fill="none" class="sa" stroke-width="2.4"/>'
           f'<circle cx="{x(11):.1f}" cy="{y(v1[11]):.1f}" r="5" class="fa" style="stroke:var(--surface-200)" stroke-width="2"/><rect x="{x(11)-5:.1f}" y="{y(28.7)-5:.1f}" width="10" height="10" rx="2" class="fd" style="stroke:var(--surface-200)" stroke-width="2"/>'
           f'<line x1="{hx:.1f}" x2="{hx:.1f}" y1="{T}" y2="{B}" class="sm" stroke-dasharray="2 3"/></svg>')
    tip = f'<div class="tp" style="position:absolute;right:8px;top:128px;width:230px"><div style="font-weight:600;font-size:13px;padding-bottom:6px">на 1 лип. 2026 · Δ м/м</div><div class="tl"><span class="key" style="background:var(--ca)"></span><span class="muted" style="flex:1">Гроші разом</span><b class="tab">{eur("28 600,00")}</b></div><div class="tl"><span class="key" style="background:var(--cplan)"></span><span class="muted" style="flex:1">Мінімальний залишок</span><b class="tab">{eur("27 400,00")}</b></div></div>'
    leg = f'<div class="leg"><span><svg width="18" height="8" aria-hidden="true"><line x1="0" x2="18" y1="4" y2="4" class="sa" stroke-width="2.4"/></svg>Гроші разом · <b class="amt">{eur("32 860,00")}</b></span><span><svg width="18" height="8" aria-hidden="true"><line x1="0" x2="18" y1="4" y2="4" class="sp" stroke-width="2" stroke-dasharray="7 5"/></svg>Мінімальний залишок · <b class="amt">{eur("28 700,00")}</b></span></div>'
    one = card('Баланс рахунку', 'PoC: одна серія, вигляд не перемикається', f'<span class="big" style="font-size:24px;line-height:32px">{eur("11 400,00")}</span><span class="up tab" style="font-size:13px">▲ {eur("1 260,00")} · 12,4 % за 3 міс.</span><svg viewBox="0 0 300 90" width="100%" aria-hidden="true"><polyline points="0,70 40,66 80,60 120,62 160,44 200,40 240,30 300,18" fill="none" class="sa" stroke-width="2.4"/><circle cx="300" cy="18" r="4" class="fa"/></svg>')
    empty = card('Баланс рахунку', 'Немає історії', '<div style="height:90px;display:grid;place-items:center;text-align:center"><span><b style="font-weight:600">Ще немає історії</b><br><span class="muted" style="font-size:13px">Графік з’явиться після першого місяця.</span></span></div>')
    body = (f'<div class="stack">{card("Гроші разом", "12 місяців · лінія з площею, друга серія — штрих, підказка на кроці", f"<div style=position:relative>{svg}{tip}</div>" + leg)}'
            f'<div class="grid2">{one}{empty}</div></div>')
    css = SVGCSS + '.tp{padding:10px 12px;background:var(--surface-200);border:1px solid var(--line);border-radius:8px;box-shadow:var(--elev);font-size:12px;line-height:16px}.tl{display:flex;align-items:center;gap:8px;height:22px}.tl b{font-weight:600;white-space:nowrap}'
    return ('Графіки', 760, 'Лінія #2E69B2, площа 14 %, друга серія — штрих', body, css)
C['LineChart'] = _line()

def spark(pts, w=120, h=32, cls='sa'):
    mn, mx = min(pts), max(pts)
    xs = [i * (w - 4) / (len(pts) - 1) + 2 for i in range(len(pts))]
    ys = [h - 3 - (h - 6) * (p - mn) / ((mx - mn) or 1) for p in pts]
    pl = ' '.join(f'{a:.1f},{b:.1f}' for a, b in zip(xs, ys))
    return f'<svg width="100%" height="{h}" viewBox="0 0 {w} {h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="{pl}" fill="none" class="{cls}" stroke-width="1.8" vector-effect="non-scaling-stroke"/><circle cx="{xs[-1]:.1f}" cy="{ys[-1]:.1f}" r="2.5" class="{cls.replace("s","f",1)}"/></svg>'

C['Sparkline'] = ('Графіки', 260, 'Тренд без осей; число поруч', f'''<section class="card" style="overflow:hidden;max-width:640px">
<div class="tr"><span style="flex:1" class="t1">Заощадження</span><span style="width:140px">{spark([3,4,4,5,6,6,7,8])}</span><span class="amt" style="width:120px;text-align:right">{eur("9 000,00")}</span></div>
<div class="tr"><span style="flex:1" class="t1">Витрати на продукти</span><span style="width:140px">{spark([6,5,7,6,8,7,9,8],cls="sb")}</span><span class="amt" style="width:120px;text-align:right">{eur("612,40")}</span></div>
<div class="tr"><span style="flex:1" class="t1">Кредитна ··9021</span><span style="width:140px"><span class="sk" style="height:32px;width:100%"></span></span><span class="sk" style="width:80px;height:12px;margin-left:40px"></span></div>
<div class="tr"><span style="flex:1" class="t1">Новий рахунок</span><span style="width:140px;text-align:center" class="muted">–</span><span class="amt" style="width:120px;text-align:right">{eur("0,00")}</span></div>
</section>''', SVGCSS)

def _heat():
    import random
    random.seed(4)
    days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд']
    cols = ['var(--surface-300)', 'color-mix(in srgb,var(--brand-2) 25%,var(--surface-200))', 'color-mix(in srgb,var(--brand-2) 50%,var(--surface-200))', 'color-mix(in srgb,var(--brand-2) 75%,var(--surface-200))', 'var(--brand-2)']
    rows = ''
    for d in range(7):
        cells = ''.join(f'<span class="hc" style="background:{cols[min(4, max(0, int(random.gauss(2 if d < 5 else 3, 1.1))))]}"></span>' for _ in range(16))
        rows += f'<div class="hr2"><span class="sub" style="width:24px">{days[d]}</span>{cells}</div>'
    weeks = '<div class="hr2"><span style="width:24px"></span>' + ''.join(f'<span class="sub" style="width:18px;text-align:center">{w if w % 4 == 1 else ""}</span>' for w in range(1, 17)) + '</div>'
    scale = '<div style="display:flex;align-items:center;gap:4px;font-size:12px" class="muted">Менше' + ''.join(f'<span style="width:14px;height:14px;border-radius:3px;background:{c}"></span>' for c in cols) + 'Більше</div>'
    body = card('Витрати за днями', 'Липень — жовтень 2026 · тижні', f'<div style="display:flex;flex-direction:column;gap:3px">{rows}{weeks}</div>{scale}')
    return ('Графіки', 360, 'П’ять рівнів одного відтінку (v1)', f'<div style="max-width:520px">{body}</div>', '.hr2{display:flex;align-items:center;gap:3px}.hc{width:18px;height:18px;border-radius:3px}')
C['Heatmap'] = _heat()

def _inv():
    W, H, L, T, B = 640, 220, 56, 12, 180
    val = [10, 10.4, 10.2, 12.8, 13.1, 12.6, 13.9, 14.5, 16.9, 17.2, 16.8, 18.1]
    inv = [10, 10, 10, 12, 12, 12, 12, 12, 14, 14, 14, 14]
    x = lambda i: L + i * (W - L - 12) / 11
    y = lambda v: B - (B - T) * (v - 8) / 12
    grid = ''.join(f'<line x1="{L}" x2="{W}" y1="{y(v):.1f}" y2="{y(v):.1f}" class="gl"/><text x="{L-8}" y="{y(v)+4:.1f}" text-anchor="end" class="ax">{v}{NB}тис.</text>' for v in (8, 12, 16, 20))
    pv = ' '.join(f'{x(i):.1f},{y(v):.1f}' for i, v in enumerate(val))
    pi = ' '.join(f'{x(i):.1f},{y(v):.1f}' for i, v in enumerate(inv))
    gap = 'M' + ' L'.join(f'{x(i):.1f},{y(v):.1f}' for i, v in enumerate(val)) + ' L' + ' L'.join(f'{x(i):.1f},{y(v):.1f}' for i, v in reversed(list(enumerate(inv)))) + ' Z'
    marks = ''.join(f'<path d="M{x(i):.1f} {y(inv[i])-14:.1f} l4.5 7 h-9 Z" class="fd"/>' for i in (3, 8))
    flows = ''.join(f'<rect x="{x(i)-5:.1f}" y="{B+14}" width="10" height="14" rx="2" class="fa"/>' for i in (3, 8)) + f'<rect x="{x(10)-5:.1f}" y="{B+28}" width="10" height="8" rx="2" class="fb"/>'
    svg = f'<svg viewBox="0 0 {W} {H+30}" width="100%" role="img" aria-label="Вартість інвестиції і внесене за 12 місяців">{grid}<path d="{gap}" style="fill:var(--ca);opacity:.14"/><polyline points="{pi}" fill="none" class="sm" stroke-width="2" stroke-dasharray="6 4"/><polyline points="{pv}" fill="none" class="sa" stroke-width="2.4"/>{marks}<line x1="{L}" x2="{W}" y1="{B+28}" y2="{B+28}" class="gl"/>{flows}</svg>'
    top = f'<div class="row" style="gap:32px"><span style="display:flex;flex-direction:column"><span class="lbl" style="font-size:12px">Вартість зараз</span><b class="amt" style="font:600 22px/28px \'Inter Tight\',Inter,sans-serif">{eur("18 100,00")}</b></span><span style="display:flex;flex-direction:column"><span class="lbl" style="font-size:12px">Внесено</span><b class="amt" style="font:600 22px/28px \'Inter Tight\',Inter,sans-serif">{eur("14 000,00")}</b></span><span style="display:flex;flex-direction:column"><span class="lbl" style="font-size:12px">Прибуток</span><b class="up tab" style="font:600 22px/28px \'Inter Tight\',Inter,sans-serif">▲ {eur("4 100,00")} · 29,3 %</b></span></div>'
    leg = '<div class="leg"><span><svg width="18" height="8" aria-hidden="true"><line x1="0" x2="18" y1="4" y2="4" class="sa" stroke-width="2.4"/></svg>Вартість</span><span><svg width="18" height="8" aria-hidden="true"><line x1="0" x2="18" y1="4" y2="4" class="sm" stroke-width="2" stroke-dasharray="6 4"/></svg>Внесено</span><span><span class="key" style="background:var(--ca)"></span>▲ Внесок</span><span><span class="key" style="background:var(--cb)"></span>▼ Виведення</span></div>'
    return ('Графіки', 520, 'Вартість, внесене, внески і виведення (MVP)', card('Брокерський ··0072', 'Interactive Brokers · листопад 2025 — жовтень 2026', top + svg + leg), SVGCSS)
C['InvestmentChart'] = _inv()

def ringp(pct, label, color, size=96):
    r = size / 2 - 7
    c = 2 * math.pi * r
    arc = f'<circle cx="{size/2}" cy="{size/2}" r="{r}" fill="none" stroke-width="8" stroke-linecap="round" style="stroke:{color}" stroke-dasharray="{c*min(pct,100)/100:.1f} {c:.1f}" transform="rotate(-90 {size/2} {size/2})"/>' if pct > 0 else ''
    txt = 'Готово' if pct >= 100 else f'{pct}{NB}%'
    fs = 16 if pct >= 100 else 22
    return (f'<div style="display:flex;flex-direction:column;align-items:center;gap:8px;width:120px"><svg width="{size}" height="{size}" viewBox="0 0 {size} {size}" role="img" aria-label="{label}: {txt}"><circle cx="{size/2}" cy="{size/2}" r="{r}" fill="none" stroke-width="8" class="tk"/>{arc}'
            f'<text x="{size/2}" y="{size/2+7}" text-anchor="middle" style="font:600 {fs}px \'Inter Tight\',Inter,sans-serif;fill:var(--ink);font-variant-numeric:tabular-nums">{txt}</text></svg><span class="t1" style="font-weight:500;max-width:120px">{label}</span></div>')

C['RingProgress'] = ('Графіки', 220, 'Кільце цілі кольором шкали прогресу', f'''<div class="row" style="gap:16px">{ringp(0,"Новий ноутбук","var(--goal-0)")}{ringp(29,"Ремонт кухні","var(--goal-25)")}{ringp(53,"Відпустка в Італії","var(--goal-55)")}{ringp(71,"Подушка безпеки","var(--goal-80)")}{ringp(100,"Машина","var(--goal-100)")}
<div style="display:flex;flex-direction:column;align-items:center;gap:8px;width:120px"><span class="sk" style="width:96px;height:96px;border-radius:999px"></span><span class="sk" style="width:80px;height:12px"></span></div></div>''', '.tk{stroke:var(--surface-300)}')

C['SmallMultiples'] = ('Графіки', 300, 'Багато показників, міні-графік у кожному', '<div class="sm-g">' + ''.join(
    f'<div class="smc"><span style="font:500 13px/18px Inter,sans-serif" class="muted">{n}</span><b class="amt" style="font:600 18px/24px \'Inter Tight\',Inter,sans-serif">{v}</b><span class="{d[0]} tab" style="font-size:13px">{d[1]}</span>{spark(p, cls=s)}</div>'
    for n, v, d, p, s in [
        ('Продукти', eur('612,40'), ('dn', '▲ 8,2 % м/м'), [5,6,5,7,6,8], 'sa'),
        ('Кафе і ресторани', eur('284,90'), ('up', '▼ 12,0 % м/м'), [8,7,7,6,5,5], 'sa'),
        ('Таксі', eur('132,60'), ('dn', '▲ 3,1 % м/м'), [3,4,3,4,4,5], 'sa'),
        ('Підписки', eur('64,00'), ('', '— м/м'), [4,4,4,4,4,4], 'sa'),
        ('Комунальні', eur('188,20'), ('up', '▼ 5,4 % м/м'), [6,7,8,7,6,5], 'sa'),
        ('Пальне', eur('146,00'), ('dn', '▲ 9,9 % м/м'), [4,3,5,4,6,6], 'sa'),
    ]) + '</div>', SVGCSS + '.sm-g{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}.smc{display:flex;flex-direction:column;gap:4px;padding:12px 16px;border:1px solid var(--line);border-radius:8px;background:var(--surface-200)}')

def _tree():
    cells = [('Квартира на Подолі', 46, 'var(--ca)', 'Нерухомість'), ('Дача, Козин', 12, 'var(--ca)', 'Нерухомість'), ('ETF-портфель', 18, 'var(--cplan)', 'Інвестиції'), ('Поточний ··4417', 10, 'var(--cc)', 'Гроші'), ('Гривневий', 4, 'var(--cc)', 'Гроші'), ('Toyota RAV4', 5, 'var(--cb)', 'Транспорт'), ('Інші · 3', 5, 'hatch', 'Інші')]
    def cell(n, p, c, w, h):
        bg = 'class="tm hatch"' if c == 'hatch' else f'class="tm" style="background:{c};'
        st = f'width:{w};height:{h}' + ('"' if c != 'hatch' else '')
        style = (f'class="tm hatch" style="{st}"') if c == 'hatch' else f'class="tm" style="background:{c};{st}"'
        txt = '' if p < 6 else f'<b>{n}</b><span>{str(p)} %</span>'
        if c == 'var(--cc)': style = style.replace('class="tm"', 'class="tm dk"')
        return f'<div {style} title="{n} · {p} %" tabindex="0">{txt}</div>'
    tm = ('<div style="display:flex;height:260px;gap:1px;background:var(--surface-200)">'
          f'<div style="display:flex;flex-direction:column;gap:1px;width:58%">{cell(*cells[0][:3],"100%","79%")}{cell(*cells[1][:3],"100%","21%")}</div>'
          f'<div style="display:flex;flex-direction:column;gap:1px;flex:1">{cell(*cells[2][:3],"100%","43%")}<div style="display:flex;gap:1px;height:29%">{cell(*cells[3][:3],"67%","100%")}{cell(*cells[4][:3],"33%","100%")}</div><div style="display:flex;gap:1px;flex:1">{cell(*cells[5][:3],"58%","100%")}{cell(*cells[6][:3],"42%","100%")}</div></div></div>')
    leg = '<div class="leg"><span><span class="key" style="background:var(--ca)"></span>Нерухомість <span class="muted tab">58 %</span></span><span><span class="key" style="background:var(--cplan)"></span>Інвестиції <span class="muted tab">18 %</span></span><span><span class="key" style="background:var(--cc)"></span>Гроші <span class="muted tab">14 %</span></span><span><span class="key" style="background:var(--cb)"></span>Транспорт <span class="muted tab">5 %</span></span><span><span class="key hatch"></span>Інші · 3 <span class="muted tab">5 %</span></span></div>'
    css = '.tm{display:flex;flex-direction:column;justify-content:flex-end;padding:8px 10px;color:#FFFFFF;font-size:12px;line-height:16px;overflow:hidden}.tm b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tm span{font-variant-numeric:tabular-nums;opacity:.9}[data-theme="dark"] .tm,.tm.dk{color:#0B2545}'
    return ('Графіки', 440, 'Площа пропорційна значенню; найбільші першими', card('Склад активів', f'{eur("468 000,00")} · 9 позицій', tm + leg), css)
C['Treemap'] = _tree()

def _wf():
    steps = [('Початок', 30400, 'tot'), ('Дохід', 5450, 'up'), ('Витрати', -3289, 'dn'), ('Внески в цілі', -600, 'dn'), ('Переоцінка', 900, 'up'), ('Кінець', 32861, 'tot')]
    W, H, L, B, T = 620, 240, 56, 200, 12
    mx = 40000
    y = lambda v: B - (B - T) * v / mx
    run = 0; bars = ''; bw = (W - L) / len(steps)
    for i, (n, v, k) in enumerate(steps):
        x = L + i * bw + bw * .18; w = bw * .64
        if k == 'tot':
            top, bot = v, 0; run = v; cls = 'class="fn"'
            lab = f'{v/1000:.1f}'.replace('.', ',') + NB + 'тис.'
        else:
            top, bot = (run + v, run) if v > 0 else (run, run + v); run += v
            cls = 'class="fg"' if v > 0 else 'fill="url(#hl)" style="stroke:var(--loss)" stroke-width="1.5"'
            lab = ('+' if v > 0 else MINUS) + f'{abs(v):,}'.replace(',', NB) + NB + '€'
        bars += f'<rect x="{x:.1f}" y="{y(top):.1f}" width="{w:.1f}" height="{y(bot)-y(top):.1f}" rx="2" {cls}/><text x="{x+w/2:.1f}" y="{y(top)-6:.1f}" text-anchor="middle" class="vl">{lab}</text><text x="{x+w/2:.1f}" y="{B+18}" text-anchor="middle" class="ax">{n}</text>'
    grid = ''.join(f'<line x1="{L}" x2="{W}" y1="{y(v):.1f}" y2="{y(v):.1f}" class="gl"/><text x="{L-8}" y="{y(v)+4:.1f}" text-anchor="end" class="ax">{v//1000}{NB}тис.</text>' for v in (10000, 20000, 30000, 40000))
    svg = f'<svg viewBox="0 0 {W} {H}" width="100%" role="img" aria-label="Зміна грошей разом за жовтень">{HATCH}{grid}{bars}<line x1="{L}" x2="{W}" y1="{B}" y2="{B}" class="zl"/></svg>'
    leg = '<div class="leg"><span><span class="key" style="background:var(--gain)"></span>Збільшення</span><span><span class="key" style="background:repeating-linear-gradient(45deg,var(--loss) 0 3px,var(--surface-200) 3px 6px);outline:1.5px solid var(--loss);outline-offset:-1.5px"></span>Зменшення</span><span><span class="key" style="background:var(--brand)"></span>Підсумок</span></div>'
    return ('Графіки', 420, 'Початок, збільшення, зменшення, кінець', card('Грошовий потік', 'Жовтень 2026 · у EUR', svg + leg), SVGCSS)
C['Waterfall'] = _wf()
