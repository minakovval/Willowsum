# Owner comment on PlanChartColors: «у кожної групи категорій свій колір, категорії всередині — відтінки».
# Variants sheet «Кольори категорій · відтінки груп» (plain 1280, no app shell). Self-contained (does not read chartcol.py).
# run from $S/tg: python3 cat_shades.py [height]
import sys, math
OUT='/tmp/claude-0/-home-user/ce00d8b4-5791-5ba6-9cf7-6313fce4e28c/scratchpad/restore/p0canvas/project/CatShades.dc.html'
H=int(sys.argv[1]) if len(sys.argv)>1 else 3080
N=' '; INK='#1B2230'; MUTED='#566174'; LINE='#E5E5E2'; SOFT='#F1F1EF'; OTHER='#9AA3AF'
def nb(t): return t.replace(' ',N)
# ---------------- colour maths (OKLab / OKLCH, WCAG contrast, Machado CVD)
def _lin(c): c=c/255; return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
def _rgb(h): return [_lin(int(h[i:i+2],16)) for i in (1,3,5)]
def _lab_lin(r,g,b):
    l=(0.4122214708*r+0.5363325363*g+0.0514459929*b); m=(0.2119034982*r+0.6806995451*g+0.1073969566*b); s=(0.0883024619*r+0.2817188376*g+0.6299787005*b)
    l,m,s=[math.copysign(abs(x)**(1/3),x) for x in (l,m,s)]
    return (0.2104542553*l+0.7936177850*m-0.0040720468*s, 1.9779984951*l-2.4285922050*m+0.4505937099*s, 0.0259040371*l+0.7827717662*m-0.8086757660*s)
def lab(h): return _lab_lin(*_rgb(h))
def lch(h): L,a,b=lab(h); return L,math.hypot(a,b),math.degrees(math.atan2(b,a))%360
def from_lch(L,C,hd):
    """OKLCH → hex, reducing chroma until in sRGB gamut"""
    while True:
        a=C*math.cos(math.radians(hd)); b=C*math.sin(math.radians(hd))
        l=(L+0.3963377774*a+0.2158037573*b)**3; m=(L-0.1055613458*a-0.0638541728*b)**3; s=(L-0.0894841775*a-1.2914855480*b)**3
        rgb=(4.0767416621*l-3.3077115913*m+0.2309699292*s, -1.2684380046*l+2.6097574011*m-0.3413193965*s, -0.0041960863*l-0.7034186147*m+1.7076147010*s)
        if all(-0.0005<=x<=1.0005 for x in rgb) or C<=0.005: break
        C-=0.004
    f=lambda x: 12.92*x if x<=0.0031308 else 1.055*max(x,0)**(1/2.4)-0.055
    return '#'+''.join(f'{round(max(0,min(1,f(max(0,x))))*255):02X}' for x in rgb)
def lum(h): r,g,b=_rgb(h); return 0.2126*r+0.7152*g+0.0722*b
def ratio(a,b): x,y=sorted([lum(a),lum(b)],reverse=True); return (x+0.05)/(y+0.05)
MP=[[0.152286,1.052583,-0.204868],[0.114503,0.786281,0.099216],[-0.003882,-0.048116,1.051998]]
MD=[[0.367322,0.860646,-0.227968],[0.280085,0.672501,0.047413],[-0.011820,0.042940,0.968881]]
def _sim(h,M):
    v=_rgb(h); return [max(0,min(1,sum(M[i][j]*v[j] for j in range(3)))) for i in range(3)]
def dE(a,b,M=None):
    A=_lab_lin(*(_sim(a,M) if M else _rgb(a))); B=_lab_lin(*(_sim(b,M) if M else _rgb(b)))
    return 100*math.dist(A,B)
def dcvd(a,b): return min(dE(a,b,MP),dE(a,b,MD))
# ---------------- groups (BUD-01 п. 1), categories ordered by typical spend (largest → darkest)
PAL={'blue':'#2E69B2','orange':'#C46016','teal':'#089678','mustard':'#B68B16','raspberry':'#B24981','green':'#4D8C3E','violet':'#6A55B8','red':'#C43F3E'}
EXTRA={'indigo':'#3D4FA8','olive':'#7A7F1C'}  # two extra hues for the income groups (not in the series palette)
GROUPS=[
 ('Житло','blue',['Оренда','Комунальні','Дім','Ремонт','Побутова хімія','Сад','Страхування житла']),
 ('Харчування','green',['Продукти','Кафе і ресторани','Доставка їжі']),
 ('Транспорт і авто','orange',['Пальне','Транспорт','Сервіс авто','Страхування авто','Паркування і дороги']),
 ('Зв’язок і підписки','violet',['Зв’язок','Інтернет','Підписки']),
 ('Здоров’я і догляд','red',['Здоров’я','Аптека','Спорт','Краса і догляд','Страхування здоров’я']),
 ('Родина','raspberry',['Діти','Освіта','Одяг','Подарунки','Домашні тварини','Благодійність']),
 ('Відпочинок','teal',['Подорожі','Розваги','Хобі']),
 ('Фінанси і податки','mustard',['Відсотки за кредитами','Податки','Комісії банку','Страхування життя','Штрафи','Інші витрати']),
 ('Дохід від роботи','indigo',['Зарплата','Премії','Підприємництво','Фриланс']),
 ('Інші доходи','olive',['Дивіденди і відсотки','Дохід від оренди','Кешбек','Соціальні виплати','Подарунки отримані','Продаж майна','Інші надходження']),
]
SERVICE=[('Переказ','#9DB2C8'),('Коригування','#9AA3AF')]
HEX={**PAL,**EXTRA}
L_DARK,L_LIGHT=0.40,0.80
def shades(variant,hname,n):
    L0,C0,h0=lch(HEX[hname]); out=[]
    for i in range(n):
        t=i/(n-1) if n>1 else 0; L=L_DARK+(L_LIGHT-L_DARK)*t if n>1 else L0
        if n==2: L=[0.46,0.70][i]
        if n==3: L=[0.42,0.60,0.78][i]
        h=h0; C=C0
        if variant=='Б': h=h0+(-8 if i%2==0 else 8)*(1 if n>1 else 0)
        if variant=='В': C=C0*(1.15-0.55*t)
        out.append(from_lch(L,C,h))
    return out
def cmap(variant):
    m={}
    for g,hn,cs in GROUPS:
        for c,x in zip(cs,shades(variant,hn,len(cs))): m[c]=x
    for c,x in SERVICE: m[c]=x
    return m
def icon_col(bg): return '#FFFFFF' if ratio('#FFFFFF',bg)>=3 else INK
def stats(m):
    wn=99; wc=99
    for g,hn,cs in GROUPS:
        for a,b in zip(cs,cs[1:]): wn=min(wn,dE(m[a],m[b])); wc=min(wc,dcvd(m[a],m[b]))
    dark=sum(1 for g,hn,cs in GROUPS for c in cs if icon_col(m[c])!='#FFFFFF')
    return wn,wc,dark
# ---------------- spending of one month (October 2026, same data as the Planning boards; total € 3 144,46)
OCT=[('Харчування','Продукти',742.30),('Харчування','Кафе і ресторани',498.60),('Фінанси і податки','Відсотки за кредитами',342.24),('Родина','Діти',310.00),('Житло','Комунальні',286.40),('Родина','Одяг',264.90),('Транспорт і авто','Пальне',168.40),('Житло','Дім',128.35),('Відпочинок','Розваги',118.00),('Здоров’я і догляд','Здоров’я',96.40),('Родина','Подарунки',80.00),('Транспорт і авто','Транспорт',46.40),('Зв’язок і підписки','Підписки',42.97),('Зв’язок і підписки','Зв’язок',19.50)]
TOT=sum(v for *_,v in OCT); assert abs(TOT-3144.46)<0.005
GORD=[g for g,_,_ in GROUPS]
CATS_OF={g:cs for g,h,cs in GROUPS}
OCT.sort(key=lambda r:(GORD.index(r[0]),CATS_OF[r[0]].index(r[1])))
def eur(x): return nb('€ '+f'{x:,.2f}'.replace(',',' ').replace('.',','))
TXT='font-family="Inter, sans-serif" font-size="11" fill="#566174"'
def code(h): return f'<code style="font: 10px ui-monospace, monospace; color: {MUTED};">{h}</code>'
def card(inner,extra=''): return f'<div style="background: #FFFFFF; border: 1px solid {LINE}; border-radius: 12px; padding: 16px 18px; {extra}">{inner}</div>'
def sec(t,sub=''): return f'<div style="display: flex; flex-direction: column; gap: 2px;"><span style="color: {MUTED}; font: 500 11px/16px Inter, sans-serif; letter-spacing: .06em;">{t}</span>{f"<span style=\"color: {MUTED}; font-size: 11px; line-height: 15px;\">{nb(sub)}</span>" if sub else ""}</div>'
CW=346  # inner column width
def chip(name,bg):
    ic=icon_col(bg); r=ratio('#FFFFFF',bg)
    flag='' if ic=='#FFFFFF' else f'<span title="біла іконка {r:.2f} : 1 — темна іконка" style="font: 600 10px Inter, sans-serif; color: #7A4505; white-space: nowrap;">{nb("темна іконка")}</span>'
    return f'<div style="display: flex; align-items: center; gap: 6px; min-height: 22px; font-size: 12px;"><span style="width: 16px; height: 16px; flex: none; border-radius: 999px; background: {bg}; color: {ic}; display: grid; place-items: center; font: 700 9px/1 Inter, sans-serif;">●</span><span style="flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{name}</span>{flag}<span style="width: 34px; text-align: right; font: 10px ui-monospace, monospace; color: {MUTED}; font-variant-numeric: tabular-nums;">{nb(f"{r:.1f}".replace(".",","))}</span>{code(bg)}</div>'
def mapblock(m):
    s=''
    for g,hn,cs in GROUPS:
        s+=f'<div style="display: flex; flex-direction: column; padding: 6px 0; border-top: 1px solid {SOFT};"><div style="display: flex; align-items: center; gap: 6px; padding-bottom: 2px;"><span style="width: 10px; height: 10px; border-radius: 2px; background: {HEX[hn]};"></span><b style="font-weight: 600; font-size: 12px;">{g}</b><span style="color: {MUTED}; font-size: 11px;">· тон {code(HEX[hn])}</span></div>'+''.join(chip(c,m[c]) for c in cs)+'</div>'
    s+=f'<div style="display: flex; flex-direction: column; padding: 6px 0; border-top: 1px solid {SOFT};"><b style="font-weight: 600; font-size: 12px;">Службові</b>'+''.join(chip(c,x) for c,x in SERVICE)+'</div>'
    return f'{sec("МАПА КАТЕГОРІЙ","кружок — колір чипа; число — контраст білої іконки")}<div style="display: flex; flex-direction: column;">{s}</div>'
def stackbar(m):
    w=CW; x=0; segs='';
    for g,c,v in OCT:
        sw=w*v/TOT; segs+=f'<div title="{c} · {eur(v)}" style="width: {sw-2:.1f}px; margin-right: 2px; height: 36px; background: {m[c]}; flex: none;"></div>'
    bar=f'<div role="img" aria-label="Витрати жовтня за категоріями" style="display: flex; width: {w}px; border-radius: 4px; overflow: hidden;">{segs}</div>'
    lg=''.join(f'<span style="display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: {MUTED}; white-space: nowrap;"><span style="width: 9px; height: 9px; border-radius: 2px; background: {m[c]};"></span>{nb(c)}</span>' for g,c,v in OCT)
    return f'{sec("СМУГА · ЖОВТЕНЬ 2026",f"{eur(TOT)} · порядок: група → категорія; проміжок 2 px")}{bar}<div style="display: flex; flex-wrap: wrap; gap: 4px 10px;">{lg}</div>'
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
def treemap(m):
    TH=240; gs={}
    for g,c,v in OCT: gs.setdefault(g,[]).append((c,v))
    gl=sorted(gs.items(),key=lambda kv:-sum(v for _,v in kv[1]))
    tm=''
    for g,x,y,w,h in squarify([(g,sum(v for _,v in cs)) for g,cs in gl],0,0,CW,TH):
        cs=sorted(gs[g],key=lambda r:-r[1])
        for c,cx,cy,cw,ch in squarify(cs,x,y,w,h):
            fg=icon_col(m[c])
            tm+=f'<div title="{c} · {eur(dict(cs)[c])}" style="position: absolute; left: {cx+1:.1f}px; top: {cy+1:.1f}px; width: {cw-2:.1f}px; height: {ch-2:.1f}px; box-sizing: border-box; padding: 4px 6px; border-radius: 2px; background: {m[c]}; color: {fg}; font: 600 11px/14px Inter, sans-serif; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">{c if cw>58 and ch>20 else ""}</div>'
        tm+=f'<div style="position: absolute; left: {x:.1f}px; top: {y:.1f}px; width: {w:.1f}px; height: {h:.1f}px; box-sizing: border-box; border: 2px solid #FFFFFF; pointer-events: none;"></div>'
    return f'{sec("TREEMAP","групи (біла рамка) → категорії; підписи на плитках")}<div role="group" aria-label="Treemap витрат жовтня" style="position: relative; width: {CW}px; height: {TH}px;">{tm}</div>'
def donut(parts,r=62,w=22,cx=80,cy=80,gap=1.2):
    tot=sum(v for _,v,_ in parts); a=-90; s=''
    for n,v,c in parts:
        da=360*v/tot; a0=math.radians(a+gap/2); a1=math.radians(a+da-gap/2); big=1 if da-gap>180 else 0
        x0,y0=cx+r*math.cos(a0),cy+r*math.sin(a0); x1,y1=cx+r*math.cos(a1),cy+r*math.sin(a1)
        s+=f'<path d="M{x0:.2f} {y0:.2f} A{r} {r} 0 {big} 1 {x1:.2f} {y1:.2f}" fill="none" stroke="{c}" stroke-width="{w}"><title>{n}</title></path>'; a+=da
    return s
def donuts(m):
    gs={}
    for g,c,v in OCT: gs[g]=gs.get(g,0)+v
    gp=[(g,gs[g],HEX[[h for gg,h,_ in GROUPS if gg==g][0]]) for g in GORD if g in gs]
    fam=[(c,v,m[c]) for g,c,v in OCT if g=='Родина']; ftot=sum(v for _,v,_ in fam)
    d1=f'<svg width="160" height="160" role="img" aria-label="Витрати жовтня за групами" style="display: block;">{donut(gp)}<text x="80" y="78" text-anchor="middle" font-family="Inter, sans-serif" font-size="11" fill="{MUTED}">групи</text><text x="80" y="94" text-anchor="middle" font-family="Inter, sans-serif" font-size="12" font-weight="600" fill="{INK}">{eur(TOT)}</text></svg>'
    d2=f'<svg width="160" height="160" role="img" aria-label="Родина: категорії" style="display: block;">{donut(fam)}<text x="80" y="78" text-anchor="middle" font-family="Inter, sans-serif" font-size="11" fill="{MUTED}">Родина</text><text x="80" y="94" text-anchor="middle" font-family="Inter, sans-serif" font-size="12" font-weight="600" fill="{INK}">{eur(ftot)}</text></svg>'
    l1=''.join(f'<span style="display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: {MUTED}; white-space: nowrap;"><span style="width: 9px; height: 9px; border-radius: 2px; background: {c};"></span>{nb(n)}</span>' for n,v,c in gp)
    l2=''.join(f'<span style="display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: {MUTED}; white-space: nowrap;"><span style="width: 9px; height: 9px; border-radius: 2px; background: {c};"></span>{nb(n)} · {eur(v)}</span>' for n,v,c in fam)
    arrow=f'<span style="color: {MUTED}; font-size: 18px; align-self: center;">→</span>'
    return f'{sec("КІЛЬЦЕ · ГРУПИ → «РОДИНА»","кільце груп — базовий тон групи; клік по групі — категорії групи відтінками")}<div style="display: flex; align-items: center; gap: 6px;">{d1}{arrow}{d2}</div><div style="display: flex; flex-wrap: wrap; gap: 4px 10px;">{l1}</div><div style="display: flex; flex-wrap: wrap; gap: 4px 10px; padding-top: 2px; border-top: 1px solid {SOFT};">{l2}</div>'
NEWH={'red':27,'mustard':125,'orange':83,'olive':49,'green':161,'teal':211,'violet':247,'blue':270,'raspberry':315,'indigo':352}
OLDHEX=dict(HEX); NEWHEX={k:from_lch(0.58,0.15,h) for k,h in NEWH.items()}
import itertools
def gpairs():
    m=cmap('Б'); out={}
    for (a,_,ca),(b,_,cb) in itertools.combinations(GROUPS,2):
        vs=[dE(m[x],m[y]) for x in ca for y in cb if abs(lch(m[x])[0]-lch(m[y])[0])<0.06]
        out[(a,b)]=min(vs) if vs else 99
    return out
HEX.clear(); HEX.update(OLDHEX); P_OLD=gpairs()
HEX.clear(); HEX.update(NEWHEX); P_NEW=gpairs()
FLAG=[('Транспорт і авто','Здоров’я і догляд'),('Транспорт і авто','Родина'),('Здоров’я і догляд','Родина'),('Житло','Дохід від роботи'),('Харчування','Відпочинок')]
def pv(P,k): return P[k] if k in P else P[k[::-1]]
def f1(x): return f"{x:.1f}".replace(".",",")
def sw(g,H): hn=[h for gg,h,_ in GROUPS if gg==g][0]; return f'<span style="display: inline-block; width: 14px; height: 14px; border-radius: 3px; background: {H[hn]}; vertical-align: -2px;"></span>'
rows=''.join(f'<tr><td style="padding: 4px 6px 4px 0; white-space: nowrap;">{sw(a,OLDHEX)}{sw(b,OLDHEX)} → {sw(a,NEWHEX)}{sw(b,NEWHEX)}</td><td style="padding: 4px 8px 4px 0;">{nb(a)} · {nb(b)}</td><td style="padding: 4px 0; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums;">{f1(pv(P_OLD,(a,b)))} → <b style="color: #2E7D4F;">{f1(pv(P_NEW,(a,b)))}</b></td></tr>' for a,b in FLAG)
EXP=[g for g,h,_ in GROUPS[:8]]
near=sorted(((k,v) for k,v in P_NEW.items() if k[0] in EXP and k[1] in EXP),key=lambda kv:kv[1])[:3]
nrows=''.join(f'<tr><td style="padding: 4px 6px 4px 0; white-space: nowrap;">{sw(a,NEWHEX)}{sw(b,NEWHEX)}</td><td style="padding: 4px 8px 4px 0;">{nb(a)} · {nb(b)}</td><td style="padding: 4px 0; text-align: right; font-variant-numeric: tabular-nums;">{f1(pv(P_OLD,(a,b)))} → {f1(v)}</td></tr>' for (a,b),v in near)
pairs=card(f'''<div style="display: flex; flex-direction: column; gap: 8px;"><b style="font-weight: 600;">{nb("Пари з коментаря · найменша різниця відтінків однакової світлоти, ΔE")}</b><table style="border-collapse: collapse; font-size: 12px;">{rows}</table>
<span style="color: {MUTED}; font-size: 12px; line-height: 17px;">{nb("Тони груп рівномірно розставлені по колу (кожна група — свій тон, ≈ 30–50° між сусідами); групи з коментаря рознесені щонайменше через одну. Найближчі сусіди серед груп витрат тепер:")}</span><table style="border-collapse: collapse; font-size: 12px;">{nrows}</table>
<span style="color: {MUTED}; font-size: 12px; line-height: 17px;">{nb("Доходи і витрати не бувають на одному графіку категорій, тому тони доходів стоять поруч із тонами витрат (рожевий «Дохід від роботи» біля червоного «Здоров’я», помаранчеві «Інші доходи» між червоним і жовтим).")}</span></div>''')
cols=''
for v,t,d,H in [('Було','Б · старі тони','тони груп = палітра графіків v1; на коментарі: транспорт / здоров’я / родина, житло / дохід від роботи, харчування / відпочинок надто схожі',OLDHEX),('Стало','Б · нові тони груп','та сама побудова відтінків (світлота 0,40 → 0,80, тон ±8°), нові базові тони груп',NEWHEX)]:
    HEX.clear(); HEX.update(H)
    m=cmap('Б'); wn,wc,dark=stats(m)
    head=f'''<div style="display: flex; flex-direction: column; gap: 6px;"><div style="display: flex; align-items: center; gap: 10px;"><span style="padding: 3px 10px; border-radius: 999px; background: {'#0B2545' if v=='Стало' else '#C9CED6'}; color: #FFFFFF; font: 600 13px Inter, sans-serif;">{v}</span><b style="font: 600 17px/22px 'Inter Tight', Inter, sans-serif;">{nb(t)}</b></div><span style="color: {MUTED}; font-size: 12px; line-height: 17px;">{nb(d)}</span>
<div style="display: flex; flex-wrap: wrap; gap: 4px 10px;">{''.join(f'<span style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; white-space: nowrap;"><span style="width: 12px; height: 12px; border-radius: 3px; background: {H[hn]};"></span>{nb(g)} {code(H[hn])}</span>' for g,hn,_ in GROUPS)}</div>
<div style="display: flex; gap: 12px; font-size: 11px; color: {MUTED};"><span>{nb("сусіди в групі: ΔE ≥ "+f1(wn))}</span><span>{nb("дальтонізм ΔE ≥ "+f1(wc))}</span><span>{nb(f"темна іконка: {dark}")}</span></div></div>'''
    cols+=f'<div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 14px;">{card(head)}{card(f"<div style=\"display: flex; flex-direction: column; gap: 8px;\">{stackbar(m)}</div>")}{card(f"<div style=\"display: flex; flex-direction: column; gap: 8px;\">{treemap(m)}</div>")}{card(f"<div style=\"display: flex; flex-direction: column; gap: 8px;\">{donuts(m)}</div>")}{card(mapblock(m))}</div>'
cols+=f'<div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 14px;">{pairs}</div>'
HEX.clear(); HEX.update(NEWHEX)
hues=''.join(f'<span style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; white-space: nowrap;"><span style="width: 14px; height: 14px; border-radius: 3px; background: {HEX[hn]};"></span>{nb(g)} {code(HEX[hn])}</span>' for g,hn,_ in GROUPS)
head=f'''<div style="display: flex; flex-direction: column; gap: 6px;"><span style="color: {MUTED}; font-size: 13px;">Планування · кольори категорій · обрано Б · нові тони груп</span>
<h1 style="margin: 0; font: 600 32px/40px 'Inter Tight', Inter, sans-serif;">Кольори категорій · відтінки груп</h1>
<span style="color: {MUTED}; font-size: 15px; line-height: 22px; max-width: 1060px;">{nb("Кожна група категорій (BUD-01 п. 1) має свій тон: 10 груп — 10 тонів, рівномірно розставлених по колу; службові — сірі. Категорії всередині групи — відтінки тону групи за варіантом Б (обрано). Тони 8 груп витрат — це й палітра графіків. Ті самі дані жовтня 2026 (€ 3 144,46): було → стало.")}</span>
<div style="display: flex; flex-wrap: wrap; gap: 6px 16px; padding-top: 6px;">{hues}</div></div>'''
trade=card(f'''<div style="display: flex; flex-direction: column; gap: 6px;"><b style="font-weight: 600;">{nb("Компроміс")}</b><span style="color: {MUTED}; font-size: 13px; line-height: 19px;">{nb("Відтінки одного тону гірше розрізняються між собою, ніж різні тони: сусідні категорії однієї групи (напр. «Продукти» і «Кафе і ресторани») у смузі чи treemap легко сплутати, особливо людям з порушенням кольорового зору. Зате група читається одразу. Пом’якшення: проміжок 2 px між сегментами і біла рамка групи в treemap; підписи на плитках і в підказці; легенда в тому самому порядку, що й сегменти (група → категорія, від темного до світлого); у графіку з багатьма категоріями однієї групи — не більше 4 відтінків, решта → «Інші · N» сірим; таблиця під кожним графіком. Відтінки зі світлотою > 0,70 мають контраст білої іконки < 3 : 1 — на таких чипах іконка темна (#1B2230).")}</span></div>''','background: #FFFBF3; border-color: #F1E3C8;')
body=head+trade+f'<div style="display: flex; gap: 16px; align-items: flex-start;">{cols}</div>'
html=f'''<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<title>Кольори категорій · відтінки груп</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;family=Inter+Tight:wght@600&amp;display=swap">
<style>body{{margin:0}}</style>
</helmet>
<div style="position: relative; width: 1280px; height: {H}px; overflow: hidden; font-family: Inter, system-ui, sans-serif; font-size: 14px; line-height: 20px; color: {INK}; background: #FAFAF8;">
<main style="padding: 40px; display: flex; flex-direction: column; gap: 20px;">
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
print(stats(cmap('Б'))); import json; json.dump(cmap('Б'),open('../catcol_B.json','w'),ensure_ascii=False,indent=0); print({g:HEX[h] for g,h,_ in GROUPS})
print('wrote',OUT,H)
