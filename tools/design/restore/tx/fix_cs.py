import re as _re
def R(s,a,b,n=1):
    if s.count(a)!=n:
        pat=''.join('[  ]' if ch in '  ' else _re.escape(ch) for ch in a)
        ms=_re.findall(pat,s); assert len(ms)==n,(a[:90],len(ms)); a=ms[0]
    return s.replace(a,b)
p='cat_shades.py'; s=open(p).read()
s=R(s,"def eur(x): return nb('€ '+f'{x:,.2f}'.replace(',',' ').replace('.',','))","def eur(x): return nb(f'{x:,.2f}'.replace(',',' ').replace('.',',')+' €')")
# nearest groups: v155 only
s=R(s,"{f1(pv(P_OLD,(a,b)))} → {f1(v)}</td></tr>' for (a,b),v in near)","{f1(v)}</td></tr>' for (a,b),v in near)")
i=s.index("pairs=card(f'''"); j=s.index("cols=''\n")
s=s[:i]+'''RULE=[('Тон групи','8 груп витрат — chart-cat-1 … chart-cat-8, 2 групи доходів — chart-group-income-1 (#BA4E84) і chart-group-income-2 (#BE590F); усі 10 тонів — світлота OKLCH 0,58, насиченість до 0,15'),
 ('Відтінки категорій','світлота OKLCH рівномірно від 0,40 (категорія з найбільшими типовими витратами) до 0,80; 2 категорії — 0,46 і 0,70; 3 — 0,42, 0,60 і 0,78'),
 ('Зсув тону','по черзі −8° і +8° (перша категорія −8°, друга +8° …); насиченість — як у тону групи'),
 ('Іконка на колі','біла, якщо контраст білого з кольором категорії не менший за 3 : 1, інакше темна ink #1B2230'),
 ('На графіку','проміжок 2 px surface-200 між сегментами; у treemap кожна група — у білій рамці 2 px; не більше 4 відтінків однієї групи — решта в один сірий «Інші · N» chart-other #9AA3AF, завжди останній; легенда в порядку сегментів'),
 ('Службові','«Переказ» chart-transfer #9DB2C8 (текст лише ink), «Коригування» chart-other #9AA3AF')]
rrows=''.join(f'<div style="display: flex; flex-direction: column; gap: 2px; padding: 8px 0; border-top: 1px solid {SOFT};"><b style="font-weight: 600; font-size: 13px;">{nb(a)}</b><span style="color: {MUTED}; font-size: 12px; line-height: 17px;">{nb(b)}</span></div>' for a,b in RULE)
pairs=card(f\'\'\'<div style="display: flex; flex-direction: column; gap: 6px;"><b style="font-weight: 600;">{nb("Правило (DS-07 п. 15)")}</b>{rrows}</div>\'\'\')+card(f\'\'\'<div style="display: flex; flex-direction: column; gap: 8px;"><b style="font-weight: 600;">{nb("Найближчі групи витрат, ΔE (більше — краще розрізняються)")}</b><table style="border-collapse: collapse; font-size: 12px;">{nrows}</table>
<span style="color: {MUTED}; font-size: 12px; line-height: 17px;">{nb("Тони груп розведені по колу тонів; доходи і витрати не бувають на одному графіку категорій, тому тони доходів можуть стояти поруч із тонами витрат.")}</span></div>\'\'\')
'''+s[j:]
i=s.index("for v,t,d,H in ["); j=s.index("\n",i)
s=s[:i]+"for v,t,d,HH in [('v155','тони груп і відтінки','затверджено власником 2026-11-04; ці кольори — у BUD-01 і на всіх дошках',NEWHEX)]:"+s[j:]
s=R(s,"    HEX.clear(); HEX.update(H)\n","    HEX.clear(); HEX.update(HH)\n")
i=s.index("for v,t,d,HH in ["); j=s.index("    cols+=f'<div",i)
s=s[:i]+s[i:j].replace("H[hn]","HH[hn]").replace("HHH[hn]","HH[hn]")+s[j:]
s=R(s,"background: {'#0B2545' if v=='Стало' else '#C9CED6'}","background: #0B2545")
# split into columns: charts | donut + map | rules
i=s.index("    cols+=f'<div style=\"flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 14px;\">{card(head)}"); j=s.index("\n",i)
s=s[:i]+'''    COL='<div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 14px;">'
    cols+=COL+card(head)+card(f'<div style="display: flex; flex-direction: column; gap: 8px;">{stackbar(m)}</div>')+card(f'<div style="display: flex; flex-direction: column; gap: 8px;">{treemap(m)}</div>')+'</div>'
    cols+=COL+card(f'<div style="display: flex; flex-direction: column; gap: 8px;">{donuts(m)}</div>')+card(mapblock(m))+'</div>'\n'''+s[j:]
s=R(s,"Планування · кольори категорій · обрано Б · нові тони груп</span>","Планування · кольори категорій · DS-07 п. 15, BUD-01 · затверджено v155</span>")
s=R(s,"Кольори категорій · відтінки груп</h1>","Кольори категорій · відтінки груп</h1>\n<span style=\"color: {MUTED}; font-size: 12px; line-height: 16px;\">Створено: 2026-11-03 · Оновлено: 2026-11-05</span>")
s=R(s,"Кожна група категорій (BUD-01 п. 1) має свій тон: 10 груп — 10 тонів, рівномірно розставлених по колу; службові — сірі. Категорії всередині групи — відтінки тону групи за варіантом Б (обрано). Тони 8 груп витрат — це й палітра графіків. Ті самі дані жовтня 2026 (€ 3 144,46): було → стало.",
      "Колір категорії = тон її групи + відтінок. 10 груп — 10 тонів (8 груп витрат — палітра графіків chart-cat-1 … chart-cat-8, 2 групи доходів — власні тони); службові — сірі. Кольори збігаються з таблицею категорій BUD-01. Дані — витрати жовтня 2026 (3 144,46 €).")
open(p,'w').write(s); print('ok')
