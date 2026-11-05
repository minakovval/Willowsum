# C10: design sheet «Кольори графіків» (no app shell, like PlanPalette) + owner decision cards F19 / F21 / F22
# run from $S/tg: python3 plan_chartcol.py [height]
import sys, math
OUT='/tmp/claude-0/-home-user/ce00d8b4-5791-5ba6-9cf7-6313fce4e28c/scratchpad/restore/p0canvas/project/PlanChartColors.dc.html'
H=int(sys.argv[1]) if len(sys.argv)>1 else 3740
N=' '; CI={}
exec(open('chartcol.py').read())
INK='#1B2230'; MUTED='#566174'; LINE='#E5E5E2'; SOFT='#F1F1EF'
def nb(t): return t.replace(' ',N)
def lum(h):
    f=lambda c: c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
    r,g,b=[f(int(h[i:i+2],16)/255) for i in (1,3,5)]; return 0.2126*r+0.7152*g+0.0722*b
def ratio(a,b='#FFFFFF'):
    x,y=sorted([lum(a),lum(b)],reverse=True); return (x+0.05)/(y+0.05)
def code(h): return f'<code style="font: 11px ui-monospace, monospace; color: {INK};">{h}</code>'
def cr(h): r=ratio(h); return f'<span style="font-size: 11px; color: {"#2E7D4F" if r>=3 else "#A15C07"}; font-variant-numeric: tabular-nums;">{nb(f"{r:.2f}".replace(".",",")+" : 1")}</span>'
def H2(t,sub=''): return f'<div style="display: flex; flex-direction: column; gap: 4px;"><h2 style="margin: 0; font: 600 22px/28px \'Inter Tight\', Inter, sans-serif;">{t}</h2>{f"<span style=\"color: {MUTED}; font-size: 14px; line-height: 20px;\">{sub}</span>" if sub else ""}</div>'
def card(inner,extra=''): return f'<div style="background: #FFFFFF; border: 1px solid {LINE}; border-radius: 12px; padding: 20px 24px; {extra}">{inner}</div>'
def sec(t): return f'<div style="color: {MUTED}; font: 500 12px/16px Inter, sans-serif; letter-spacing: .06em;">{t}</div>'
def sw(c,s=12,r=3): return f'<span style="width: {s}px; height: {s}px; flex: none; border-radius: {r}px; background: {c};"></span>'
def lsw(c,dash=''): return f'<svg width="22" height="12" aria-hidden="true"><line x1="0" y1="6" x2="22" y2="6" stroke="{c}" stroke-width="2" {f"stroke-dasharray=\"{dash}\"" if dash else ""}/></svg>'
def leg(items): return '<div style="display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 12px; color: '+MUTED+';">'+''.join(f'<span style="display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;">{s}{nb(t)}</span>' for t,s in items)+'</div>'
def eur(x):
    s=f'{abs(x):,.2f}'.replace(',',' ').replace('.',',')
    return nb(('−' if x<0 else '')+s+' €')
TXT='font-family="Inter, sans-serif" font-size="11" fill="#566174"'
# ---------------- header
head=f'''<div style="display: flex; flex-direction: column; gap: 6px;"><span style="color: {MUTED}; font-size: 13px;">Планування · DS-06, DS-07 п. 15 · усі графіки продукту</span>
<h1 style="margin: 0; font: 600 32px/40px 'Inter Tight', Inter, sans-serif;">Кольори графіків</h1>
<span style="color: {MUTED}; font-size: 12px; line-height: 16px;">Створено: 2026-11-03 · Оновлено: 2026-11-05</span>
<span style="color: {MUTED}; font-size: 15px; line-height: 22px; max-width: 980px;">{nb("Категорія має свій колір — тон її групи і відтінок (той самий, що чип категорії); решта категоріальних серій бере кольори палітри chart-cat-1 … chart-cat-8 у сталому порядку; «Інші · N» — сірий chart-other і завжди останній. Зелений і червоний як «краще / гірше» — лише на графіках відхилення і використання ліміту.")}</span></div>'''
# ---------------- 1. rules
RULES=[('Серія — категорія бюджету','колір категорії (як її чип та іконка) = тон групи + відтінок (світлота OKLCH 0,40–0,80, тон ±8°); у будь-якому графіку; не залежить від рангу чи фільтра; не більше 4 відтінків однієї групи на графіку, решта — «Інші · N»',''.join(sw(cc_cat(n)) for n in ['Продукти','Кафе і ресторани','Комунальні','Діти','Одяг'])),
('Інші категоріальні серії (джерела, рахунки, учасники)','палітра chart-cat-1 … chart-cat-8 у сталому порядку; не більше 5 серій: 4 найбільші + «Інші · N» (chart-other #9AA3AF, останній; у заливках складу цілого — штрихування)',''.join(sw(c) for c in CC_PAL)+sw(CC_OTHER)),
('План, бюджет, ціль, ліміт як лінія','токен chart-reference — ink #1B2230 з непрозорістю 60 %; план і цільова лінія цілі — короткий штрих 4 / 4 px, бюджет — довгий штрих 12 / 4 px; суцільних опорних ліній немає; підсумки водоспаду — brand #0B2545',lsw(CC_REF,'4 4')+lsw(CC_REF,'12 4')+sw(CC_TOTAL)),
('Семантичні кольори','gain, loss, відтінки перевищення — лише на графіках відхилення або використання ліміту; ніколи як «серія 4»',sw('#27704C')+sw('#387F5A')+sw('#B23A3A')+sw('#C34A48')+sw('#0E7A3B')+sw('#FBBC05')+sw('#E5584A')+sw('#7A0F08')),
('Розрізнення без кольору','2 px проміжок кольору surface-200 між сегментами; у treemap кожна група — у білій рамці 2 px; легенда в порядку сегментів; підписи на плитках і підказка; таблиця тих самих чисел під графіком',sw('#9AA3AF',12,999))]
rules=''.join(f'<div style="display: flex; align-items: flex-start; gap: 16px; padding: 12px 0; border-top: 1px solid {SOFT};"><span style="width: 150px; flex: none; display: flex; flex-wrap: wrap; gap: 4px; padding-top: 4px;">{s}</span><span style="flex: 1; display: flex; flex-direction: column; gap: 2px;"><b style="font-weight: 600;">{nb(t)}</b><span style="color: {MUTED}; font-size: 13px; line-height: 18px;">{nb(d)}</span></span></div>' for t,d,s in RULES)
s1=card(f'<div style="display: flex; flex-direction: column; gap: 4px;">{sec("1 · ПРАВИЛА")}{rules}</div>')
# ---------------- 2. palette
pal=''.join(f'''<div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px;"><div style="height: 64px; border-radius: 8px; background: {c}; display: flex; align-items: flex-end; padding: 6px 8px; box-sizing: border-box; color: #FFFFFF; font: 600 13px Inter, sans-serif;">{i+1}</div><b style="font-weight: 600; font-size: 13px;">{n}</b>{code('chart-cat-'+str(i+1))}{code(c)}<span style="font-size: 11px; color: {MUTED};">{nb(CC_GROUPS[i])}</span>{cr(c)}</div>''' for i,(c,n) in enumerate(zip(CC_PAL,CC_PAL_NAMES)))
pal+=f'''<div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px;"><div style="height: 64px; border-radius: 8px; background: {CC_OTHER}; display: flex; align-items: flex-end; padding: 6px 8px; box-sizing: border-box; color: #FFFFFF; font: 600 13px Inter, sans-serif;">∑</div><b style="font-weight: 600; font-size: 13px;">«Інші · N»</b>{code('chart-other')}{code(CC_OTHER)}<span style="font-size: 11px; color: {MUTED};">{nb('завжди останній; «Коригування»')}</span>{cr(CC_OTHER)}</div>'''
INC=''.join(f'<span style="display: inline-flex; align-items: center; gap: 8px; font-size: 12px; white-space: nowrap;">{sw(c,16,4)}<b style="font-weight: 600;">{nb(nm)}</b>{code(t)}{code(c)}<span style="color: {MUTED};">{nb(g)}</span>{cr(c)}</span>' for t,c,nm,g in CC_INCOME)+f'<span style="display: inline-flex; align-items: center; gap: 8px; font-size: 12px; white-space: nowrap;">{sw(CC_TRANSFER,16,4)}<b style="font-weight: 600;">Переказ</b>{code("chart-transfer")}{code(CC_TRANSFER)}<span style="color: {MUTED};">{nb("текст на ньому — лише ink")}</span></span>'
val=nb('Усі 10 тонів (8 груп витрат і 2 групи доходів) мають однакову світлоту OKLCH 0,58 і насиченість до 0,15 у межах sRGB, розведені по колу тонів; тони доходів не входять у палітру серій. Тон chart-cat-N — це і серія N інших категоріальних серій, і тон групи витрат N та основа відтінків її категорій. Порядок слотів сталий.')
s2=card(f'<div style="display: flex; flex-direction: column; gap: 14px;">{sec("2 · ПАЛІТРА ГРАФІКІВ · CHART-CAT-1 … 8, ТОНИ ДОХОДІВ, СЛУЖБОВІ")}<div style="display: flex; gap: 12px;">{pal}</div><div style="display: flex; flex-wrap: wrap; gap: 8px 24px;">{INC}</div><span style="color: {MUTED}; font-size: 13px; line-height: 18px;">{val}</span></div>')
# ---------------- 3. category map
def chip(n):
    c=CATCOL[n]
    return f'<div style="display: flex; align-items: center; gap: 8px; min-height: 30px;"><span style="width: 18px; height: 18px; flex: none; border-radius: 999px; background: {c}; {"border: 1px dashed #9AA3AF; background: transparent;" if False else ""}"></span><span style="flex: 1; min-width: 0; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{n}</span>{code(c)}</div>'
cols=[[],[],[],[]]
for i,(g,ns) in enumerate(CATGROUPS):
    blk=f'<div style="display: flex; flex-direction: column; gap: 2px; padding-bottom: 14px;"><b style="font-weight: 600; font-size: 13px; padding-bottom: 4px;">{g}</b>'+''.join(chip(n) for n in ns)+'</div>'
    cols[[0,0,1,1,1,2,2,2,3,3,3][i]].append(blk)
cmap=''.join(f'<div style="flex: 1; min-width: 0; display: flex; flex-direction: column;">{"".join(c)}</div>' for c in cols)
cnote=nb('Системні категорії BUD-01: колір категорії = тон групи + відтінок (DS-07 п. 15). Світлота OKLCH рівномірно від 0,40 (найбільші типові витрати) до 0,80; тон по черзі −8° і +8°; насиченість — як у тону групи; група з 2 категорій — 0,46 і 0,70, з 3 — 0,42, 0,60 і 0,78. Іконка на колі біла, якщо контраст білого не менший за 3 : 1, інакше ink. Службові: «Переказ» #9DB2C8, «Коригування» chart-other #9AA3AF.')
s3=card(f'<div style="display: flex; flex-direction: column; gap: 14px;">{sec("3 · КОЛЬОРИ КАТЕГОРІЙ")}<div style="display: flex; gap: 28px;">{cmap}</div><span style="color: {MUTED}; font-size: 13px; line-height: 18px;">{cnote}</span></div>')
# ---------------- 4. sample charts
# stacked bars by category (4 months), «Інші» last
SB=[('Продукти',[742,709,677,742]),('Кафе і ресторани',[313,248,215,499]),('Комунальні',[225,229,242,286]),('Діти',[120,485,310,310]),('Одяг',[118,286,143,265]),('Інші · 9',[640,520,560,690])]
MS=['лип.','серп.','вер.','жовт.']
W,Hh=372,230; x0,x1,t,b=44,W-6,10,Hh-24; mx=2800
fy=lambda v: b-v/mx*(b-t); bw=(x1-x0)/4
sv=f'<svg width="{W}" height="{Hh}" role="img" aria-label="Приклад: витрати за категоріями" style="display: block;"><defs><pattern id="othhatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#FFFFFF"/><rect width="3" height="6" fill="{CC_OTHER}"/></pattern></defs>'
for v in (0,1000,2000):
    sv+=f'<line x1="{x0}" x2="{x1}" y1="{fy(v):.1f}" y2="{fy(v):.1f}" stroke="{"#C9CDD3" if v==0 else "#EFEFEC"}"/><text x="{x0-6}" y="{fy(v)+4:.1f}" text-anchor="end" {TXT}>{v//1000 if v else 0}{" тис." if v else ""}</text>'
for j in range(4):
    acc=0; x=x0+bw*j+bw*.2; w=bw*.6
    for n,vals in SB:
        c='url(#othhatch)' if n.startswith('Інші') else cc_cat(n); v=vals[j]
        sv+=f'<rect x="{x:.1f}" y="{fy(acc+v):.1f}" width="{w:.1f}" height="{fy(acc)-fy(acc+v)-2:.1f}" fill="{c}"/>'; acc+=v
    sv+=f'<text x="{x+w/2:.1f}" y="{Hh-6}" text-anchor="middle" {TXT}>{MS[j]}</text>'
sv+='</svg>'
c1=f'<div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px;"><b style="font-weight: 600;">Складені стовпці · категорії</b><span style="color: {MUTED}; font-size: 12px;">кольори категорій, «Інші» сірий зверху (останній)</span>{leg([(n,sw(CC_OTHER if n.startswith("Інші") else cc_cat(n))) for n,_ in SB])}{sv}</div>'
# lines: members (palette) + plan reference
LS=[('Олена',[820,910,760,980,1040,990]),('Андрій',[640,700,820,760,720,880]),('Спільні',[1210,1180,1260,1300,1240,1320])]
PLN=1200; mx2=1500; fy2=lambda v: b-v/mx2*(b-t); M6=['трав.','черв.','лип.','серп.','вер.','жовт.']
fx=lambda i: x0+12+(x1-x0-24)*i/5
sl=f'<svg width="{W}" height="{Hh}" role="img" aria-label="Приклад: витрати учасників і план" style="display: block;">'
for v in (0,500,1000,1500):
    sl+=f'<line x1="{x0}" x2="{x1}" y1="{fy2(v):.1f}" y2="{fy2(v):.1f}" stroke="{"#C9CDD3" if v==0 else "#EFEFEC"}"/><text x="{x0-6}" y="{fy2(v)+4:.1f}" text-anchor="end" {TXT}>{v}</text>'
sl+=f'<line x1="{x0}" x2="{x1}" y1="{fy2(PLN):.1f}" y2="{fy2(PLN):.1f}" stroke="{CC_REF}" stroke-width="1.5" stroke-dasharray="{CC_REF_DASH}"/>'
mks=['circle','square','diamond']
for k,(n,vals) in enumerate(LS):
    c=CC_PAL[k]; sl+=f'<polyline points="{" ".join(f"{fx(i):.1f},{fy2(v):.1f}" for i,v in enumerate(vals))}" fill="none" stroke="{c}" stroke-width="2"/>'
    for i,v in enumerate(vals):
        X,Y=fx(i),fy2(v)
        sl+={'circle':f'<circle cx="{X:.1f}" cy="{Y:.1f}" r="3.5" fill="{c}" stroke="#FFFFFF" stroke-width="1.5"/>','square':f'<rect x="{X-3.5:.1f}" y="{Y-3.5:.1f}" width="7" height="7" fill="{c}" stroke="#FFFFFF" stroke-width="1.5"/>','diamond':f'<path d="M{X:.1f} {Y-5:.1f}L{X+5:.1f} {Y:.1f}L{X:.1f} {Y+5:.1f}L{X-5:.1f} {Y:.1f}Z" fill="{c}" stroke="#FFFFFF" stroke-width="1.5"/>'}[mks[k]]
sl+=''.join(f'<text x="{fx(i):.1f}" y="{Hh-6}" text-anchor="middle" {TXT}>{m}</text>' for i,m in enumerate(M6))+'</svg>'
c2=f'<div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px;"><b style="font-weight: 600;">Лінії · не категорії</b><span style="color: {MUTED}; font-size: 12px;">учасники — chart-cat-1 … 3 + різні маркери; план — chart-reference, штрих 4 / 4</span>{leg([(n,lsw(CC_PAL[k])) for k,(n,_) in enumerate(LS)]+[("План 1 200 €",lsw(CC_REF,CC_REF_DASH))])}{sl}</div>'
# treemap by category
TM=[('Продукти',742.30),('Кафе і ресторани',498.60),('Відсотки за кредитами',342.24),('Діти',310),('Комунальні',286.40),('Одяг',264.90),('Інші · 9',700.02)]
def squarify(items,x,y,w,h):
    out=[]; tot=sum(v for _,v in items); sc=w*h/tot; its=[(n,v*sc) for n,v in items]
    def worst(row,side):
        s=sum(a for _,a in row); return max(max(side*side*a/(s*s),(s*s)/(side*side*a)) for _,a in row)
    while its:
        side=min(w,h); row=[its.pop(0)]
        while its and worst(row+[its[0]],side)<=worst(row,side): row.append(its.pop(0))
        s=sum(a for _,a in row)
        if w>=h:
            cw=s/h; yy=y
            for n,a in row: out.append((n,x,yy,cw,a/cw)); yy+=a/cw
            x+=cw; w-=cw
        else:
            rh=s/w; xx=x
            for n,a in row: out.append((n,xx,y,a/rh,rh)); xx+=a/rh
            y+=rh; h-=rh
    return out
tmi=[x for x in TM if not x[0].startswith('Інші')]; tmi.sort(key=lambda r:-r[1]); tmi.append(TM[-1])
tm=''
for n,x,y,w,h in squarify(tmi,0,0,W,Hh-20):
    c=CC_OTHER if n.startswith('Інші') else cc_cat(n); v=dict(TM)[n]
    tm+=f'<div title="{n} · {eur(v)}" style="position: absolute; left: {x+1:.1f}px; top: {y+1:.1f}px; width: {w-2:.1f}px; height: {h-2:.1f}px; box-sizing: border-box; padding: 6px 8px; border-radius: 3px; background: {c}; color: {"#FFFFFF" if ratio(c)>=4.5 else INK}; font: 12px/16px Inter, sans-serif; overflow: hidden; display: flex; flex-direction: column;"><b style="font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{n}</b>{f"<span style=\"opacity: .85;\">{eur(v)}</span>" if h>44 and w>70 else ""}</div>'
c3=f'<div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px;"><b style="font-weight: 600;">Treemap · категорії</b><span style="color: {MUTED}; font-size: 12px;">плитка = колір категорії; підпис на плитці; «Інші» сірі, останні</span>{leg([("Інші · 9 — chart-other",sw(CC_OTHER))])}<div role="group" aria-label="Приклад: treemap витрат за категоріями" style="position: relative; width: {W}px; height: {Hh-20}px;">{tm}</div></div>'
s4=card(f'<div style="display: flex; flex-direction: column; gap: 14px;">{sec("4 · ПРИКЛАДИ")}<div style="display: flex; gap: 32px;">{c1}{c2}{c3}</div></div>')
# ---------------- 5. owner decisions
CHOSEN={'F19':'Б','F21':'Б','F22':'Б'}  # owner decisions 2026-11-03
def vcard(letter,title,inner,sub='',chosen=False):
    tag=f'<span style="margin-left: auto; flex: none; padding: 2px 8px; border-radius: 999px; background: #E6F2EA; color: #1F5C38; font: 600 12px/16px Inter, sans-serif; white-space: nowrap;">✓{N}Обрано:{N}{letter}</span>' if chosen else ''
    bd='2px solid #2E7D4F' if chosen else f'1px solid {LINE}'
    return f'<div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; padding: {15 if chosen else 16}px; border: {bd}; border-radius: 10px; background: #FFFFFF; {"" if chosen else "opacity: .72;"}"><div style="display: flex; align-items: center; gap: 10px;"><span style="width: 28px; height: 28px; flex: none; border-radius: 999px; background: #0B2545; color: #FFFFFF; display: grid; place-items: center; font: 600 13px Inter, sans-serif;">{letter}</span><b style="font-weight: 600;">{nb(title)}</b>{tag}</div>{f"<span style=\"color: {MUTED}; font-size: 12px; line-height: 16px;\">{nb(sub)}</span>" if sub else ""}{inner}</div>'
def dcard(code_,title,sub,variants):
    return card(f'<div style="display: flex; flex-direction: column; gap: 14px;"><div style="display: flex; align-items: baseline; gap: 10px;"><span style="padding: 2px 8px; border-radius: 4px; background: #E6F2EA; color: #1F5C38; font: 600 12px/16px Inter, sans-serif; white-space: nowrap;">{code_} · обрано {CHOSEN[code_]}</span><b style="font: 600 18px/24px \'Inter Tight\', Inter, sans-serif;">{nb(title)}</b></div><span style="color: {MUTED}; font-size: 13px; line-height: 18px;">{nb(sub)}</span><div style="display: flex; gap: 16px; align-items: stretch;">{variants}</div></div>')
# F19 — deviation saturation steps
ROWS=[('Продукти',742.30,705.88,'down'),('Транспорт',46.40,45.30,'down'),('Кафе і ресторани',498.60,258.60,'down'),('Комунальні',286.40,231.93,'down'),('Пальне',168.40,180.23,'down'),('Здоров’я',96.40,78.37,'down'),('Розваги',118.00,108.00,'down'),('Одяг',182.40*0.9,182.40,'down')]
STEPS={'А':[(5,'light'),(None,'strong')],'Б':[(10,'light'),(None,'strong')],'В':[(5,'light'),(20,'mid'),(None,'strong')]}
COLS={'better':{'light':'#5FA77D','mid':'#2E7D4F','strong':'#1F5C38'},'worse':{'light':'#D46A6A','mid':'#B23A3A','strong':'#8E1F1F'}}
COLS2={'better':{'light':'#387F5A','strong':'#27704C'},'worse':{'light':'#C34A48','strong':'#B23A3A'}}  # gain-soft, gain, loss-soft, loss
def devc(v,base,variant):
    p=round(abs(v)*100/base,6); kind='worse' if v>0 else 'better'  # exact 10,0 % stays in the light step
    for lim,st in STEPS[variant]:
        if lim is None or p<=lim: break
    col=(COLS if variant=='В' else COLS2)[kind][st]
    arr='▲' if v>0 else '▼'
    return f'<span style="color: {col}; font-weight: 600; {"" if st!="light" else ""} white-space: nowrap; font-variant-numeric: tabular-nums;">{arr}{N}{eur(abs(v))}</span><span style="width: 52px; text-align: right; color: {MUTED}; font-size: 12px; font-variant-numeric: tabular-nums;">{nb(("+" if v>0 else "−")+f"{p:.1f}".replace(".",",")+" %")}</span>'
def f19(variant):
    r=''.join(f'<div style="display: flex; align-items: center; gap: 8px; min-height: 34px; border-top: 1px solid {SOFT}; font-size: 13px;"><span style="width: 9px; height: 9px; border-radius: 999px; background: {cc_cat(n)};"></span><span style="flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{n}</span>{devc(cur-base,base,variant)}</div>' for n,cur,base,_ in ROWS)
    lg={'А':[('≤ 5 % · світлий','#5FA77D','#D46A6A'),('> 5 % · насичений','#2E7D4F','#B23A3A')],'Б':[('≤ 10 % · світлий','#387F5A','#C34A48'),('> 10 % · насичений','#27704C','#B23A3A')],'В':[('≤ 5 %','#5FA77D','#D46A6A'),('5–20 %','#2E7D4F','#B23A3A'),('> 20 %','#1F5C38','#8E1F1F')]}[variant]
    l=''.join(f'<span style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: {MUTED}; white-space: nowrap;">{sw(b,10,2)}{sw(w,10,2)}{nb(t)}</span>' for t,b,w in lg)
    return f'<div style="display: flex; flex-wrap: wrap; gap: 6px 12px;">{l}</div><div style="display: flex; align-items: center; gap: 8px; height: 26px; color: {MUTED}; font: 500 11px Inter, sans-serif; letter-spacing: .04em;"><span style="flex: 1;">КАТЕГОРІЯ</span><span>± ДО СЕР.</span><span style="width: 52px; text-align: right;">%</span></div><div>{r}</div>'
F19=dcard('F19','Відхилення «краще / гірше» в «Порівнянні»: кроки насиченості','Колонка «± до сер.» (і «± до плану») — колір за C5, насиченість за розміром відхилення у % від бази. Світлий щабель (gain-soft / loss-soft) — до 10 % включно, насичений (gain / loss) — понад 10 %. Без змін (< 1 % і < 1 €) — «—» кольору brand.',
  vcard('Б','Два кроки: ≤ 10 % / > 10 %',f19('Б'),chosen=True))
# F21 — «Позначити скасованим»
def recrow(menu_open=False):
    return f'''<div style="position: relative; display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 0 12px; border: 1px solid {LINE}; border-radius: 8px; background: #FFFFFF; font-size: 13px;"><span style="width: 28px; height: 28px; flex: none; border-radius: 8px; background: #E4002B; color: #FFFFFF; display: grid; place-items: center; font: 600 11px Inter, sans-serif;">Во</span><span style="flex: 1; min-width: 0; display: flex; flex-direction: column;"><b style="font-weight: 600;">Воля · інтернет</b><span style="color: #7A4505; font-size: 12px;">{nb("! Можливо, скасований · 2 платежі не надійшли")}</span></span><b style="font-variant-numeric: tabular-nums;">{eur(14)}</b><span style="width: 28px; height: 28px; display: grid; place-items: center; border-radius: 6px; {"background: #EEF2F7; box-shadow: inset 0 0 0 1px #1D4E89;" if menu_open else ""} color: {MUTED}; font-weight: 700;">⋯</span></div>'''
popA=f'''<div style="position: relative; height: 270px;">{recrow(True)}<div role="dialog" aria-label="Позначити скасованим" style="position: absolute; right: 0; top: 58px; width: 270px; box-sizing: border-box; padding: 14px; background: #FFFFFF; border: 1px solid {LINE}; border-radius: 10px; box-shadow: 0 8px 24px rgba(11,37,69,.14); display: flex; flex-direction: column; gap: 10px; font-size: 13px;"><span style="position: absolute; right: 9px; top: -6px; width: 10px; height: 10px; background: #FFFFFF; border-left: 1px solid {LINE}; border-top: 1px solid {LINE}; transform: rotate(45deg);"></span><b style="font-weight: 600;">Позначити «Воля» скасованим?</b><span style="color: {MUTED}; font-size: 12px; line-height: 16px;">{nb("Нові платежі не очікуватимуться, сума € 14,00 зникне з плану з листопада. Історія платежів залишиться.")}</span><div style="display: flex; gap: 8px; justify-content: flex-end;"><span style="height: 32px; padding: 0 12px; display: inline-flex; align-items: center; border: 1px solid #C9CDD3; border-radius: 8px; font-weight: 600;">Ні</span><span style="height: 32px; padding: 0 12px; display: inline-flex; align-items: center; border-radius: 8px; background: #0B2545; color: #FFFFFF; font-weight: 600;">Позначити скасованим</span></div></div></div>'''
popB=f'''<div style="position: relative; height: 270px; border-radius: 8px; overflow: hidden;">{recrow(False)}<div style="position: absolute; inset: 0; background: rgba(11,37,69,.32); border-radius: 8px;"></div><div role="dialog" aria-label="Скасувати платіж" style="position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); width: 360px; box-sizing: border-box; padding: 18px; background: #FFFFFF; border-radius: 12px; box-shadow: 0 16px 40px rgba(11,37,69,.24); display: flex; flex-direction: column; gap: 10px; font-size: 13px;"><b style="font: 600 16px/22px Inter, sans-serif;">Скасувати платіж «Воля»?</b><span style="color: {MUTED}; font-size: 12px; line-height: 16px;">{nb("Платіж буде позначено скасованим: нові платежі не очікуватимуться, € 14,00 зникне з плану з листопада. Історія залишиться; відновити можна з архіву.")}</span><div style="display: flex; gap: 8px; justify-content: flex-end; padding-top: 4px;"><span style="height: 34px; padding: 0 12px; display: inline-flex; align-items: center; border: 1px solid #C9CDD3; border-radius: 8px; font-weight: 600; white-space: nowrap;">Не скасовувати</span><span style="height: 34px; padding: 0 12px; display: inline-flex; align-items: center; border-radius: 8px; background: #0B2545; color: #FFFFFF; font-weight: 600; white-space: nowrap;">Скасувати платіж</span></div></div></div>'''
F21=dcard('F21','«Позначити скасованим» для регулярного платежу','Дія з меню «⋯» рядка платежу зі станом «Можливо, скасований» (P4). C3: швидкі дії — в місці виклику; варіант Б — центроване вікно з підтвердженням.',
  vcard('А','Поповер під меню рядка (C3)',popA,'відкривається під «⋯», рядок лишається видимим; Esc / клік поза — закрити')+vcard('Б','Центроване вікно',popB,'затемнення сторінки, текст підтвердження «Скасувати платіж»',chosen=True))
# F22 — pace chart lines
def pace(variant):
    W2,H2=440,200; l,r,tp,bt=40,W2-8,10,H2-22; days=30; lim=1300.0
    X=lambda d: l+(r-l)*d/days; Y=lambda v: bt-v/1500*(bt-tp)
    sp=[0,40,95,120,180,260,300,340,410,470,520,560,610,680,720,790,840,860]
    plan=lambda d: lim*(d/days)**1.05
    s=f'<svg width="{W2}" height="{H2}" role="img" aria-label="Темп витрат: варіант {variant}" style="display: block;">'
    for v in (0,500,1000,1500): s+=f'<line x1="{l}" x2="{r}" y1="{Y(v):.1f}" y2="{Y(v):.1f}" stroke="{"#C9CDD3" if v==0 else "#EFEFEC"}"/><text x="{l-6}" y="{Y(v)+4:.1f}" text-anchor="end" {TXT}>{v}</text>'
    pd='6 4' if variant=='А' else '4 4'; bd='' if variant=='А' else '12 4'  # Б as decided: plan short dash, budget long dash
    s+=f'<polyline points="{" ".join(f"{X(d):.1f},{Y(plan(d)):.1f}" for d in range(0,days+1))}" fill="none" stroke="{CC_REF}" stroke-width="1.5" stroke-dasharray="{pd}"/>'
    s+=f'<line x1="{l}" x2="{r}" y1="{Y(lim):.1f}" y2="{Y(lim):.1f}" stroke="{CC_REF}" stroke-width="1.5" {f"stroke-dasharray=\"{bd}\"" if bd else ""}/><text x="{r}" y="{Y(lim)-5:.1f}" text-anchor="end" {TXT}>Бюджет 1 300 €</text>'
    s+=f'<polyline points="{" ".join(f"{X(d):.1f},{Y(v):.1f}" for d,v in enumerate(sp))}" fill="none" stroke="{CC_PAL[0]}" stroke-width="2"/><circle cx="{X(len(sp)-1):.1f}" cy="{Y(sp[-1]):.1f}" r="4" fill="{CC_PAL[0]}" stroke="#FFFFFF" stroke-width="1.5"/>'
    s+=''.join(f'<text x="{X(d):.1f}" y="{H2-6}" text-anchor="{"start" if d==0 else ("end" if d==30 else "middle")}" {TXT}>{d or 1} лист.</text>' for d in (0,10,20,30))+'</svg>'
    lg=leg([('Витрачено',lsw(CC_PAL[0])),('План (темп)',lsw(CC_REF,pd)),('Бюджет',lsw(CC_REF,bd))])
    return lg+s
F22=dcard('F22','Графік темпу: лінії плану і бюджету','Обидві лінії — опорні, токен chart-reference (ink #1B2230, 60 %); витрачено — chart-cat-1. Відрізняються лише довжиною штриха.',
  vcard('Б','Обидві штрихові, різна довжина',pace('Б'),'план — короткий штрих 4 / 4 px; бюджет — довгий штрих 12 / 4 px; обидві — chart-reference (ink 60 %)',chosen=True))
s5=f'<div style="display: flex; flex-direction: column; gap: 16px;">{H2("5 · Рішення власника","3 листопада 2026: F19 — Б, F22 — Б (записано в DS-01 п. 26 і DS-07 п. 15). Необрані варіанти прибрано.")}{F19}{F22}</div>'
body=head+s1+s2+s3+s4+s5
html=f'''<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<title>Кольори графіків</title>
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
open(OUT,'w').write(html); print('wrote',OUT,H)
