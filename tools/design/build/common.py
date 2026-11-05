import json, os, re
HERE = os.path.dirname(__file__)
ICONS = json.load(open(os.path.join(HERE, 'icons.json')))
NB = ' '
MINUS = '−'

def ic(name, size=16, sw=1.8, cls='', label=None):
    inner = ICONS[name]
    a = f' role="img" aria-label="{label}"' if label else ' aria-hidden="true"'
    c = f' class="{cls}"' if cls else ''
    return (f'<svg{c} width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"{a}>{inner}</svg>')

def eur(s, sign=''):
    """s like '128 450,00' -> '128 450,00 €' with NBSP; sign '-' or '+'."""
    sg = MINUS if sign == '-' else ('+' if sign == '+' else '')
    return sg + s.replace(' ', NB) + NB + '€'

def uah(s, sign=''):
    sg = MINUS if sign == '-' else ('+' if sign == '+' else '')
    return sg + s.replace(' ', NB) + NB + '₴'

MARK = ('<svg width="{s}" height="{s}" viewBox="0 0 64 64"{a}><path class="mk-l" d="M8 56 V32 A24 24 0 0 1 32 8 H56 V32 A24 24 0 0 1 32 56 Z"/>'
        '<path class="mk-m" d="M8 56 V40 A16 16 0 0 1 24 24 H40 V40 A16 16 0 0 1 24 56 Z"/>'
        '<path class="mk-s" d="M8 56 V48 A8 8 0 0 1 16 40 H24 V48 A8 8 0 0 1 16 56 Z"/></svg>')

def mark(s=24, label=False):
    return MARK.format(s=s, a=' role="img" aria-label="Willowsum"' if label else ' aria-hidden="true"')

FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;family=Inter+Tight:wght@600&amp;display=swap">'

# Shared look, taken from the owner-edited canvas «Willowsum · P0 оболонка і системні екрани».
# Colours come from tokens.css (var(--…)); the few canvas colours that have no token yet are local
# variables here, with a dark-theme value each.
CSS = r"""
:root{--ctl:var(--border-control);--chk:var(--border-control);--tint:var(--tint-info);--warn-bg:var(--tint-warning);--warn:var(--on-warning);--pos-bg:var(--tint-positive);--neg-bg:var(--tint-negative);--skel:var(--skeleton);--inset:var(--surface-inset);--grid:var(--chart-grid);--ca:var(--series-1);--cb:var(--series-2);--cplan:var(--series-3);--cc:var(--series-4);--danger-line:var(--loss);--drop-line:var(--border-control);--drop-bg:var(--surface-inset);--elev:var(--shadow-popover);--dlg:var(--shadow-dialog);--seg-sh:0 1px 2px rgba(11,37,69,.12);--toast:var(--ink);--on-toast:var(--surface-100)}
[data-theme="dark"]{--seg-sh:0 1px 2px rgba(0,0,0,.4)}
*{box-sizing:border-box}
html,body{margin:0;background:var(--surface-100)}
body{padding:24px;color:var(--ink);font:400 14px/20px Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
svg{flex:none}
button,input,select{font:inherit;color:inherit}
a{color:var(--link);text-decoration:none}
.tab{font-variant-numeric:tabular-nums}
.muted{color:var(--ink-muted)}
.mk-l{fill:var(--mark-large)}.mk-m{fill:var(--mark-middle)}.mk-s{fill:var(--mark-small)}
/* layout helpers */
.stack{display:flex;flex-direction:column;gap:20px}
.row{display:flex;flex-wrap:wrap;gap:16px 24px;align-items:flex-start}
.row.c{align-items:center}
.cell{display:flex;flex-direction:column;gap:8px;min-width:0}
.cap{font:500 12px/16px Inter,sans-serif;color:var(--ink-muted)}
.sh{font:600 12px/16px Inter,sans-serif;color:var(--ink-muted);letter-spacing:.04em;text-transform:uppercase}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px 24px}
.grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px 24px}
.ring{outline:var(--focus-ring-width,3px) solid var(--focus);outline-offset:var(--focus-ring-offset,2px)}
/* hit area: every control reaches 44 x 44 px (touch-target) even when it is drawn smaller */
.btn,.ib,.ptab,.pt,.seg>span,.fchip,.tg,.st,.vs>span,.cs{position:relative}
.btn::after,.ib::after,.ptab::after,.pt::after,.seg>span::after,.fchip::after,.tg::after,.vs>span::after,.cs::after{content:"";position:absolute;left:50%;top:50%;width:max(100%,var(--touch-target,44px));height:max(100%,var(--touch-target,44px));transform:translate(-50%,-50%)}
.ring-in{box-shadow:inset 0 0 0 2px var(--focus)}
/* type */
.h1{margin:0;font:600 28px/34px "Inter Tight",Inter,sans-serif;letter-spacing:-.02em}
.h2{margin:0;font:600 22px/28px "Inter Tight",Inter,sans-serif;letter-spacing:-.015em}
.h3{margin:0;font:600 18px/24px "Inter Tight",Inter,sans-serif;letter-spacing:-.01em}
.lbl{font:500 13px/16px Inter,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-muted)}
.sub{font:400 12px/16px Inter,sans-serif;color:var(--ink-muted)}
.big{font:600 32px/40px "Inter Tight",Inter,sans-serif;font-variant-numeric:tabular-nums}
.amt{font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
/* buttons (canvas: 40 px, radius 8, 1 px control line) */
.btn{height:40px;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:0 14px;border:1px solid var(--ctl);border-radius:8px;background:var(--surface-200);color:var(--ink);font:600 14px/20px Inter,sans-serif;white-space:nowrap;cursor:pointer}
.btn.pri{border:0;padding:0 16px;background:var(--brand);color:var(--on-brand)}
.btn.pri.hov{background:var(--brand-hover)}.btn.pri.prs{background:var(--brand-pressed)}
.btn.sec.hov{background:var(--surface-300)}.btn.sec.prs{background:var(--line)}
.btn.quiet{border:0;padding:0 12px;background:transparent;color:var(--link)}
.btn.quiet.hov{background:var(--surface-300);text-decoration:underline}
.btn.danger{border-color:var(--danger-line);color:var(--loss)}
.btn.danger.hov{background:var(--neg-bg)}
.btn.dis{border:0;background:var(--disabled-bg);color:var(--disabled-ink);cursor:not-allowed}
.btn.sm{height:32px;padding:0 12px;font-size:13px}
.btn.lg{height:48px;border-radius:10px;font-size:15px}
.btn.wide{width:100%}
.spin{width:14px;height:14px;border-radius:999px;border:2px solid currentColor;border-right-color:transparent;display:inline-block}
.ib{width:36px;height:36px;display:inline-grid;place-items:center;border:0;border-radius:8px;background:transparent;color:var(--ink-muted);position:relative;padding:0;cursor:pointer}
.ib.c{width:28px;height:28px;border-radius:4px}
.ib.hov,.ib.on{background:var(--surface-300);color:var(--ink)}
.ib.dis{color:var(--disabled-ink)}
.ib .dot{position:absolute;top:5px;right:5px;width:6px;height:6px;border-radius:999px;background:var(--brand-2)}
/* surfaces */
.card{background:var(--surface-200);border:1px solid var(--line);border-radius:8px}
.card.pad{padding:20px 24px}
.card.raised{box-shadow:var(--shadow-raised)}
.card.sunken{background:var(--surface-300);border-color:transparent}
.inset{background:var(--inset);border-radius:8px;padding:12px 14px}
.panel{background:var(--surface-200);border:1px solid var(--line);border-radius:8px;box-shadow:var(--elev);padding:4px}
.hr{height:1px;background:var(--line);margin:4px 8px}
/* tags / badges (canvas: 20 px, radius 4, 11 px 500) */
.tag{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 6px;border-radius:4px;background:var(--surface-300);color:var(--ink-muted);font:500 11px/16px Inter,sans-serif;white-space:nowrap}
.tag.info{background:var(--tint);color:var(--link)}
.tag.warn{background:var(--warn-bg);color:var(--warn)}
.tag.pos{background:var(--pos-bg);color:var(--gain)}
.tag.neg{background:var(--neg-bg);color:var(--loss)}
.tag.brand{background:var(--tint);color:var(--brand)}
.cnt{min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--brand);color:var(--on-brand);font:600 11px/18px Inter,sans-serif;text-align:center;font-variant-numeric:tabular-nums}
/* page tabs (pills) */
.ptabs{display:flex;gap:4px}
.ptab{height:36px;display:inline-flex;align-items:center;gap:6px;padding:0 14px;border-radius:999px;color:var(--ink-muted);font:500 14px/20px Inter,sans-serif;white-space:nowrap}
.ptab.on{background:var(--surface-300);color:var(--brand);font-weight:600}
.ptab.hov{color:var(--ink)}
.ptab.dis{color:var(--disabled-ink)}
/* segmented */
.seg{align-self:flex-start;display:inline-flex;gap:2px;padding:3px;border-radius:8px;background:var(--surface-300)}
.seg>span,.seg>button{height:32px;display:inline-flex;align-items:center;gap:6px;padding:0 12px;border:0;border-radius:6px;background:transparent;color:var(--ink-muted);font:500 13px/18px Inter,sans-serif;white-space:nowrap}
.seg>.on{background:var(--surface-200);box-shadow:var(--seg-sh);color:var(--ink);font-weight:600}
.seg>.hov{color:var(--ink)}
/* fields */
.fld{display:flex;flex-direction:column;gap:6px;min-width:0}
.fld>.l{font:500 13px/16px Inter,sans-serif}
.fld>.l .req{color:var(--loss)}
.inp{height:40px;display:flex;align-items:center;gap:8px;padding:0 12px;border:1px solid var(--ctl);border-radius:8px;background:var(--surface-200);color:var(--ink);white-space:nowrap;overflow:hidden;font:400 14px/20px Inter,sans-serif}
.inp .ph{color:var(--ink-muted)}
.inp.hov{border-color:var(--ink-muted)}
.inp.foc{border-color:var(--ink);outline:3px solid var(--focus);outline-offset:2px}
.inp.err{border-color:var(--loss)}
.inp.dis{border-color:transparent;background:var(--disabled-bg);color:var(--disabled-ink)}
.inp.ro{background:var(--surface-100)}
.hint{font-size:13px;line-height:18px;color:var(--ink-muted)}
.errt{font-size:13px;line-height:18px;color:var(--loss);display:flex;gap:6px;align-items:center}
.search{height:36px;display:flex;align-items:center;gap:8px;padding:0 10px;border:1px solid var(--ctl);border-radius:8px;background:var(--surface-200);color:var(--ink-muted);white-space:nowrap;overflow:hidden}
.chk{width:16px;height:16px;flex:none;border-radius:4px;border:1.5px solid var(--chk);background:var(--surface-200);display:inline-grid;place-items:center;color:var(--on-brand)}
.chk.on{background:var(--brand);border-color:var(--brand)}
.chk.dis{background:var(--disabled-bg);border-color:transparent}
/* menus */
.mi{display:flex;align-items:center;gap:10px;height:38px;padding:0 10px;border-radius:6px;color:var(--ink);font-size:14px;white-space:nowrap}
.mi>.i{color:var(--ink-muted);display:grid}
.mi.hov{background:var(--surface-300)}
.mi.dz,.mi.dz>.i{color:var(--loss)}
.mi.dis,.mi.dis>.i{color:var(--disabled-ink)}
.mi .k{margin-left:auto;color:var(--ink-muted);font-size:12px}
.mh{padding:8px 10px 4px;font:600 11px/16px Inter,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-muted)}
/* table rows */
.th{display:flex;align-items:center;gap:12px;height:40px;padding:0 16px;border-bottom:1px solid var(--line);color:var(--ink-muted);font:500 12px/16px Inter,sans-serif;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
.tr{display:flex;align-items:center;gap:12px;min-height:52px;padding:0 16px;border-bottom:1px solid var(--surface-300)}
.tr:last-child{border-bottom:0}
.tr.hov{background:var(--surface-100)}
.tr.sel{background:var(--tint)}
.logo{width:32px;height:32px;flex:none;border-radius:8px;border:1px solid var(--line);background:var(--surface-200);display:grid;place-items:center}
.logo>span{width:19px;height:19px;border-radius:6px;color:#FFFFFF;display:grid;place-items:center;font:700 11px Inter,sans-serif}
.logo.ini{border:0;background:var(--surface-300);color:var(--ink);font:600 12px Inter,sans-serif}
.catc{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 8px 0 4px;border-radius:999px;background:var(--surface-300);font-size:12px;white-space:nowrap}
.catc>span{width:18px;height:18px;border-radius:999px;color:#FFFFFF;display:grid;place-items:center}
.catc.none{background:transparent;border:1px dashed var(--ctl);padding:0 8px;color:var(--ink-muted)}
.t1{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.t2{color:var(--ink-muted);font-size:12px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* progress */
.bar{position:relative;height:6px;border-radius:999px;background:var(--surface-300)}
.bar>i{display:block;height:6px;border-radius:999px}
.bar>.mark{position:absolute;top:-3px;bottom:-3px;width:2px;margin-left:-1px;border-radius:1px;background:var(--ink)}
/* skeleton */
.sk{display:block;background:var(--skel);border-radius:6px}
/* nav */
.nav-i{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 10px;border-radius:4px;color:var(--ink-muted);font-weight:500;white-space:nowrap}
.nav-i.on{background:var(--surface-300);color:var(--brand)}
.nav-s{display:flex;align-items:center;gap:10px;min-height:36px;padding:0 10px 0 22px;border-radius:4px;color:var(--ink-muted)}
.nav-s.on{background:var(--surface-100);color:var(--brand);font-weight:600}
.av{width:32px;height:32px;flex:none;border-radius:999px;background:var(--brand-2);color:#FFFFFF;display:grid;place-items:center;font:600 13px/1 Inter,sans-serif}
[data-theme="dark"] .av{color:var(--surface-100)}
/* chart text */
.ax{font:400 11px Inter,sans-serif;fill:var(--ink-muted)}
.gl{stroke:var(--grid);stroke-width:1}
.leg{display:flex;flex-wrap:wrap;gap:8px 20px;font-size:13px}
.leg>span{display:inline-flex;align-items:center;gap:8px}
.key{width:12px;height:12px;border-radius:2px;flex:none}
.up{color:var(--gain);font-weight:500;white-space:nowrap}
.dn{color:var(--loss);font-weight:500;white-space:nowrap}
.hatch{background:repeating-linear-gradient(45deg,var(--ink-muted) 0 3px,var(--surface-200) 3px 6px)}
"""

def page(group, height, subtitle, body, css='', width=None):
    w = f' width={width or 900}'
    return (f'<!-- @dsCard group="{group}" height={height}{w} subtitle="{subtitle}" -->\n'
            '<!doctype html><html lang="uk"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">' + FONTS +
            '<style>' + CSS + css + '</style></head><body>\n' + re.sub(r'align-items:baseline;gap:12px(?!;flex-wrap)', 'align-items:baseline;gap:4px 12px;flex-wrap:wrap', body) + '\n</body></html>\n')
