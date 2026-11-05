from common import *
from oklch import shades, dark_shade
import comps5
C = {}
CATS = [('chart-cat-1','Житло'),('chart-cat-2','Харчування'),('chart-cat-3','Транспорт і авто'),('chart-cat-4',"Зв'язок і підписки"),('chart-cat-5',"Здоров'я і догляд"),('chart-cat-6','Родина'),('chart-cat-7','Відпочинок'),('chart-cat-8','Фінанси і податки'),('chart-group-income-1','Дохід від роботи'),('chart-group-income-2','Інші доходи')]
LIGHT = {'chart-cat-1':'#5872D2','chart-cat-2':'#0E9161','chart-cat-3':'#9C7305','chart-cat-4':'#097FCD','chart-cat-5':'#C35047','chart-cat-6':'#9B5BB6','chart-cat-7':'#0F899B','chart-cat-8':'#678800','chart-group-income-1':'#BA4E84','chart-group-income-2':'#BE590F'}
css_l=[];css_d=[]
rows=''
for i,(t,g) in enumerate(CATS):
    sh=shades(LIGHT[t],4)
    for j,h in enumerate(sh):
        css_l.append(f'--s{i}_{j}:{h};'); css_d.append(f'--s{i}_{j}:{dark_shade(h)};')
    rows+=(f'<div class="pr"><span class="sw big" style="background:var(--{t})"></span><span class="nm"><b>{g}</b><code>{t}</code></span>'
           f'<span class="shs">'+''.join(f'<span class="sw" style="background:var(--s{i}_{j})" title="відтінок {j+1}"></span>' for j in range(4))+'</span></div>')
SH = ':root{'+''.join(css_l)+'}[data-theme="dark"]{'+''.join(css_d)+'}'
def chip(var, label, hatch=False):
    st = 'class="sw hatch"' if hatch else f'class="sw" style="background:var(--{var})"'
    return f'<span class="ch"><span {st}></span><span><b>{label}</b><code>{var}</code></span></span>'
def scale(names, labels):
    return '<div class="sc">'+''.join(f'<span class="st"><span class="sw wide" style="background:var(--{n})"></span><code>{n}</code><small>{l}</small></span>' for n,l in zip(names,labels))+'</div>'
body=f'''<div class="stack">
<section class="card pad"><div class="lbl">Тони груп і відтінки категорій (DS-07 п. 15)</div><div class="sub" style="margin-bottom:12px">Тон групи — також серія 1–8 для джерел і рахунків; доходи — лише для своїх категорій. Відтінки — від найбільших витрат до найменших.</div><div class="pg">{rows}</div></section>
<section class="card pad"><div class="lbl" style="margin-bottom:12px">Службові кольори і опорні лінії</div><div class="row" style="gap:16px 28px">
{chip('chart-transfer','Переказ')}{chip('chart-other','Інші · N, Коригування')}{chip('','Інші · N у заливках', True)}
<span class="ch"><svg width="44" height="16" aria-hidden="true"><line x1="0" x2="44" y1="8" y2="8" style="stroke:var(--chart-reference)" stroke-width="2" stroke-dasharray="4 4"/></svg><span><b>План, ціль — 4/4</b><code>chart-reference</code></span></span>
<span class="ch"><svg width="44" height="16" aria-hidden="true"><line x1="0" x2="44" y1="8" y2="8" style="stroke:var(--chart-reference)" stroke-width="2" stroke-dasharray="12 4"/></svg><span><b>Бюджет — 12/4</b><code>chart-reference</code></span></span>
</div></section>
<section class="card pad" style="display:flex;flex-direction:column;gap:14px"><div class="lbl">Шкали</div>
<div><div class="sub">Використання ліміту</div>{scale(['usage-0','usage-30','usage-55','usage-75','usage-95'],['0 %','30 %','55 %','75 %','95–100 %'])}</div>
<div><div class="sub">Перевищення</div>{scale([f'over-{i}' for i in range(1,9)],['< 5 %','5–10','10–20','20–50','50–100','100–200','200–500','≥ 500 %'])}</div>
<div><div class="sub">Прогрес цілі</div>{scale(['goal-0','goal-25','goal-55','goal-80','goal-100','goal-paused'],['0 %','25 %','55 %','80 %','100 %','на паузі'])}</div>
</section>
<section class="card pad"><div class="lbl" style="margin-bottom:12px">Лінії тренду P0 (полотно) — не категоріальна палітра</div><div class="row" style="gap:16px 28px">{chip('series-1','Серія 1')}{chip('series-2','Серія 2')}{chip('series-3','Серія 3')}{chip('series-4','Серія 4')}</div></section>
</div>'''
css = SH + ('.pg{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 28px}.pr{display:flex;align-items:center;gap:12px}.nm{flex:1;min-width:0;display:flex;flex-direction:column;line-height:16px}.nm b,.ch b{font-weight:600;font-size:13px}code{font:400 11px/16px ui-monospace,monospace;color:var(--ink-muted)}'
            '.sw{width:22px;height:22px;border-radius:4px;flex:none;display:inline-block}.sw.big{width:34px;height:34px;border-radius:6px}.sw.wide{width:100%;height:18px;border-radius:3px}.shs{display:flex;gap:2px}'
            '.ch{display:inline-flex;align-items:center;gap:10px}.ch>span:last-child{display:flex;flex-direction:column;line-height:16px}.sc{display:flex;gap:2px;margin-top:6px}.st{flex:1;display:flex;flex-direction:column;gap:2px;min-width:0}.st small{font-size:11px;color:var(--ink-muted)}.st code{font-size:10px}')
C['ChartPalette'] = ('Графіки', 700, 'Тони груп, відтінки категорій, доходи, службові кольори, шкали, лінії плану і бюджету', body, css)
