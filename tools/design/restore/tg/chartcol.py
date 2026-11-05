# C10 chart colours + G1 goal bar — shared helpers of the chart-colour agent (exec after CI is defined)
# Validated with the dataviz validator (light, surface #FFFFFF and #FAFAF8):
#   lightness band, chroma floor, adjacent CVD worst 9.3 (deutan), normal-vision worst 17.8, all 8 >= 3:1 on white;
#   first 3 slots also pass --pairs all (CVD 11.5, normal 18.3).
CC_PAL=['#5872D2','#0E9161','#9C7305','#097FCD','#C35047','#9B5BB6','#0F899B','#678800']  # chart-cat-1 … chart-cat-8 (DS-06)
CC_PAL_NAMES=['Синьо-фіолетовий','Зелений','Охристий','Блакитний','Червоний','Фіолетовий','Бірюзовий','Оливково-зелений']
CC_GROUPS=['Житло','Харчування','Транспорт і авто','Зв’язок і підписки','Здоров’я і догляд','Родина','Відпочинок','Фінанси і податки']
CC_INCOME=[('chart-group-income-1','#BA4E84','Малиновий','Дохід від роботи'),('chart-group-income-2','#BE590F','Помаранчевий','Інші доходи')]
CC_TRANSFER='#9DB2C8'
CC_OTHER='#9AA3AF'          # «Інші · N» — always last, never a palette slot
CC_REF='rgba(27, 34, 48, 0.6)'  # chart-reference: ink 60 % (DS-06)
CC_REF_DASH='4 4'            # plan / goal target: short dash; budget: '12 4'
CC_TOTAL='#0B2545'           # waterfall totals — brand (DS-07 п. 10)
# category colour map (system categories, BUD-01 п. 1) — chip colour == chart colour
CATCOL={"Оренда": "#144097", "Комунальні": "#494BAB", "Дім": "#3968C2", "Ремонт": "#6D74D8", "Побутова хімія": "#5F92EF", "Сад": "#959FFE", "Страхування житла": "#9BBEFD", "Продукти": "#045D2F", "Кафе і ресторани": "#099673", "Доставка їжі": "#73CF90", "Пальне": "#614004", "Транспорт": "#796000", "Сервіс авто": "#A9751A", "Страхування авто": "#B99B3C", "Паркування і дороги": "#EAB361", "Зв’язок": "#02537A", "Інтернет": "#3A81D7", "Підписки": "#62C2FF", "Здоров’я": "#861025", "Аптека": "#A73A1E", "Спорт": "#CA545B", "Краса і догляд": "#EC785B", "Страхування здоров’я": "#FE9FA0", "Діти": "#5D2985", "Освіта": "#843A8D", "Одяг": "#8C59B8", "Подарунки": "#B76AC0", "Домашні тварини": "#BD89ED", "Благодійність": "#EB9BF5", "Подорожі": "#05585E", "Розваги": "#268EA8", "Хобі": "#60CAD3", "Відсотки за кредитами": "#454D04", "Податки": "#3E6C03", "Комісії банку": "#707D0B", "Страхування життя": "#689E38", "Штрафи": "#9FB034", "Інші витрати": "#98D16C", "Зарплата": "#7A165C", "Премії": "#AE3E6A", "Підприємництво": "#D26AAB", "Фриланс": "#FE9BBB", "Дивіденди і відсотки": "#7B2901", "Дохід від оренди": "#874706", "Кешбек": "#B14718", "Соціальні виплати": "#BE660B", "Подарунки отримані": "#DF7045", "Продаж майна": "#EE8D3C", "Інші надходження": "#FEA382", "Переказ": "#9DB2C8", "Коригування": "#9AA3AF"}  # v155 — BUD-01@PoC (tone of group + shade)
CATGROUPS=[('Житло', ['Оренда', 'Комунальні', 'Дім', 'Ремонт', 'Побутова хімія', 'Сад', 'Страхування житла']), ('Харчування', ['Продукти', 'Кафе і ресторани', 'Доставка їжі']), ('Транспорт і авто', ['Пальне', 'Транспорт', 'Сервіс авто', 'Страхування авто', 'Паркування і дороги']), ('Зв’язок і підписки', ['Зв’язок', 'Інтернет', 'Підписки']), ('Здоров’я і догляд', ['Здоров’я', 'Аптека', 'Спорт', 'Краса і догляд', 'Страхування здоров’я']), ('Родина', ['Діти', 'Освіта', 'Одяг', 'Подарунки', 'Домашні тварини', 'Благодійність']), ('Відпочинок', ['Подорожі', 'Розваги', 'Хобі']), ('Фінанси і податки', ['Відсотки за кредитами', 'Податки', 'Комісії банку', 'Страхування життя', 'Штрафи', 'Інші витрати']), ('Дохід від роботи', ['Зарплата', 'Премії', 'Підприємництво', 'Фриланс']), ('Інші доходи', ['Дивіденди і відсотки', 'Дохід від оренди', 'Кешбек', 'Соціальні виплати', 'Подарунки отримані', 'Продаж майна', 'Інші надходження']), ('Службові', ['Переказ', 'Коригування'])]
def cc_apply():
    for n,v in list(CI.items()):
        if n in CATCOL: CI[n]=(CATCOL[n],v[1])
def cc_cat(n):
    return CATCOL.get(n) or (CI[n][0] if n in CI else CC_OTHER)
# ---- G1 goal progress bar (owner «Є»): point of a yellow→green OKLCH gradient at the fill %
import math as _m
def _lin(c): c=c/255; return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
def _hex2lab(h):
    r,g,b=[_lin(int(h[i:i+2],16)) for i in (1,3,5)]
    l=(0.4122214708*r+0.5363325363*g+0.0514459929*b)**(1/3); m=(0.2119034982*r+0.6806995451*g+0.1073969566*b)**(1/3); s=(0.0883024619*r+0.2817188376*g+0.6299787005*b)**(1/3)
    return (0.2104542553*l+0.7936177850*m-0.0040720468*s, 1.9779984951*l-2.4285922050*m+0.4505937099*s, 0.0259040371*l+0.7827717662*m-0.8086757660*s)
def _lab2hex(L,a,b):
    l=(L+0.3963377774*a+0.2158037573*b)**3; m=(L-0.1055613458*a-0.0638541728*b)**3; s=(L-0.0894841775*a-1.2914855480*b)**3
    rgb=(4.0767416621*l-3.3077115913*m+0.2309699292*s, -1.2684380046*l+2.6097574011*m-0.3413193965*s, -0.0041960863*l-0.7034186147*m+1.7076147010*s)
    f=lambda x: 12.92*x if x<=0.0031308 else 1.055*max(x,0)**(1/2.4)-0.055
    return '#'+''.join(f'{round(max(0,min(1,f(x)))*255):02X}' for x in rgb)
def _lab2lch(L,a,b): return (L,_m.hypot(a,b),_m.degrees(_m.atan2(b,a))%360)
G1_STOPS=[(0,'#FFD000'),(25,'#E6CF1A'),(55,'#9ACD32'),(80,'#4CAF50'),(100,'#2E7D32')]
G1_DONE='#2E7D32'; G1_PAUSED='#C5CAD1'; G1_BEHIND_INK='#7A4505'; G1_TICK='#1B2230'
def g1_col(p):
    p=max(0,min(100,float(p)))
    for (p0,c0),(p1,c1) in zip(G1_STOPS,G1_STOPS[1:]):
        if p<=p1:
            t=(p-p0)/(p1-p0) if p1>p0 else 0
            L0,C0,h0=_lab2lch(*_hex2lab(c0)); L1,C1,h1=_lab2lch(*_hex2lab(c1))
            dh=((h1-h0+180)%360)-180; L=L0+(L1-L0)*t; C=C0+(C1-C0)*t; h=_m.radians(h0+dh*t)
            return _lab2hex(L,C*_m.cos(h),C*_m.sin(h))
    return G1_DONE
def gbar(p,state='run',h=8,bg='#F1F1EF',tick=None):
    """state: run | behind | paused | done; tick = % where the bar should be today («Відстає»)"""
    p=float(p); col={'paused':G1_PAUSED,'done':G1_DONE}.get(state) or g1_col(p)
    w=100 if state=='done' else max(0,min(100,p))
    tk=f'<span title="мало б бути на сьогодні" style="position: absolute; left: {tick}%; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; border-radius: 1px; background: {G1_TICK};"></span>' if (tick is not None and state=='behind') else ''
    return f'<div role="progressbar" aria-valuenow="{p:g}" aria-valuemin="0" aria-valuemax="100" style="position: relative; flex: 1; height: {h}px; border-radius: 999px; background: {bg};"><div style="width: {w}%; height: {h}px; border-radius: 999px; background: {col};"></div>{tk}</div>'
def gword(state,amount=''):
    if state=='done': return f'<span style="color: {G1_DONE}; font: 500 12px/16px Inter, sans-serif; white-space: nowrap;">✓{N}Досягнуто{(" · + "+amount+" понад ціль") if amount else ""}</span>'
    if state=='behind': return f'<span style="color: {G1_BEHIND_INK}; font: 500 12px/16px Inter, sans-serif; white-space: nowrap;">!{N}Відстає{(" · "+amount) if amount else ""}</span>'
    if state=='paused': return f'<span style="color: #566174; font: 500 12px/16px Inter, sans-serif; white-space: nowrap;">❚❚{N}На паузі</span>'
    return ''
