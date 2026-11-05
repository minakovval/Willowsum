# C10 chart colours + G1 goal bar — shared helpers of the chart-colour agent (exec after CI is defined)
# Validated with the dataviz validator (light, surface #FFFFFF and #FAFAF8):
#   lightness band, chroma floor, adjacent CVD worst 9.3 (deutan), normal-vision worst 17.8, all 8 >= 3:1 on white;
#   first 3 slots also pass --pairs all (CVD 11.5, normal 18.3).
CC_PAL=['#2E69B2','#C46016','#089678','#B68B16','#B24981','#4D8C3E','#6A55B8','#C43F3E']
CC_PAL_NAMES=['Синій','Помаранчевий','Бірюзовий','Гірчичний','Малиновий','Зелений','Фіолетовий','Червоний']
CC_OTHER='#9AA3AF'          # «Інші · N» — always last, never a palette slot
CC_REF='#3A4350'            # plan / budget / target reference lines — neutral dark, dashed
CC_REF_DASH='6 4'
CC_TOTAL='#3A4350'          # total bars (waterfall start) — same neutral dark
# category colour map (system categories, BUD-01 п. 1) — chip colour == chart colour
CATCOL={'Оренда': '#0E6A9B', 'Комунальні': '#1C9B84', 'Ремонт': '#813C0F', 'Дім': '#BF7101', 'Побутова хімія': '#842373', 'Сад': '#3A7411', 'Страхування житла': '#9353B7',
 'Продукти': '#569B2B', 'Кафе і ресторани': '#954D05', 'Доставка їжі': '#C04254',
 'Транспорт': '#224AA9', 'Пальне': '#8F700F', 'Сервіс авто': '#0EA053', 'Страхування авто': '#197CB3', 'Паркування і дороги': '#9C69D3',
 'Зв’язок': '#05773B', 'Інтернет': '#0B67A9', 'Підписки': '#772A88',
 'Здоров’я': '#971D08', 'Аптека': '#199A8D', 'Страхування здоров’я': '#1161BB', 'Спорт': '#777B0D', 'Краса і догляд': '#842373',
 'Освіта': '#5381E6', 'Діти': '#8E1B5C', 'Одяг': '#BF5BAA', 'Домашні тварини': '#C86906', 'Подарунки': '#C04254', 'Благодійність': '#199D78',
 'Розваги': '#9C69D3', 'Подорожі': '#1D94B7', 'Хобі': '#A48118',
 'Податки': '#92194F', 'Комісії банку': '#875806', 'Відсотки за кредитами': '#624EB7', 'Страхування життя': '#03999F', 'Штрафи': '#D35D31', 'Інші витрати': '#8C8577',
 'Зарплата': '#5381E6', 'Премії': '#05773B', 'Підприємництво': '#7D4005', 'Фриланс': '#772A88',
 'Дохід від оренди': '#4640A7', 'Дивіденди і відсотки': '#019F68', 'Кешбек': '#7D4005', 'Подарунки отримані': '#C6599E', 'Соціальні виплати': '#0278C7', 'Продаж майна': '#8F700F', 'Інші надходження': '#8C8577',
 'Переказ': '#9DB2C8', 'Коригування': '#9AA3AF'}
CATGROUPS=[('Житло',['Оренда','Комунальні','Ремонт','Дім','Побутова хімія','Сад','Страхування житла']),('Харчування',['Продукти','Кафе і ресторани','Доставка їжі']),
 ('Транспорт і авто',['Транспорт','Пальне','Сервіс авто','Страхування авто','Паркування і дороги']),('Зв’язок і підписки',['Зв’язок','Інтернет','Підписки']),
 ('Здоров’я і догляд',['Здоров’я','Аптека','Страхування здоров’я','Спорт','Краса і догляд']),('Родина',['Освіта','Діти','Одяг','Домашні тварини','Подарунки','Благодійність']),
 ('Відпочинок',['Розваги','Подорожі','Хобі']),('Фінанси і податки',['Податки','Комісії банку','Відсотки за кредитами','Страхування життя','Штрафи','Інші витрати']),
 ('Дохід від роботи',['Зарплата','Премії','Підприємництво','Фриланс']),('Інші доходи',['Дохід від оренди','Дивіденди і відсотки','Кешбек','Подарунки отримані','Соціальні виплати','Продаж майна','Інші надходження']),
 ('Службові',['Переказ','Коригування'])]
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
