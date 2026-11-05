# F1 resolved (owner 2026-11-03): final limit-usage colour scale — shared by plan_bud_lib.py, plan_c.py, plan_palette.py
# usage 0–100 %: continuous OKLCH gradient; overspend: 5 shades by significance (overspend € ÷ Σ optional limits) + tail beyond the bar
import math as _m, colorsys as _cs
from decimal import Decimal as _FD
def _s2l(c): return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
def _l2s(c): return 12.92*c if c<=0.0031308 else 1.055*c**(1/2.4)-0.055
def f1_oklch(hx):
    hx=hx.lstrip('#'); r,g,b=(_s2l(int(hx[i:i+2],16)/255) for i in (0,2,4))
    l=(0.4122214708*r+0.5363325363*g+0.0514459929*b)**(1/3); m=(0.2119034982*r+0.6806995451*g+0.1073969566*b)**(1/3); s=(0.0883024619*r+0.2817188376*g+0.6299787005*b)**(1/3)
    L=0.2104542553*l+0.7936177850*m-0.0040720468*s; A=1.9779984951*l-2.4285922050*m+0.4505937099*s; B=0.0259040371*l+0.7827717662*m-0.8086757660*s
    return L,_m.hypot(A,B),_m.degrees(_m.atan2(B,A))%360
def f1_hex(L,C,h):
    for _ in range(80):
        A=C*_m.cos(_m.radians(h)); B=C*_m.sin(_m.radians(h))
        l=(L+0.3963377774*A+0.2158037573*B)**3; m=(L-0.1055613458*A-0.0638541728*B)**3; s=(L-0.0894841775*A-1.2914855480*B)**3
        rgb=[4.0767416621*l-3.3077115913*m+0.2309699292*s,-1.2684380046*l+2.6097574011*m-0.3413193965*s,-0.0041960863*l-0.7034186147*m+1.7076147010*s]
        if all(-1e-4<=v<=1.0001 for v in rgb): break
        C*=0.97
    return '#'+''.join(f'{round(max(0,min(1,_l2s(max(0,v))))*255):02X}' for v in rgb)
F1_STOPS=[(0,'#0E7A3B'),(30,'#34A853'),(55,'#7CC242'),(75,'#C9C21A'),(95,'#FBBC05'),(100,'#FBBC05')]
def f1_grad(p):
    p=max(0.0,min(100.0,float(p)))
    for (a,ca),(b,cb) in zip(F1_STOPS,F1_STOPS[1:]):
        if p<=b:
            if ca==cb: return ca
            t=(p-a)/(b-a) if b>a else 0; L1,C1,h1=f1_oklch(ca); L2,C2,h2=f1_oklch(cb)
            dh=((h2-h1+180)%360)-180
            return f1_hex(L1+(L2-L1)*t,C1+(C2-C1)*t,h1+dh*t)
    return F1_STOPS[-1][1]
# owner 03.11 (changed): 8 significance levels, boundaries 5 / 10 / 20 / 50 / 100 / 200 / 500 % of Σ optional limits
F1_SHADES=['#E3A39B','#DE7A6F','#E5584A','#F2281A','#D21C10','#B5180C','#94130A','#7A0F08']
_B=[0,5,10,20,50,100,200,500]
F1_STEPS=[(_FD(a),_FD(b) if b else None) for a,b in zip(_B,_B[1:]+[None])]
F1_TH=['менше 5 %','5–10 %','10–20 %','20–50 %','50–100 %','100–200 %','200–500 %','500 % і більше']
def f1_share(over,optsum): return _FD(over)*100/_FD(optsum) if _FD(optsum) else _FD(100)
def f1_level(over,optsum):
    sh=f1_share(over,optsum)
    for i,(lo,hi) in enumerate(F1_STEPS):
        if hi is None or sh<hi: return i+1
    return len(F1_SHADES)
def f1_tail(share):
    """tail length 0..1 of the tail zone: log-like in the significance share, capped at 500 %"""
    s=float(share); return max(0.12,min(1.0,_m.log1p(s)/_m.log1p(500)))
# text ink: darker shade of the same hue on white (WCAG ≥ 4.5 : 1)
def _lin(c): c=c/255; return c/12.92 if c<=0.03928 else ((c+0.055)/1.055)**2.4
def f1_lum(h): h=h.lstrip('#'); r,g,b=(int(h[i:i+2],16) for i in (0,2,4)); return 0.2126*_lin(r)+0.7152*_lin(g)+0.0722*_lin(b)
def f1_ratio(h,bg='#FFFFFF'): a,b=f1_lum(h),f1_lum(bg); return (max(a,b)+0.05)/(min(a,b)+0.05)
def f1_ink(hx):
    if f1_ratio(hx)>=4.5: return hx
    hx2=hx.lstrip('#'); r,g,b=(int(hx2[i:i+2],16)/255 for i in (0,2,4)); h,l,s=_cs.rgb_to_hls(r,g,b)
    while l>0:
        l-=0.005; c='#'+''.join(f'{round(v*255):02X}' for v in _cs.hls_to_rgb(h,l,s))
        if f1_ratio(c)>=4.5: return c
    return '#000000'
F1_GREY='#7D8794'; F1_NONE='#B8BEC6'; F1_MUTED='#566174'; F1_TRACK='#F1F1EF'; F1_TAILW=44
def f1_mk(g,c,sz=12):
    fs=sz+6 if g=='•' else sz
    return f'<span aria-hidden="true" style="width: 12px; flex: none; display: inline-flex; justify-content: center; color: {c}; font: 700 {fs}px/1 Inter, sans-serif;">{g}</span>'
def f1_eur(x):
    x=_FD(x).quantize(_FD('0.01')); s=f'{abs(x):,.2f}'.replace(',',' ').replace('.',',')
    return ('−' if x<0 else '')+'€ '+s.replace(' ',' ')
def f1_state(L,S,mand=False,optsum=None):
    """returns (key, pct, level, share): key none|ramp|used_m|used_o|over"""
    L=_FD(L); S=_FD(S)
    if S==0: return ('none',0,0,0)
    if L==0: sh=f1_share(S,optsum or 1); return ('over',None,f1_level(S,optsum or 1),sh)
    p=S*100/L
    if S<L: return ('ramp',p,0,0)
    if S==L: return ('used_m',100,0,0) if mand else ('used_o',100,1,0)
    sh=f1_share(S-L,optsum or L); return ('over',p,f1_level(S-L,optsum or L),sh)
def f1_colours(st):
    k,p,lv,sh=st
    if k=='none': return F1_NONE,F1_MUTED
    if k=='ramp': c=f1_grad(p); return c,f1_ink(c)
    if k=='used_m': return F1_GREY,F1_MUTED
    c=F1_SHADES[lv-1]; return c,f1_ink(c)
def f1_bar(st,h=6,tail=True):
    k,p,lv,sh=st; c,_=f1_colours(st)
    fill=0 if k=='none' else (100 if k in ('used_m','used_o','over') else min(100,float(p)))
    trk=f'<span style="flex: 1; min-width: 0; height: {h}px; border-radius: 999px; background: {F1_TRACK}; overflow: hidden; display: block;"><span style="display: block; width: {fill:.1f}%; height: {h}px; border-radius: 999px; background: {c};"></span></span>'
    tz=''
    if tail:
        tf=f1_tail(sh) if k=='over' else 0
        tz=f'<span style="width: {F1_TAILW}px; flex: none; height: {h}px; display: flex; align-items: center; padding-left: 2px; box-sizing: border-box;">'+(f'<span style="display: block; width: {tf*100:.1f}%; height: {h}px; border-radius: 0 999px 999px 0; background: {c};"></span>' if tf else '')+'</span>'
    vt={'none':'не почато','ramp':'є залишок' if (p or 0)<80 else 'майже вичерпано','used_m':'ліміт вичерпано','used_o':'вичерпано','over':'перевищено'}[k]
    return f'<span role="progressbar" aria-valuenow="{int(min(100,float(p or 0)))}" aria-valuemin="0" aria-valuemax="100" aria-valuetext="{vt}" style="flex: 1; min-width: 0; display: flex; align-items: center;">{trk}{tz}</span>'
def f1_pct(p):
    v=_FD(p).quantize(_FD('1'))
    return '&lt;1' if 0<_FD(p)<_FD('0.5') else str(int(v))
def f1_label(st,L=None,S=None,w=None,right=True):
    k,p,lv,sh=st; c,tc=f1_colours(st)
    if k=='none': g,t='•','не почато'
    elif k=='ramp': g,t=('•' if p<80 else '!'),(('є залишок' if p<80 else 'майже вичерпано')+f' · {f1_pct(p)} %')
    elif k=='used_m': g,t='✓','ліміт вичерпано'
    elif k=='used_o': g,t='!','вичерпано'
    else:
        t='перевищено'
        if L is not None and S is not None:
            o=_FD(S)-_FD(L); t+=f' · {f1_eur(-o)}'+(f' (+{f1_pct(o*100/_FD(L))} %)' if _FD(L) else '')
        g='✕'
    ws=f'width: {w}px; justify-content: {"flex-end" if right else "flex-start"};' if w else ''
    mc=c if k=='none' else tc
    # C9 / e825eecc: the word lives in its own fixed column, never over the bar — clipped with ellipsis, full text in the tooltip
    tt=t.replace('&lt;','<').replace('\u00a0',' ')
    return f'<span title="{tt}" style="{ws} flex: none; min-width: 0; overflow: hidden; display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: {tc}; white-space: nowrap; font-weight: {600 if k in ("over","used_o") else 500};">{f1_mk(g,mc)}<span style="min-width: 0; overflow: hidden; text-overflow: ellipsis;">{t}</span></span>'
def f1_legend():
    stops=','.join(f'{f1_grad(x)} {x}%' for x in range(0,101,5))
    strip=f'<span style="display: inline-flex; flex-direction: column; gap: 2px;"><span style="width: 160px; height: 6px; border-radius: 999px; background: linear-gradient(90deg, {stops});"></span><span style="display: flex; justify-content: space-between; width: 160px; font-size: 10px; line-height: 12px;"><span>0</span><span>80</span><span>100 %</span></span></span>'
    sh=''.join(f'<span title="{t}" style="width: 10px; height: 6px; border-radius: 999px; background: {c};"></span>' for c,t in zip(F1_SHADES,F1_TH))
    it=lambda inner: f'<span style="display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;">{inner}</span>'
    return ('<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; font-size: 12px; color: #566174;">'
        +it(f'{strip}<span>• є залишок · ! майже вичерпано від 80 %</span>')
        +it(f'<span style="width: 14px; height: 6px; border-radius: 999px; background: {F1_NONE};"></span>• не почато')
        +it(f'<span style="width: 14px; height: 6px; border-radius: 999px; background: {F1_GREY};"></span>✓ ліміт вичерпано · обов’язкова')
        +it(f'<span style="display: inline-flex; gap: 2px;">{sh}</span>✕ перевищено · рівень 1–8 — від суми лімітів необов’язкових: &lt;5 · 10 · 20 · 50 · 100 · 200 · 500 · ≥500 %')
        +'</div>')
# G1 (owner «Є»): goal progress bar colour = point of a yellow→green OKLCH gradient at the goal's fill %
G1_STOPS=[(0,'#FFD000'),(25,'#E6CF1A'),(55,'#9ACD32'),(80,'#4CAF50'),(100,'#2E7D32')]
G1_DONE='#2E7D32'; G1_PAUSE='#C5CAD1'
def g1_grad(p):
    p=max(0.0,min(100.0,float(p)))
    for (a,ca),(b,cb) in zip(G1_STOPS,G1_STOPS[1:]):
        if p<=b:
            t=(p-a)/(b-a); L1,C1,h1=f1_oklch(ca); L2,C2,h2=f1_oklch(cb); dh=((h2-h1+180)%360)-180
            return f1_hex(L1+(L2-L1)*t,C1+(C2-C1)*t,h1+dh*t)
    return G1_DONE
