import math
def srgb2lin(c): return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
def lin2srgb(c): return 12.92*c if c<=0.0031308 else 1.055*c**(1/2.4)-0.055
def hex2oklch(h):
    h=h.lstrip('#'); r,g,b=[srgb2lin(int(h[i:i+2],16)/255) for i in (0,2,4)]
    l=0.4122214708*r+0.5363325363*g+0.0514459929*b; m=0.2119034982*r+0.6806995451*g+0.1073969566*b; s=0.0883024619*r+0.2817188376*g+0.6299787005*b
    l,m,s=[x**(1/3) for x in (l,m,s)]
    L=0.2104542553*l+0.7936177850*m-0.0040720468*s; a=1.9779984951*l-2.4285922050*m+0.4505937099*s; bb=0.0259040371*l+0.7827717662*m-0.8086757660*s
    return L, math.hypot(a,bb), math.degrees(math.atan2(bb,a))%360
def oklch2rgb(L,C,H):
    a=C*math.cos(math.radians(H)); b=C*math.sin(math.radians(H))
    l=(L+0.3963377774*a+0.2158037573*b)**3; m=(L-0.1055613458*a-0.0638541728*b)**3; s=(L-0.0894841775*a-1.2914855480*b)**3
    r=4.0767416621*l-3.3077115913*m+0.2309699292*s; g=-1.2684380046*l+2.6097574011*m-0.3413193965*s; bl=-0.0041960863*l-0.7034186147*m+1.7076147010*s
    return r,g,bl
def oklch2hex(L,C,H):
    lo,hi=0,C
    rgb=oklch2rgb(L,C,H)
    if not all(-1e-6<=x<=1+1e-6 for x in rgb):
        for _ in range(30):
            mid=(lo+hi)/2; rgb=oklch2rgb(L,mid,H)
            if all(-1e-6<=x<=1+1e-6 for x in rgb): lo=mid
            else: hi=mid
        rgb=oklch2rgb(L,lo,H)
    return '#'+''.join('%02X'%round(max(0,min(1,lin2srgb(max(0,x))))*255) for x in rgb)
def shades(tone,n):
    L0,C,H=hex2oklch(tone)
    Ls={1:[0.58],2:[0.46,0.70],3:[0.42,0.60,0.78]}.get(n) or [0.40+0.40*i/(n-1) for i in range(n)]
    return [oklch2hex(L,C,H+(-8 if i%2==0 else 8)) for i,L in enumerate(Ls)]
def lum(h):
    h=h.lstrip('#');r,g,b=[srgb2lin(int(h[i:i+2],16)/255) for i in (0,2,4)];return 0.2126*r+0.7152*g+0.0722*b
def cr(a,b):
    x,y=sorted([lum(a),lum(b)],reverse=True);return (x+.05)/(y+.05)
if __name__=='__main__':
    for t in ['#5872D2','#0E9161','#9B5BB6','#BA4E84']: print(t, hex2oklch(t), shades(t,2), shades(t,3), shades(t,4))
    print(hex2oklch('#045D2F'),hex2oklch('#099673'),hex2oklch('#494BAB'),hex2oklch('#3968C2'))

DARK_BG = '#12305A'
def dark_of(hexc, Lmin=None):
    """Same hue/chroma, lightness raised until >= 3:1 on the dark card."""
    L, C, H = hex2oklch(hexc)
    if Lmin is not None: L = max(L, Lmin)
    c = oklch2hex(L, C, H)
    while cr(c, DARK_BG) < 3.0 and L < 0.95:
        L += 0.01; c = oklch2hex(L, C, H)
    return c
def dark_shade(hexc):
    L, C, H = hex2oklch(hexc)
    Ld = min(0.88, max(0.60, 0.60 + 0.7 * (L - 0.40)))
    return dark_of(oklch2hex(Ld, C, H))
