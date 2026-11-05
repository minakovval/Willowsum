import re,json
def R(s,a,b,n=1):
    assert s.count(a)==n,(a[:90],s.count(a)); return s.replace(a,b)
# ---- chartcol.py: DS-06/DS-07 values
p='chartcol.py'; s=open(p).read()
s=R(s,"CC_PAL=['#2E69B2','#C46016','#089678','#B68B16','#B24981','#4D8C3E','#6A55B8','#C43F3E']","CC_PAL=['#5872D2','#0E9161','#9C7305','#097FCD','#C35047','#9B5BB6','#0F899B','#678800']  # chart-cat-1 … chart-cat-8 (DS-06)")
s=R(s,"CC_PAL_NAMES=['Синій','Помаранчевий','Бірюзовий','Гірчичний','Малиновий','Зелений','Фіолетовий','Червоний']","CC_PAL_NAMES=['Синьо-фіолетовий','Зелений','Охристий','Блакитний','Червоний','Фіолетовий','Бірюзовий','Оливково-зелений']\nCC_GROUPS=['Житло','Харчування','Транспорт і авто','Зв’язок і підписки','Здоров’я і догляд','Родина','Відпочинок','Фінанси і податки']\nCC_INCOME=[('chart-group-income-1','#BA4E84','Малиновий','Дохід від роботи'),('chart-group-income-2','#BE590F','Помаранчевий','Інші доходи')]\nCC_TRANSFER='#9DB2C8'")
s=R(s,"CC_REF='#3A4350'            # plan / budget / target reference lines — neutral dark, dashed\nCC_REF_DASH='6 4'\nCC_TOTAL='#3A4350'          # total bars (waterfall start) — same neutral dark",
      "CC_REF='rgba(27, 34, 48, 0.6)'  # chart-reference: ink 60 % (DS-06)\nCC_REF_DASH='4 4'            # plan / goal target: short dash; budget: '12 4'\nCC_TOTAL='#0B2545'           # waterfall totals — brand (DS-07 п. 10)")
# category colours v155 = BUD-01@PoC table
b=open('../bud01.poc.md').read(); NEW={}
for m in re.finditer(r"^\s*\| [^|]+ \| ([^|]+?) \| (#[0-9A-F]{6}) \| ([^|]+) \|",b,re.M): NEW[m.group(1).strip().replace("'","’")]=m.group(2)
i=s.index('CATCOL='); j=s.index('CATGROUPS=')
ns={}; exec(s[i:j],ns); old=ns['CATCOL']
assert set(old)==set(NEW),(set(old)^set(NEW))
s=s[:i]+'CATCOL='+json.dumps(NEW,ensure_ascii=False)+'  # v155 — BUD-01@PoC (tone of group + shade)\n'+s[j:]
open(p,'w').write(s)
# ---- plan_chartcol.py
p='plan_chartcol.py'; s=open(p).read()
s=R(s,"    return nb(('−' if x<0 else '')+'€ '+s)","    return nb(('−' if x<0 else '')+s+' €')")
s=R(s,'Планування · рішення C10 · усі графіки продукту','Планування · DS-06, DS-07 п. 15 · усі графіки продукту')
s=R(s,"Графіки більше не «сіро-сині»: категорія має свій колір (той самий, що чип категорії), решта серій бере кольори з палітри 8 тонів у фіксованому порядку, «Інші» — сірий і завжди останній. Зелений/червоний як «добре/погано» — лише у відхиленнях (C5) і використанні ліміту (F1).",
      "Категорія має свій колір — тон її групи і відтінок (той самий, що чип категорії); решта категоріальних серій бере кольори палітри chart-cat-1 … chart-cat-8 у сталому порядку; «Інші · N» — сірий chart-other і завжди останній. Зелений і червоний як «краще / гірше» — лише на графіках відхилення і використання ліміту.")
s=R(s,"'колір категорії (як її чип та іконка) — у будь-якому графіку, будь-якій кількості серій; не залежить від рангу чи фільтра'","'колір категорії (як її чип та іконка) = тон групи + відтінок (світлота OKLCH 0,40–0,80, тон ±8°); у будь-якому графіку; не залежить від рангу чи фільтра; не більше 4 відтінків однієї групи на графіку, решта — «Інші · N»'")
s=R(s,"'Інші серії (групи, рахунки, учасники, цілі, мерчанти без категорії, частини потоку)','палітра 8 тонів, слоти 1 → 8 по черзі, без циклу; 9-та і далі серії → «Інші · N» (сірий, останній); одна серія — слот 1'",
      "'Інші категоріальні серії (джерела, рахунки, учасники)','палітра chart-cat-1 … chart-cat-8 у сталому порядку; не більше 5 серій: 4 найбільші + «Інші · N» (chart-other #9AA3AF, останній; у заливках складу цілого — штрихування)'")
s=R(s,"'токен chart-reference '+CC_REF+' — нейтральна темна штрихова лінія: план і ціль — короткий штрих (4 4), бюджет і ліміт — довгий (12 4, F22 Б); підсумкові стовпці (дохід у водоспаді) — той самий тон, суцільний'",
      "'токен chart-reference — ink #1B2230 з непрозорістю 60 %; план і цільова лінія цілі — короткий штрих 4 / 4 px, бюджет — довгий штрих 12 / 4 px; суцільних опорних ліній немає; підсумки водоспаду — brand #0B2545'")
s=R(s,"'лише там, де графік показує відхилення (C5: краще / гірше / без змін) або використання ліміту (F1: градієнт і шкала перевитрати); ніколи як «серія 4»',sw('#2E7D4F')+sw('#B23A3A')+sw('#1D4E89')+sw(g1_col(30))+sw(g1_col(90))+sw('#E5584A')",
      "'gain, loss, відтінки перевищення — лише на графіках відхилення або використання ліміту; ніколи як «серія 4»',sw('#27704C')+sw('#387F5A')+sw('#B23A3A')+sw('#C34A48')+sw('#0E7A3B')+sw('#FBBC05')+sw('#E5584A')+sw('#7A0F08')")
s=R(s,"'2 px проміжок між сегментами, легенда в порядку стеку, підписи на плитках і підказка при наведенні; таблиця під кожним графіком (C6)'","'2 px проміжок кольору surface-200 між сегментами; у treemap кожна група — у білій рамці 2 px; легенда в порядку сегментів; підписи на плитках і підказка; таблиця тих самих чисел під графіком'")
# palette section: 8 tones + income tones + other + transfer, tokens named
s=R(s,"{i+1}</div><b style=\"font-weight: 600; font-size: 13px;\">{n}</b>{code(c)}{cr(c)}</div>''' for i,(c,n) in enumerate(zip(CC_PAL,CC_PAL_NAMES)))",
      "{i+1}</div><b style=\"font-weight: 600; font-size: 13px;\">{n}</b>{code('chart-cat-'+str(i+1))}{code(c)}<span style=\"font-size: 11px; color: {MUTED};\">{nb(CC_GROUPS[i])}</span>{cr(c)}</div>''' for i,(c,n) in enumerate(zip(CC_PAL,CC_PAL_NAMES)))")
s=R(s,"∑</div><b style=\"font-weight: 600; font-size: 13px;\">«Інші · N»</b>{code(CC_OTHER)}{cr(CC_OTHER)}</div>'''",
      "∑</div><b style=\"font-weight: 600; font-size: 13px;\">«Інші · N»</b>{code('chart-other')}{code(CC_OTHER)}<span style=\"font-size: 11px; color: {MUTED};\">{nb('завжди останній; «Коригування»')}</span>{cr(CC_OTHER)}</div>'''\nINC=''.join(f'<span style=\"display: inline-flex; align-items: center; gap: 8px; font-size: 12px; white-space: nowrap;\">{sw(c,16,4)}<b style=\"font-weight: 600;\">{nb(nm)}</b>{code(t)}{code(c)}<span style=\"color: {MUTED};\">{nb(g)}</span>{cr(c)}</span>' for t,c,nm,g in CC_INCOME)+f'<span style=\"display: inline-flex; align-items: center; gap: 8px; font-size: 12px; white-space: nowrap;\">{sw(CC_TRANSFER,16,4)}<b style=\"font-weight: 600;\">Переказ</b>{code(\"chart-transfer\")}{code(CC_TRANSFER)}<span style=\"color: {MUTED};\">{nb(\"текст на ньому — лише ink\")}</span></span>'")
s=R(s,"val=nb('Перевірено валідатором dataviz на білій картці #FFFFFF і на фоні #FAFAF8: світлота OKLCH 0,52–0,66, насиченість ≥ 0,11, сусідні пари для дальтоніків (протан/дейтан) ΔE ≥ 9,3, без симуляції ΔE ≥ 17,8, усі 8 ≥ 3 : 1 на білому. Перші 3 слоти розрізняються й у будь-яких парах (точкові графіки, малі мультиплікатори) — там максимум 3 серії, решта → «Інші». Порядок слотів — механізм розрізнення, його не змінюють.')",
      "val=nb('Усі 10 тонів (8 груп витрат і 2 групи доходів) мають однакову світлоту OKLCH 0,58 і насиченість до 0,15 у межах sRGB, розведені по колу тонів; тони доходів не входять у палітру серій. Тон chart-cat-N — це і серія N інших категоріальних серій, і тон групи витрат N та основа відтінків її категорій. Порядок слотів сталий.')")
s=R(s,"<span style=\"color: {MUTED}; font-size: 13px; line-height: 18px;\">{val}</span></div>')","<div style=\"display: flex; flex-wrap: wrap; gap: 8px 24px;\">{INC}</div><span style=\"color: {MUTED}; font-size: 13px; line-height: 18px;\">{val}</span></div>')")
s=R(s,'{sec("2 · ПАЛІТРА 8 ТОНІВ · ФІКСОВАНИЙ ПОРЯДОК")}','{sec("2 · ПАЛІТРА ГРАФІКІВ · CHART-CAT-1 … 8, ТОНИ ДОХОДІВ, СЛУЖБОВІ")}')
# category map note
i=s.index("cnote=nb('"); j=s.index("\n",i)
s=s[:i]+"cnote=nb('Системні категорії BUD-01: колір категорії = тон групи + відтінок (DS-07 п. 15). Світлота OKLCH рівномірно від 0,40 (найбільші типові витрати) до 0,80; тон по черзі −8° і +8°; насиченість — як у тону групи; група з 2 категорій — 0,46 і 0,70, з 3 — 0,42, 0,60 і 0,78. Іконка на колі біла, якщо контраст білого не менший за 3 : 1, інакше ink. Службові: «Переказ» #9DB2C8, «Коригування» chart-other #9AA3AF.')"+s[j:]
# category order inside groups as in BUD-01 (largest typical spend first) — keep CATGROUPS order but show shade order
# examples
s=R(s,"sv=f'<svg width=\"{W}\" height=\"{Hh}\" role=\"img\" aria-label=\"Приклад: витрати за категоріями\" style=\"display: block;\">'",
      "sv=f'<svg width=\"{W}\" height=\"{Hh}\" role=\"img\" aria-label=\"Приклад: витрати за категоріями\" style=\"display: block;\"><defs><pattern id=\"othhatch\" width=\"6\" height=\"6\" patternUnits=\"userSpaceOnUse\" patternTransform=\"rotate(45)\"><rect width=\"6\" height=\"6\" fill=\"#FFFFFF\"/><rect width=\"3\" height=\"6\" fill=\"{CC_OTHER}\"/></pattern></defs>'")
s=R(s,"        c=CC_OTHER if n.startswith('Інші') else cc_cat(n); v=vals[j]\n","        c='url(#othhatch)' if n.startswith('Інші') else cc_cat(n); v=vals[j]\n")
s=R(s,"[(\"План € 1 200\",lsw(CC_REF,CC_REF_DASH))]","[(\"План 1 200 €\",lsw(CC_REF,CC_REF_DASH))]")
s=R(s,"учасники — слоти 1–3 + різні маркери; план — chart-reference штрих","учасники — chart-cat-1 … 3 + різні маркери; план — chart-reference, штрих 4 / 4")
s=R(s,"background: {c}; color: #FFFFFF; font: 12px/16px Inter","background: {c}; color: {\"#FFFFFF\" if ratio(c)>=4.5 else INK}; font: 12px/16px Inter")
s=R(s,'leg([("Інші · 9 — сірий",sw(CC_OTHER))])','leg([("Інші · 9 — chart-other",sw(CC_OTHER))])')
# F19: keep the decision Б only, gain/loss tokens
s=R(s,"COLS2={'better':{'light':'#387F5A','strong':'#2E7D4F'},'worse':{'light':'#C34A48','strong':'#B23A3A'}}","COLS2={'better':{'light':'#387F5A','strong':'#27704C'},'worse':{'light':'#C34A48','strong':'#B23A3A'}}  # gain-soft, gain, loss-soft, loss")
s=R(s,"('> 10 % · насичений','#2E7D4F','#B23A3A')","('> 10 % · насичений','#27704C','#B23A3A')")
s=R(s,"Ті самі рядки, три варіанти порогів. Без змін (< 1 % і < € 1) — синій «—» у всіх варіантах.'","Світлий щабель (gain-soft / loss-soft) — до 10 % включно, насичений (gain / loss) — понад 10 %. Без змін (< 1 % і < 1 €) — «—» кольору brand.'")
s=R(s,"  vcard('А','Два кроки: ≤ 5 % / > 5 %',f19('А'))+vcard('Б','Два кроки: ≤ 10 % / > 10 %',f19('Б'),chosen=True)+vcard('В','Три кроки: ≤ 5 / 5–20 / > 20 %',f19('В')))","  vcard('Б','Два кроки: ≤ 10 % / > 10 %',f19('Б'),chosen=True))")
s=R(s,"  vcard('А','План — штрих, бюджет — суцільна',pace('А'),'план (крива темпу) 6 4; бюджет (ліміт періоду) — суцільна тонка')+vcard('Б','Обидві штрихові, різна довжина',pace('Б'),'план — короткий штрих 4 4; бюджет — довгий штрих 12 4',chosen=True))",
      "  vcard('Б','Обидві штрихові, різна довжина',pace('Б'),'план — короткий штрих 4 / 4 px; бюджет — довгий штрих 12 / 4 px; обидві — chart-reference (ink 60 %)',chosen=True))")
s=R(s,"'Обидві лінії — опорні, токен chart-reference '+CC_REF+'; витрачено — слот 1 палітри. Відрізняються лише рисунком лінії.'","'Обидві лінії — опорні, токен chart-reference (ink #1B2230, 60 %); витрачено — chart-cat-1. Відрізняються лише довжиною штриха.'")
s=R(s,"Бюджет € 1 300","Бюджет 1 300 €")
s=R(s,'{H2("5 · Рішення власника","3 листопада 2026: F19 — Б, F21 — Б, F22 — Б. Необрані варіанти приглушено.")}{F19}{F21}{F22}','{H2("5 · Рішення власника","3 листопада 2026: F19 — Б, F22 — Б (записано в DS-01 п. 26 і DS-07 п. 15). Необрані варіанти прибрано.")}{F19}{F22}')
open(p,'w').write(s); print('ok')
