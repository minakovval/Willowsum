# F1 resolved: final design sheet «Шкала ліміту · затверджено» (replaces the exploratory palette boards) — no app shell
# run from $S/tg: python3 plan_palette.py [height]
import sys
from decimal import Decimal as D, ROUND_HALF_UP
exec(open('scale_f1.py').read())
OUT='../p0canvas/project/PlanPalette.dc.html'
H=int(sys.argv[1]) if len(sys.argv)>1 else 2200
INK='#1B2230'; MUTED='#566174'; LINE='#E5E5E2'; SOFT='#F1F1EF'; N=' '
def nb(t): return t.replace(' ',N)
def eur(x): return f1_eur(x).replace('−','−')
def crt(h,text=True):
    r=f1_ratio(h); v=f'{r:.2f}'.replace('.',',')
    if text: verdict='AA' if r>=4.5 else ('великий текст' if r>=3 else 'не для тексту')
    else: verdict='смуга ≥ 3 : 1' if r>=3 else 'смуга < 3 : 1'
    col='#2E7D4F' if (r>=4.5 if text else r>=3) else '#A15C07'
    return f'<span style="display: inline-flex; flex-wrap: wrap; gap: 0 6px; font-size: 11px; line-height: 14px;"><span style="font-variant-numeric: tabular-nums; color: {INK}; font-weight: 600;">{nb(v+" : 1")}</span><span style="color: {col};">{nb(verdict)}</span></span>'
def code(h): return f'<code style="font: 11px ui-monospace, monospace; color: {INK};">{h}</code>'
def H2(t,sub=''): return f'<div style="display: flex; flex-direction: column; gap: 4px;"><h2 style="margin: 0; font: 600 22px/28px \'Inter Tight\', Inter, sans-serif;">{t}</h2>{f"<span style=\"color: {MUTED}; font-size: 14px; line-height: 20px;\">{sub}</span>" if sub else ""}</div>'
def card(inner,extra=''): return f'<div style="background: #FFFFFF; border: 1px solid {LINE}; border-radius: 12px; {extra}">{inner}</div>'
# ---- 1. gradient
stops=','.join(f'{f1_grad(x)} {x}%' for x in range(0,101,2))
ticks=''.join(f'<span style="position: absolute; left: {x}%; transform: translateX({"0" if x==0 else ("-100%" if x==100 else "-50%")}); display: flex; flex-direction: column; align-items: {"flex-start" if x==0 else ("flex-end" if x==100 else "center")}; gap: 2px; font-size: 11px; line-height: 14px; color: {MUTED}; white-space: nowrap;"><span style="width: 1px; height: 6px; background: #9AA3AF;"></span><b style="color: {INK}; font-weight: 600;">{lab}</b>{code(c)}</span>' for x,lab,c in [(0,'0 %','#0E7A3B'),(30,'30 %','#34A853'),(55,'55 %','#7CC242'),(75,'75 %','#C9C21A'),(100,'95–100 %','#FBBC05')])
grad=f'''<div style="position: relative; padding: 4px 0 52px;"><div style="height: 18px; border-radius: 6px; background: linear-gradient(90deg, {stops});"></div>
<span style="position: absolute; left: 80%; top: 0; height: 26px; border-left: 2px dashed {INK};"></span><span style="position: absolute; left: calc(80% + 6px); top: -18px; font-size: 11px; color: {INK}; font-weight: 600; white-space: nowrap;">80 % — «майже вичерпано»</span>
<div style="position: relative; height: 0; margin-top: 4px;">{ticks}</div></div>'''
SAMPLES=[10,40,57,70,86,94]
def srow(p):
    c=f1_grad(p); st=('ramp',D(p),0,0); ink=f1_ink(c)
    return f'<div style="display: flex; align-items: center; gap: 14px; min-height: 44px; padding: 6px 0; border-top: 1px solid {SOFT}; font-size: 12px;"><span style="width: 260px; flex: none; display: flex;">{f1_bar(st,8,False)}</span><span style="width: 210px; flex: none;">{f1_label(st)}</span><span style="width: 180px; color: {MUTED};">смуга {code(c)} {crt(c,False)}</span><span style="flex: 1; color: {MUTED};">текст {code(ink)} {crt(ink)}{"<span style=\"display: block;\">"+nb("темніший відтінок того самого тону")+"</span>" if ink!=c else ""}</span></div>'
sec1=H2('1. Використання 0–100 %: безперервний градієнт','Колір смуги — колір шкали в точці використання категорії (інтерполяція OKLCH). Слово: «є залишок · N %» до 80 %, «майже вичерпано · N %» від 80 %. Обов’язкова категорія рівно на 100 % — сірий «✓ ліміт вичерпано»; необов’язкова — початок шкали перевитрати.')
sec1+=card(f'<div style="padding: 28px 24px 12px;">{grad}'+''.join(srow(p) for p in SAMPLES)+'</div>')
# ---- 2. overspend shades
REP=[D(x) for x in ('2.5','7.5','15','35','75','150','350','700')]
TH=F1_TH
def orow(i):
    c=F1_SHADES[i]; ink=f1_ink(c); st=('over',None,i+1,REP[i])
    return f'<div style="display: flex; align-items: center; gap: 14px; min-height: 48px; padding: 6px 0; border-top: 1px solid {SOFT}; font-size: 12px;"><span style="width: 120px; flex: none; display: flex; flex-direction: column;"><b style="font-size: 13px; color: {INK};">Рівень {i+1}</b><span style="color: {MUTED};">{nb(TH[i])}</span></span><span style="width: 260px; flex: none; display: flex;">{f1_bar(st,8)}</span><span style="width: 170px; color: {MUTED};">смуга і хвіст {code(c)} {crt(c,False)}</span><span style="flex: 1; color: {MUTED};">текст {code(ink)} {crt(ink)}{"<span style=\"display: block;\">"+nb("темніший відтінок того самого тону")+"</span>" if ink!=c else ""}</span></div>'
sec2=H2('2. Перевитрата: відтінок і хвіст за значущістю','Вісім рівнів. Рівень — це не власний відсоток категорії, а частка суми перевитрати від суми лімітів усіх необов’язкових категорій періоду (межі 5, 10, 20, 50, 100, 200, 500 %). Смуга до 100 % і хвіст за нею мають один відтінок; довжина хвоста росте з тією ж часткою (логарифмічно, з обмеженням). Текст показує власні числа категорії.')
sec2+=card(f'<div style="padding: 12px 24px;">'+''.join(orow(i) for i in range(len(F1_SHADES)))+'</div>')
# ---- 3. owner examples
OPT=D('2000.00')
EX=[('Транспорт','10.00','100.00',True),('Кафе і ресторани','500.00','1000.00',False),('Продукти','600.00','420.00',True),('Пальне','150.00','129.00',False),('Оренда','1200.00','1200.00',True),('Підписки','40.00','40.00',False),('Подарунки','100.00','0.00',False)]
def exrow(n,l,s,m):
    st=f1_state(l,s,m,OPT); L=D(l); S=D(s); k,p,lv,sh=st
    extra=f' · рівень {lv}: {nb(eur(S-L))} = {str(sh.quantize(D("0.1"),ROUND_HALF_UP)).replace(".",",")}{N}% від {nb(eur(OPT))}' if k=='over' else ''
    return f'''<div style="display: flex; flex-direction: column; gap: 4px; padding: 8px 16px 10px; border-bottom: 1px solid {SOFT}; font-size: 13px;"><div style="display: flex; align-items: center; gap: 10px; min-height: 28px;"><span style="flex: 1; min-width: 0;"><b style="font-weight: 600;">{n}</b>{" <span style=\"color: "+MUTED+"; font-size: 11px;\">· обов’язкова</span>" if m else ""}<span style="color: {MUTED}; font-size: 12px;">{extra}</span></span><span style="width: 96px; text-align: right; font-variant-numeric: tabular-nums;">{nb(eur(S))}</span><span style="width: 96px; text-align: right; font-variant-numeric: tabular-nums;">{nb(eur(L))}</span><span style="width: 96px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; {"color: "+f1_colours(st)[1]+";" if L<S else ""}">{nb(eur(L-S))}</span></div>
<div style="display: flex; align-items: center; gap: 10px;">{f1_bar(st)}{f1_label(st,L,S,230)}</div></div>'''
hd=f'<div style="display: flex; align-items: center; gap: 10px; height: 36px; padding: 0 16px; border-bottom: 1px solid {LINE}; color: {MUTED}; font: 500 11px/14px Inter, sans-serif; letter-spacing: .04em;"><span style="flex: 1;">КАТЕГОРІЯ</span><span style="width: 96px; text-align: right;">ВИТРАЧЕНО</span><span style="width: 96px; text-align: right;">ЛІМІТ</span><span style="width: 96px; text-align: right;">ЗАЛИШОК</span></div>'
sec3=H2('3. Приклади власника','Сума лімітів необов’язкових категорій — '+nb(eur(OPT))+'. «Транспорт»: ліміт € 10,00, витрачено € 100,00 — власні +900 %, але перевищено лише на € 90,00 — 4,5 % → рівень 1, блідий. «Кафе і ресторани»: ліміт € 500,00, витрачено € 1 000,00 — перевищено на € 500,00 — 25 % → рівень 4, яскравий. Рівні 5–8 — ще темніші, до глибокого темно-червоного.')
sec3+=card(hd+''.join(exrow(*e) for e in EX),'overflow: hidden;')
head=f'''<div style="display: flex; flex-direction: column; gap: 8px;"><span style="color: {MUTED}; font: 500 12px/16px Inter, sans-serif; letter-spacing: .08em;">ПЛАНУВАННЯ · ДИЗАЙН-СИСТЕМА · F1</span>
<h1 style="margin: 0; font: 600 32px/40px 'Inter Tight', Inter, sans-serif; letter-spacing: -0.02em;">Шкала ліміту · затверджено</h1>
<p style="margin: 0; max-width: 960px; color: {MUTED}; font-size: 15px; line-height: 22px;">Одна шкала використання ліміту для бюджету, плану, віджетів і карток. Кожен стан має маркер і слово; колір лише підсилює їх. Контраст — за WCAG 2.1 щодо білого: текст від 4,5 : 1, смуги від 3 : 1. Де яскравий колір не має контрасту для тексту, напис іде темнішим відтінком того самого тону.</p></div>'''
# ---- 4. C5 deviation colours (as currently specified; the «трохи» boundary is not approved yet — boards use ≤ 10 %)
C5S=[('#2E7D4F','краще','▼ € 64,30','менші витрати чи борг або більший дохід, ніж база'),('#5FA77D','трохи краще','▼ € 7,60','те саме, відхилення до 10 %'),('#1D4E89','без змін','—','менше 1 % і менше € 1,00'),('#D46A6A','трохи гірше','▲ € 8,20','більші витрати чи менший дохід, до 10 %'),('#B23A3A','гірше','▲ € 162,40','більші витрати чи борг або менший дохід, ніж база')]
def c5row(c,w,ex,cond): return f'<div style="display: flex; align-items: center; gap: 14px; min-height: 44px; padding: 6px 0; border-top: 1px solid {SOFT}; font-size: 12px;"><b style="width: 120px; flex: none; font-size: 13px;">{w}</b><span style="width: 110px; flex: none; color: {c}; font-weight: 600; font-size: 14px; white-space: nowrap;">{nb(ex)}</span><span style="flex: 1; color: {MUTED};">{nb(cond)}</span><span style="width: 260px; flex: none; color: {MUTED};">текст {code(c)} {crt(c)}</span></div>'
sec4=H2('4. Відхилення від плану, середнього чи попереднього періоду (C5)','Колір означає «краще» чи «гірше», стрілка ▲▼ — напрям. Зелений і червоний — у двох щаблях за величиною; межу «трохи» ще не затверджено (на макетах — до 10 %). Слово — у підказці.')
sec4+=card('<div style="padding: 6px 24px;">'+''.join(c5row(*r) for r in C5S)+'</div>')
# ---- 5. G1 goal progress
gst=','.join(f'{g1_grad(x)} {x}%' for x in range(0,101,2))
gticks=''.join(f'<span style="position: absolute; left: {x}%; transform: translateX({"0" if x==0 else ("-100%" if x==100 else "-50%")}); display: flex; flex-direction: column; align-items: {"flex-start" if x==0 else ("flex-end" if x==100 else "center")}; gap: 2px; font-size: 11px; line-height: 14px; color: {MUTED}; white-space: nowrap;"><span style="width: 1px; height: 6px; background: #9AA3AF;"></span><b style="color: {INK}; font-weight: 600;">{x} %</b>{code(c)}</span>' for x,c in G1_STOPS)
gstrip=f'<div style="position: relative; padding: 4px 0 52px;"><div style="height: 18px; border-radius: 6px; background: linear-gradient(90deg, {gst});"></div><div style="position: relative; height: 0; margin-top: 4px;">{gticks}</div></div>'
def gbar(p,c,tick=None):
    tk=f'<span style="position: absolute; left: {tick}%; top: -3px; width: 2px; height: 14px; background: {INK}; border-radius: 1px;"></span>' if tick else ''
    return f'<span style="position: relative; width: 260px; flex: none; height: 8px; border-radius: 999px; background: {SOFT}; display: block;"><span style="display: block; width: {p}%; height: 8px; border-radius: 999px; background: {c};"></span>{tk}</span>'
def grow(lab,p,c,word,g,tick=None,cond=''):
    ink=f1_ink(c) if c!=G1_PAUSE else MUTED
    return f'<div style="display: flex; align-items: center; gap: 14px; min-height: 44px; padding: 6px 0; border-top: 1px solid {SOFT}; font-size: 12px;"><b style="width: 110px; flex: none; font-size: 13px;">{lab}</b>{gbar(p,c,tick)}<span style="width: 230px; flex: none; display: inline-flex; align-items: center; gap: 6px; color: {ink}; font-weight: 600; white-space: nowrap;">{f1_mk(g,ink)}{nb(word)}</span><span style="width: 170px; color: {MUTED};">смуга {code(c)} {crt(c,False)}</span><span style="flex: 1; color: {MUTED};">текст {code(ink)} {crt(ink)}<span style="display: block;">{nb(cond)}</span></span></div>'
GR=[('Зібрано 12 %',12,g1_grad(12),'• 12 %','•',None,''),('Зібрано 45 %',45,g1_grad(45),'• 45 %','•',None,''),('Зібрано 70 %',70,g1_grad(70),'• 70 %','•',None,''),('Зібрано 92 %',92,g1_grad(92),'• 92 %','•',None,''),
    ('Досягнуто',100,G1_DONE,'Досягнуто · + € 50,00 понад ціль','✓',None,'повна смуга #2E7D32'),('Відстає',40,g1_grad(40),'Відстає · € 240,00','!',55,'колір смуги не змінюється; риска — де мала б бути сьогодні'),('На паузі',30,G1_PAUSE,'На паузі','•',None,'сіра смуга')]
GR=[(a,b,c,(d[2:] if d.startswith('• ') else d),e,f,g) for a,b,c,d,e,f,g in GR]
sec5=H2('5. Прогрес цілі (G1)','Колір смуги — точка градієнта жовтий → зелений у відсотку зібраного (OKLCH). Бурштиновий акцент лишається лише для іконок цілей.')
sec5+=card(f'<div style="padding: 28px 24px 12px;">{gstrip}'+''.join(grow(*r) for r in GR)+'</div>')
body=head+sec1+sec2+sec3+sec4+sec5
html=f'''<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<title>Шкала ліміту · затверджено</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;family=Inter+Tight:wght@600&amp;display=swap">
<style>body{{margin:0}}</style>
</helmet>
<div style="position: relative; width: 1280px; height: {H}px; overflow: hidden; font-family: Inter, system-ui, sans-serif; font-size: 14px; line-height: 20px; color: {INK}; background: #FAFAF8;">
<main style="padding: 40px; display: flex; flex-direction: column; gap: 24px;">
{body}
</main>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":1280,"height":{H}}}}}'>
class Component extends DCLogic {{ renderVals() {{ return {{}}; }} }}
</script>
</body>
</html>
'''
open(OUT,'w').write(html)
print([(p,f1_grad(p),f1_ink(f1_grad(p))) for p in SAMPLES]); print([(c,f1_ink(c),round(f1_ratio(f1_ink(c)),2)) for c in F1_SHADES])
