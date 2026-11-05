import re as _re
def R(s,a,b,n=1):
    if s.count(a)!=n:
        pat=''.join('[ \u00a0]' if ch in ' \u00a0' else _re.escape(ch) for ch in a)
        ms=_re.findall(pat,s); assert len(ms)==n,(a[:90],len(ms)); a=ms[0]
    return s.replace(a,b)
# ---------- scale_f1.py
p='scale_f1.py'; s=open(p).read()
s=R(s,"def f1_share(over,optsum): return _FD(over)*100/_FD(optsum) if _FD(optsum) else _FD(100)",
      "def f1_share(over,optsum): return _FD(over)*100/_FD(optsum) if _FD(optsum) else _FD(100000)  # no optional limits → level 8 (DS-01 п. 25)")
s=R(s,"F1_GREY='#7D8794'; F1_NONE='#B8BEC6'","F1_GREY='#566174'; F1_NONE='#E5E5E2'  # GREY = ink-muted, NONE = line (DS-07 п. 1)")
s=R(s,"    return ('−' if x<0 else '')+'€\u00a0'+s.replace(' ','\u00a0')","    return ('−' if x<0 else '')+s.replace(' ','\u00a0')+'\u00a0€'")
s=R(s,"    elif k=='ramp': g,t=('•' if p<80 else '!'),(('є залишок' if p<80 else 'майже вичерпано')+f' · {f1_pct(p)} %')",
      "    elif k=='ramp': g,t=('•' if p<80 else '!'),('є залишок' if p<80 else f'майже вичерпано · {f1_pct(p)} %')  # «є залишок» без відсотка (DS-01 п. 25, 2026-11-04)")
s=R(s,"""        t='перевищено'
        if L is not None and S is not None:
            o=_FD(S)-_FD(L); t+=f' · {f1_eur(-o)}'+(f' (+{f1_pct(o*100/_FD(L))} %)' if _FD(L) else '')
        g='✕'""","""        t='перевищено'; g='✕'  # under the bar — the word only; the amount lives in the «Залишок» column
        if L is not None and S is not None:
            o=_FD(S)-_FD(L); tip=f'✕ перевищено · {f1_eur(-o)}'+(f' (+{f1_pct(o*100/_FD(L))} %)' if _FD(L) else '')""")
s=R(s,"    tt=t.replace('&lt;','<').replace('\\u00a0',' ')","    tt=(locals().get('tip') or t).replace('&lt;','<').replace('\\u00a0',' ')")
s=R(s,"+it(f'{strip}<span>• є залишок · ! майже вичерпано від 80 %</span>')","+it(f'{strip}<span>• є залишок · ! майже вичерпано · N % від 80 %</span>')")
open(p,'w').write(s)
# ---------- plan_palette.py
p='plan_palette.py'; s=open(p).read()
s=R(s,"for x,lab,c in [(0,'0 %','#0E7A3B'),(30,'30 %','#34A853'),(55,'55 %','#7CC242'),(75,'75 %','#C9C21A'),(100,'95–100 %','#FBBC05')]",
      "for x,lab,c in [(0,'0 % · usage-0','#0E7A3B'),(30,'30 % · usage-30','#34A853'),(55,'55 % · usage-55','#7CC242'),(75,'75 % · usage-75','#C9C21A'),(100,'95–100 % · usage-95','#FBBC05')]")
i=s.index("sec1=H2('1. Використання 0–100 %: безперервний градієнт','"); j=s.index("')\n",i)
s=s[:i]+"sec1=H2('1. Використання 0–100 %: безперервний градієнт','Колір смуги — колір шкали в точці відсотка використання категорії (інтерполяція OKLCH між токенами usage-0 … usage-95). Слово: «• є залишок» (без відсотка — сума залишку стоїть у колонці «Залишок») до 80 %, «! майже вичерпано · N %» від 80 % до менше 100 %. Рівно 100 %: обов’язкова — «✓ ліміт вичерпано» сірим ink-muted, необов’язкова — «! вичерпано» відтінком over-1. Витрачено 0 — «• не почато», сірий line."+s[j:]
s=R(s,"<b style=\"font-size: 13px; color: {INK};\">Рівень {i+1}</b>","<b style=\"font-size: 13px; color: {INK};\">Рівень {i+1} · over-{i+1}</b>")
i=s.index("sec2=H2('2. Перевитрата: відтінок і хвіст за значущістю','"); j=s.index("')\n",i)
s=s[:i]+"sec2=H2('2. Перевитрата: відтінок і хвіст за значущістю','Вісім рівнів over-1 … over-8. Рівень — це не власний відсоток категорії, а частка суми перевитрати від суми лімітів усіх необов’язкових категорій періоду: менше 5 % — 1, 5–10 % — 2, 10–20 % — 3, 20–50 % — 4, 50–100 % — 5, 100–200 % — 6, 200–500 % — 7, від 500 % — 8 (без необов’язкових лімітів — 8). Малюнок: смуга заповнена повністю відтінком over-N, далі проміжок 2 px і сталий слот хвоста 44 px; заповнена частина слота росте з тією ж часткою, повільніше за лінійну (логарифмічно, щонайменше 12 %, повний слот — від 500 %). Текст показує власні числа категорії.'"+s[j:]
# examples — DS-01 AC 17 set + other states
s=R(s,"EX=[('Транспорт','10.00','100.00',True),('Кафе і ресторани','500.00','1000.00',False),('Продукти','600.00','420.00',True),('Пальне','150.00','129.00',False),('Оренда','1200.00','1200.00',True),('Підписки','40.00','40.00',False),('Подарунки','100.00','0.00',False)]",
      "EX=[('Транспорт','10.00','100.00',False),('Кафе і ресторани','500.00','1000.00',False),('Подорожі','200.00','2600.00',False),('Продукти','600.00','420.00',True),('Пальне','150.00','129.00',False),('Оренда','900.00','900.00',True),('Одяг','100.00','30.00',False),('Підписки','40.00','40.00',False),('Подарунки','100.00','0.00',False)]")
s=R(s,"""<span style="width: 96px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; {"color: "+f1_colours(st)[1]+";" if L<S else ""}">{nb(eur(L-S))}</span></div>""",
      """<span style="width: 120px; display: flex; flex-direction: column; align-items: flex-end; font-variant-numeric: tabular-nums; white-space: nowrap;"><b style="font-weight: 600; {"color: "+f1_colours(st)[1]+";" if L<S else ""}">{nb(eur(L-S))}</b><span style="color: {MUTED}; font-size: 12px; line-height: 16px;">{rel(L,S)}</span></span></div>""")
s=R(s,"def exrow(n,l,s,m):","""def rel(L,S):
    if L==0: return ''
    if S>L: return nb(f'{f1_pct((S-L)*100/L)} % понад ліміт'.replace('&lt;','<'))
    return nb(f'{f1_pct((L-S)*100/L)} % ліміту')
def exrow(n,l,s,m):""")
s=R(s,'<span style="width: 96px; text-align: right;">ЗАЛИШОК</span>','<span style="width: 120px; text-align: right;">ЗАЛИШОК</span>')
i=s.index("sec3=H2('3. Приклади власника','"); j=s.index("')\n",i)
s=s[:i]+"sec3=H2('3. Приклади власника','Сума лімітів необов’язкових категорій — '+nb(eur(OPT))+'. «Транспорт»: ліміт 10,00 €, витрачено 100,00 € — власні +900 %, але перевищено лише на 90,00 € — 4,5 % → рівень 1, блідий, найкоротший хвіст. «Кафе і ресторани»: ліміт 500,00 €, витрачено 1 000,00 € — перевищено на 500,00 € — 25 % → рівень 4, яскравий. «Подорожі»: ліміт 200,00 €, витрачено 2 600,00 € — 2 400,00 € = 120 % → рівень 6, довший хвіст. Під смугою — лише слово стану; сума перевитрати — у колонці «Залишок», під нею — відносне значення; повний текст — у підказці («✕ перевищено · −90,00 € (+900 %)»).'"+s[j:]
# C5 deviation — approved tokens
i=s.index("C5S=["); j=s.index("\n",i)
s=s[:i]+"C5S=[('#27704C','краще','▼ 64,30 €','відхилення «краще» понад 10 % бази · gain'),('#387F5A','трохи краще','▼ 7,60 €','до 10 % включно · gain-soft'),('#0B2545','без змін','—','менше 1 % і менше 1 € · brand'),('#C34A48','трохи гірше','▲ 8,20 €','до 10 % включно · loss-soft'),('#B23A3A','гірше','▲ 162,40 €','понад 10 % бази · loss')]"+s[j:]
i=s.index("sec4=H2('4. Відхилення"); j=s.index("')\n",i)
s=s[:i]+"sec4=H2('4. Відхилення від плану, середнього чи попереднього періоду','Колір означає «краще» чи «гірше», стрілка ▲▼ — напрям. Два щаблі за величиною відхилення у відсотках від бази: світлий — до 10 % включно, насичений — понад 10 % (межу порівнюють з відсотком, округленим до одного знака). «Без змін» — «—» кольору brand.'"+s[j:]
s=R(s,"'Досягнуто · + € 50,00 понад ціль'","'Досягнуто · + 50,00 € понад ціль'")
s=R(s,"'Відстає · € 240,00'","'Відстає · 240,00 €'")
s=R(s,"'повна смуга #2E7D32'","'повна смуга goal-100 #2E7D32'")
s=R(s,"'сіра смуга')]","'сіра смуга goal-paused #C5CAD1')]")
s=R(s,"<b style=\"color: {INK}; font-weight: 600;\">{x} %</b>{code(c)}</span>' for x,c in G1_STOPS)","<b style=\"color: {INK}; font-weight: 600;\">{x} % · goal-{x}</b>{code(c)}</span>' for x,c in G1_STOPS)")
s=R(s,"sec5=H2('5. Прогрес цілі (G1)','Колір смуги — точка градієнта жовтий → зелений у відсотку зібраного (OKLCH). Бурштиновий акцент лишається лише для іконок цілей.')",
      "sec5=H2('5. Прогрес цілі','Колір смуги, кільця і лінії прогресу цілі — точка градієнта goal-0 … goal-100 у відсотку зібраного (OKLCH); досягнута — goal-100, на паузі — goal-paused. Бурштин accent лишається лише для іконки й впізнаваності цілі.')")
s=R(s,"ПЛАНУВАННЯ · ДИЗАЙН-СИСТЕМА · F1</span>","ПЛАНУВАННЯ · ДИЗАЙН-СИСТЕМА · DS-01 п. 25, DS-06, DS-07</span>")
s=R(s,"Шкала ліміту · затверджено</h1>","Шкала ліміту · затверджено</h1>\n<span style=\"color: {MUTED}; font-size: 12px; line-height: 16px;\">Створено: 2026-11-03 · Оновлено: 2026-11-05</span>")
open(p,'w').write(s); print('ok')
# --- round 2: thousands in percents, «Відстає» ink
p='scale_f1.py'; s=open(p).read()
s=R(s,"return '&lt;1' if 0<_FD(p)<_FD('0.5') else str(int(v))","return '&lt;1' if 0<_FD(p)<_FD('0.5') else f'{int(v):,}'.replace(',','\\u00a0')")
open(p,'w').write(s)
p='plan_palette.py'; s=open(p).read()
s=R(s,"    ink=f1_ink(c) if c!=G1_PAUSE else MUTED\n","    ink=f1_ink(c) if c!=G1_PAUSE else MUTED\n    if g=='!': ink='#7A4505'  # «! Відстає» — on-warning (DS-06)\n")
open(p,'w').write(s); print('ok2')
