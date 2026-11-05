from common import *
C = {}

def logo(letter, color):
    return f'<span class="logo"><span style="background:{color}">{letter}</span></span>'

def cat(icon, name, color):
    return f'<span class="catc"><span style="background:{color}">{ic(icon,11,2.2)}</span>{name}</span>'

TX = [
    (logo('С', '#F26522'), 'Сільпо', 'SILPO 0457 KYIV', cat('shopping-cart','Продукти','#045D2F'), 'Поточний ··4417', '2 лист. 2026', '09:14', eur('42,80','-')),
    (logo('N', '#E50914'), 'Netflix', 'NETFLIX.COM', cat('tv','Підписки','#7A165C'), 'Кредитна ··9021', '1 лист. 2026', '03:02', eur('13,99','-')),
    ('<span class="logo ini">ТК</span>', 'ТОВ «Кодекс»', 'Зарплата за жовтень', cat('banknote','Зарплата','#02537A'), 'Поточний ··4417', '31 жовт. 2026', '18:40', eur('3 400,00','+')),
]

def _table():
    head = '<div class="th"><span class="chk"></span><span style="flex:1">Контрагент</span><span style="width:140px">Категорія</span><span style="width:130px">Рахунок</span><span class="srt" style="width:110px">Дата і час' + ic('arrow-down',14) + '</span><span style="width:110px;text-align:right">Сума</span></div>'
    rows = ''
    for i, (lg, m, d, c, acc, dt, tm, a) in enumerate(TX):
        cls = ' hov' if i == 1 else ''
        rows += (f'<div class="tr{cls}"><span class="chk"></span><span style="flex:1;min-width:0;display:flex;align-items:center;gap:12px">{lg}<span style="min-width:0;display:flex;flex-direction:column"><span class="t1">{m}</span><span class="t2">{d}</span></span></span>'
                 f'<span style="width:140px">{c}</span><span class="muted" style="width:130px;white-space:nowrap">{acc}</span><span class="tab" style="width:110px;display:flex;flex-direction:column"><span>{dt}</span><span class="t2">{tm}</span></span><span class="amt" style="width:110px;text-align:right">{a}</span></div>')
    sel = (f'<div class="tr sel"><span class="chk on">{ic("check",12,3)}</span><span style="flex:1;min-width:0;display:flex;align-items:center;gap:12px">{logo("B","#2F5711")}<span style="min-width:0;display:flex;flex-direction:column"><span class="t1">Bolt</span><span class="t2">BOLT.EU/O/2611</span></span></span>'
           f'<span style="width:140px">{cat("car","Таксі","#494BAB")}</span><span class="muted" style="width:130px">Поточний ··4417</span><span class="tab" style="width:110px;display:flex;flex-direction:column"><span>30 жовт. 2026</span><span class="t2">22:15</span></span><span class="amt" style="width:110px;text-align:right">{eur("8,40","-")}</span></div>')
    sk = '<div class="tr"><span class="sk" style="width:16px;height:16px;border-radius:4px"></span><span class="sk" style="width:32px;height:32px;border-radius:8px"></span><span class="sk" style="width:30%;height:12px"></span><span style="flex:1"></span><span class="sk" style="width:80px;height:12px"></span></div>'
    acc = ('<div class="th"><span style="flex:1">Рахунок</span><span style="width:120px">Тип</span><span style="width:80px">Валюта</span><span style="width:120px">Джерело</span><span class="srt" style="width:150px;justify-content:flex-end">Баланс, EUR' + ic('arrow-down',14) + '</span></div>'
           f'<div class="tr"><span class="t1" style="flex:1">Поточний ··4417</span><span style="width:120px">Поточний</span><span style="width:80px" class="muted">EUR</span><span style="width:120px" class="muted">monobank</span><span class="amt" style="width:150px;text-align:right">{eur("11 400,00")}</span></div>'
           f'<div class="tr"><span class="t1" style="flex:1">Гривневий ··2203</span><span style="width:120px">Поточний</span><span style="width:80px" class="muted">UAH</span><span style="width:120px" class="muted">ПриватБанк</span><span style="width:150px;text-align:right;display:flex;flex-direction:column"><span class="amt">{uah("829 680,00")}</span><span class="t2">≈ {eur("18 880,00")}</span></span></div>'
           f'<div class="tr"><span class="t1" style="flex:1">Кредитна ··9021</span><span style="width:120px">Кредитна</span><span style="width:80px" class="muted">EUR</span><span style="width:120px" class="muted">Вручну</span><span class="amt" style="width:150px;text-align:right">{eur("640,00","-")}</span></div>')
    body = (f'<div class="stack"><div class="cell"><div class="cap">Транзакції · сортування за датою, наведення, вибраний рядок, завантаження</div>'
            f'<div style="display:flex;gap:20px;color:var(--ink-muted);font-size:13px" class="tab"><span>Надходження <b style="color:var(--ink)">{eur("3 400,00","+")}</b></span><span>Списання <b style="color:var(--ink)">{eur("1 015,30","-")}</b></span><span>Різниця <b style="color:var(--ink)">{eur("2 384,70","+")}</b></span></div>'
            f'<section class="card" style="overflow:hidden">{head}{rows}{sel}{sk}</section></div>'
            f'<div class="cell"><div class="cap">Рахунки · 4 записи · {eur("32 860,00")}</div><section class="card" style="overflow:hidden">{acc}</section></div></div>')
    css = '.srt{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 6px;margin:0 -6px;border-radius:4px;background:var(--tint);color:var(--ink)}.card{overflow-x:auto}\n'
    return ('Списки', 660, 'Рамка 8 px, заголовки великими, рядки 52 px; суми праворуч', body, css)
C['Table'] = _table()

def _txrow():
    rows = ''
    for lg, m, d, c, acc, dt, tm, a in TX[:2]:
        rows += (f'<div class="tr">{lg}<span style="flex:1;min-width:0;display:flex;flex-direction:column"><span class="t1">{m}</span><span class="t2">{dt} · {acc}</span></span>{c}<span class="amt" style="width:110px;text-align:right">{a}</span></div>')
    review = (f'<div class="tr" style="box-shadow:inset 6px 0 0 var(--ink);padding-left:22px">{logo("W","#1B2230")}<span style="flex:1;min-width:0;display:flex;flex-direction:column"><span style="display:flex;gap:6px;align-items:center"><span class="t1">WOG</span>{ic("paperclip",14,cls="muted")}</span><span class="t2">29 жовт. · Поточний ··4417</span></span>'
              f'<span class="tag warn">! Перевірити</span>{cat("fuel","Пальне","#796000")}<button type="button" class="ib" style="width:32px;height:32px;border-radius:4px" aria-label="Змінити категорію">{ic("pencil",16)}</button><button type="button" class="btn sm">{ic("check",14)}Підтвердити</button><span class="amt" style="width:110px;text-align:right">{eur("56,20","-")}</span></div>')
    nocat = (f'<div class="tr"><span class="logo ini">ФО</span><span style="flex:1;min-width:0;display:flex;flex-direction:column"><span class="t1">ФОП Іваненко</span><span class="t2">28 жовт. · Поточний ··4417</span></span><span class="catc none">Без категорії</span><span class="amt" style="width:110px;text-align:right">{eur("120,00","-")}</span></div>')
    dup = (f'<div class="tr"><span class="logo"><span style="background:#F26522">С</span></span><span style="flex:1;min-width:0;display:flex;flex-direction:column"><span style="display:flex;gap:6px;align-items:center"><span class="t1">Сільпо</span><span class="tag warn">Можливий дубль</span></span><span class="t2">27 жовт. · Поточний ··4417</span></span><button type="button" class="btn sm">Об’єднати</button><span class="amt" style="width:110px;text-align:right">{eur("42,80","-")}</span></div>')
    tr = (f'<div class="tr"><span class="logo ini">{ic("arrow-left-right",14)}</span><span style="flex:1;min-width:0;display:flex;flex-direction:column"><span style="display:flex;gap:6px;align-items:center"><span class="t1">Переказ на картку ··9021</span><span class="tag">переказ</span><span class="tag info">Очікує</span></span><span class="t2">31 жовт. · Поточний ··4417</span></span>{cat("arrow-left-right","Переказ","#566174")}<span class="amt" style="width:110px;text-align:right">{eur("200,00","-")}</span></div>')
    body = f'<section class="card" style="overflow:hidden">{rows}{review}{nocat}{dup}{tr}</section>'
    return ('Списки', 400, 'Розібрана, до розбору, без категорії, дубль, переказ, очікує', body, '')
C['TransactionRow'] = _txrow()

C['ListRow'] = ('Списки', 380, 'Рахунок, ціль, борг; наведення, вибраний, архів, завантаження', f'''<section class="card" style="overflow:hidden">
<div class="tr" style="min-height:60px"><span class="logo ini">{ic("landmark",16)}</span><span style="flex:1;min-width:0;display:flex;flex-direction:column"><span class="t1">Поточний ··4417</span><span class="t2">monobank · EUR · оновлено 12 хв тому</span></span><span class="tag pos">✓ Активне</span><span style="width:130px;text-align:right;display:flex;flex-direction:column"><span class="amt">{eur("11 400,00")}</span><span class="up" style="font-size:12px;line-height:16px">▲ {eur("1 260,00")} м/м</span></span></div>
<div class="tr hov" style="min-height:60px"><span class="logo ini">{ic("flag",16)}</span><span style="flex:1;min-width:0;display:flex;flex-direction:column"><span class="t1">Відпустка в Італії</span><span class="t2">{eur("2 100,00")} з {eur("4 000,00")} · до 1 лип. 2027</span></span><span class="amt" style="width:130px;text-align:right">52,5 %</span></div>
<div class="tr sel" style="min-height:60px"><span class="chk on">{ic("check",12,3)}</span><span class="logo ini">{ic("credit-card",16)}</span><span style="flex:1;min-width:0;display:flex;flex-direction:column"><span class="t1">Кредитна ··9021</span><span class="t2">Кредитна картка · 24,9 % річних</span></span><span class="amt" style="width:130px;text-align:right">{eur("640,00","-")}</span></div>
<div class="tr" style="min-height:60px"><span class="logo ini">{ic("landmark",16)}</span><span style="flex:1;min-width:0;display:flex;flex-direction:column"><span class="t1" style="color:var(--ink-muted)">Ощадний ··1180</span><span class="t2">Закрито 12 вер. 2026</span></span><span class="tag">• Архів</span><span class="amt muted" style="width:130px;text-align:right">{eur("0,00")}</span></div>
<div class="tr" style="min-height:60px"><span class="sk" style="width:36px;height:36px;border-radius:999px"></span><span style="flex:1;display:flex;flex-direction:column;gap:6px"><span class="sk" style="width:38%;height:12px"></span><span class="sk" style="width:24%;height:10px"></span></span><span class="sk" style="width:90px;height:12px"></span></div>
</section>''', '')

C['Avatar'] = ('Списки', 200, 'Ініціали завжди; розміри, група, колишній учасник', f'''<div class="row c" style="gap:32px">
<div class="cell"><div class="cap">Розміри</div><div class="row c" style="gap:12px"><span class="av" style="width:24px;height:24px;font-size:10px">ОК</span><span class="av">ОК</span><span class="av" style="width:44px;height:44px;font-size:16px">ОК</span></div></div>
<div class="cell"><div class="cap">Кольори учасників</div><div class="row c" style="gap:12px"><span class="av">ОК</span><span class="av" style="background:#7A165C">АК</span><span class="av" style="background:#045D2F">МК</span><span class="av" style="background:#7A4505">ДК</span></div></div>
<div class="cell"><div class="cap">Група</div><div style="display:flex"><span class="av av2">ОК</span><span class="av av2" style="background:#7A165C">АК</span><span class="av av2" style="background:#045D2F">МК</span><span class="av av2" style="background:var(--surface-300);color:var(--ink)">+3</span></div></div>
<div class="cell"><div class="cap">Колишній учасник</div><span class="av" style="background:var(--border-control)" title="Колишній учасник">ІП</span></div>
<div class="cell"><div class="cap">Фокус</div><span class="av ring">ОК</span></div>
</div>''', '.av2{border:2px solid var(--surface-100);margin-left:-8px}.av2:first-child{margin-left:0}')

def _filterbar():
    body = f'''<div class="stack">
<div class="cell"><div class="cap">Застосовано один фільтр</div><div class="row c" style="gap:8px"><span class="search" style="width:300px">{ic("search",16)}<span>Пошук за мерчантом, описом, сумою</span></span><button type="button" class="btn" style="height:36px;font-size:13px;padding:0 12px;gap:6px">{ic("list-filter",16)}Фільтри<span class="cnt">1</span></button><span class="fchip">Листопад 2026<span class="x" aria-label="Прибрати фільтр Листопад 2026">{ic("x",14)}</span></span></div>
<div style="display:flex;gap:20px;color:var(--ink-muted);font-size:13px" class="tab"><span>42 записи</span><span>Надходження <b style="color:var(--ink)">{eur("3 400,00","+")}</b></span><span>Списання <b style="color:var(--ink)">{eur("1 015,30","-")}</b></span></div></div>
<div class="cell"><div class="cap">Панель фільтрів</div><div class="panel" style="width:420px;padding:16px;display:flex;flex-direction:column;gap:10px">
<div class="fr"><span>Період</span><span class="inp" style="height:36px">Листопад 2026<span style="flex:1"></span>{ic("chevron-down",16,cls="muted")}</span></div>
<div class="fr"><span>Рахунки</span><span class="inp" style="height:36px"><span class="ph">Усі</span><span style="flex:1"></span>{ic("chevron-down",16,cls="muted")}</span></div>
<div class="fr"><span>Категорії</span><span class="inp" style="height:36px">Продукти, Кафе, Таксі…<span style="flex:1"></span>{ic("chevron-down",16,cls="muted")}</span></div>
<div class="fr"><span>Сума</span><span style="display:flex;gap:8px;flex:1"><span class="inp" style="height:36px;flex:1"><span class="ph">від</span></span><span class="inp" style="height:36px;flex:1"><span class="ph">до</span></span></span></div>
<div style="display:flex;justify-content:space-between;padding-top:6px"><button type="button" class="btn quiet">Скинути все</button><button type="button" class="btn pri">Застосувати</button></div></div></div>
</div>'''
    css = ('.fchip{height:32px;display:inline-flex;align-items:center;gap:6px;padding:0 6px 0 10px;border-radius:999px;background:var(--tint);color:var(--brand);font:500 13px Inter,sans-serif;white-space:nowrap}.fchip .x{display:grid;color:var(--ink-muted)}'
           '.fr{display:flex;align-items:center;gap:12px}.fr>span:first-child{width:90px;color:var(--ink-muted);font-size:13px}.fr .inp{flex:1}')
    return ('Списки', 520, 'Пошук, «Фільтри · N», чипи і підсумок; панель фільтрів', body, css)
C['FilterBar'] = _filterbar()

C['Toolbar'] = ('Списки', 300, 'Пошук і швидкі фільтри ліворуч; сортування, колонки, вигляд праворуч', f'''<div class="stack">
<div class="cell"><div class="cap">Вигляд «Таблиця»</div><div class="tb"><span class="search" style="width:300px">{ic("search",16)}<span>Пошук активів</span></span><span class="row c" style="gap:4px"><span class="ptab on" style="height:32px">Усі</span><span class="ptab" style="height:32px">Нерухомість</span><span class="ptab" style="height:32px">Вино</span></span><span style="flex:1"></span><button type="button" class="ib" aria-label="Колонки">{ic("columns3",20)}</button><span class="vs"><span aria-label="Картки">{ic("layout-grid",16)}</span><span class="on" aria-label="Таблиця">{ic("table",16)}</span></span><button type="button" class="ib" aria-label="Параметри">{ic("sliders-horizontal",20)}</button><button type="button" class="btn pri">{ic("plus",16)}Додати актив</button></div></div>
<div class="cell"><div class="cap">Вигляд «Картки», сортування змінене</div><div class="tb"><span class="search" style="width:300px">{ic("search",16)}<span>Пошук активів</span></span><span style="flex:1"></span><button type="button" class="ib" aria-label="Сортувати: за сумою, від більшої">{ic("arrow-up-down",20)}<span class="dot"></span></button><span class="vs"><span class="on" aria-label="Картки">{ic("layout-grid",16)}</span><span aria-label="Таблиця">{ic("table",16)}</span></span><button type="button" class="ib" aria-label="Параметри">{ic("sliders-horizontal",20)}</button></div></div>
</div>''', '.tb{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.vs{display:inline-flex;gap:2px}.vs span{width:28px;height:28px;display:grid;place-items:center;border-radius:4px;color:var(--ink-muted)}.vs .on{background:var(--surface-300);color:var(--ink);box-shadow:inset 0 -2px 0 var(--brand)}')

C['Chip'] = ('Списки', 260, 'Фільтр зі зняттям, перемикач, категорія, тег', f'''<div class="stack">
<div class="cell"><div class="cap">Фільтр зі зняттям</div><div class="row c" style="gap:8px"><span class="fchip">Листопад 2026<span class="x">{ic("x",14)}</span></span><span class="fchip">Продукти<span class="x">{ic("x",14)}</span></span><span class="fchip ring">Поточний ··4417<span class="x">{ic("x",14)}</span></span></div></div>
<div class="cell"><div class="cap">Перемикач (типи на мапі): увімкнено, вимкнено, вимкнений</div><div class="row c" style="gap:8px"><span class="tg on">{ic("check",16)}Нерухомість · 3</span><span class="tg on">{ic("check",16)}Транспорт · 2</span><span class="tg">Човни · 1</span><span class="tg dis">Метали · 0</span></div></div>
<div class="cell"><div class="cap">Категорія і тег (лише читання)</div><div class="row c" style="gap:8px"><span class="catc"><span style="background:#045D2F">{ic("shopping-cart",11,2.2)}</span>Продукти</span><span class="catc none">Без категорії</span><span class="tag">однакова сума</span><span class="tag">той самий день</span><span class="tag">#відпустка</span></div></div>
</div>''', '.fchip{height:32px;display:inline-flex;align-items:center;gap:6px;padding:0 6px 0 10px;border-radius:999px;background:var(--tint);color:var(--brand);font:500 13px Inter,sans-serif;white-space:nowrap}.fchip .x{display:grid;color:var(--ink-muted)}.tg{height:32px;display:inline-flex;align-items:center;gap:6px;padding:0 12px;border-radius:999px;border:1px solid var(--ctl);background:var(--surface-200);font:500 13px Inter,sans-serif;white-space:nowrap}.tg.on{background:var(--tint);border-color:transparent;color:var(--brand);font-weight:600}.tg.dis{background:var(--disabled-bg);border-color:transparent;color:var(--disabled-ink)}')

def _menu_body(items):
    out = ''
    for it in items:
        if it == '-': out += '<div class="hr"></div>'; continue
        if it[0] == 'h': out += f'<div class="mh">{it[1]}</div>'; continue
        cls, icon, label, k = it
        out += f'<div class="mi {cls}"><span class="i">{ic(icon,16) if icon else ""}</span>{label}{f"<span class=k>{k}</span>" if k else ""}</div>'
    return out

C['Menu'] = ('Списки', 420, 'Дії рядка і картки; іконка 16 px, небезпечна дія останньою', f'''<div class="row" style="gap:32px">
<div class="cell"><div class="cap">«Дії з вибраними»</div><div class="panel" style="width:270px">{_menu_body([("","tag","Змінити категорію",""),("hov","tag","Додати теги",""),("","check-check","Підтвердити категорії",""),"-",("","merge","Об’єднати в одну",""),("","eye-off","Приховати",""),("","download","Експортувати CSV",""),"-",("dz","trash2","Видалити (лише ручні)","")])}</div></div>
<div class="cell"><div class="cap">«…» картки рахунку</div><div class="panel" style="width:270px">{_menu_body([("hov","pencil","Оновити залишок",""),("","merge","Об’єднати з іншим рахунком",""),("dis","scale","Звірити з банком","v1"),"-",("dz","archive","Закрити рахунок","")])}</div></div>
<div class="cell"><div class="cap">Вибір одного варіанта</div><div class="panel" style="width:220px">{_menu_body([("h","Показувати"),("","check","Усі рахунки",""),("","","Лише відкриті",""),("","","Лише закриті","")])}</div></div>
</div>''', '')

C['SortMenu'] = ('Списки', 340, 'Кнопка «Сортувати» і меню з двома групами', f'''<div class="row" style="gap:32px;align-items:flex-start">
<div class="cell"><div class="cap">Типове</div><button type="button" class="ib" aria-label="Сортувати">{ic("arrow-up-down",20)}</button></div>
<div class="cell"><div class="cap">Змінене, меню відкрите</div><div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start"><button type="button" class="ib on" aria-expanded="true" aria-label="Сортувати: за сумою, від більшої">{ic("arrow-up-down",20)}<span class="dot"></span></button>
<div class="panel" style="width:240px">{_menu_body([("h","Поле"),("","","Дата",""),("hov","check","Сума",""),("","","Назва",""),("dis","","Тип",""),"-",("h","Напрям"),("","check","Від більшої",""),("","","Від меншої","")])}</div></div></div>
</div>''', '')

C['ColumnPicker'] = ('Списки', 420, 'Колонки таблиці транзакцій', f'''<div class="row" style="gap:12px;align-items:flex-start"><button type="button" class="ib on" aria-expanded="true" aria-label="Колонки">{ic("columns3",20)}</button>
<div class="panel" style="width:260px;padding:8px 4px"><div style="padding:4px 10px 8px;font-weight:600">Колонки</div>
<label class="cr dis"><span class="chk on" style="opacity:.55">{ic("check",12,3)}</span>Контрагент<span class="k">завжди</span></label>
<label class="cr"><span class="chk on">{ic("check",12,3)}</span>Категорія</label>
<label class="cr"><span class="chk">{''}</span>Актив</label>
<label class="cr hov"><span class="chk on">{ic("check",12,3)}</span>Рахунок</label>
<label class="cr"><span class="chk on">{ic("check",12,3)}</span>Дата і час</label>
<label class="cr dis"><span class="chk on" style="opacity:.55">{ic("check",12,3)}</span>Сума<span class="k">завжди</span></label>
<div class="hr"></div><button type="button" class="btn quiet sm" style="margin:4px 0 0 2px">Скинути до типових</button></div></div>''', '.cr{display:flex;align-items:center;gap:10px;height:40px;padding:0 10px;border-radius:6px}.cr.hov{background:var(--surface-300)}.cr.dis{color:var(--ink-muted)}.cr .k{margin-left:auto;font-size:12px;color:var(--ink-muted)}')

C['GroupHeader'] = ('Списки', 300, 'Заголовок групи активів (MVP)', f'''<div class="stack">
<div class="gh"><button type="button" class="ib c" aria-expanded="true" aria-label="Згорнути групу">{ic("chevron-down",16)}</button><span class="mm"></span><span style="flex:1;display:flex;flex-direction:column"><span class="h3">Київ, Поділ</span><span class="muted">8 активів</span></span><span style="text-align:right;display:flex;flex-direction:column"><span class="amt" style="font:600 18px/24px 'Inter Tight',Inter,sans-serif">{eur("412 300,00")}</span><span class="sub">активи {eur("468 000,00")} · борги {eur("55 700,00","-")}</span></span><button type="button" class="ib" aria-label="Параметри групи">{ic("sliders-horizontal",20)}</button></div>
<div class="gh"><button type="button" class="ib c hov" aria-expanded="false" aria-label="Розгорнути групу">{ic("chevron-right",16)}</button><span style="flex:1;display:flex;flex-direction:column"><span class="h3">Колекція вин</span><span class="muted">24 пляшки · 3 валюти</span></span><span class="amt" style="font:600 18px/24px 'Inter Tight',Inter,sans-serif">≈ {eur("18 450,00")}</span><button type="button" class="ib" aria-label="Параметри групи">{ic("sliders-horizontal",20)}</button></div>
<div class="gh"><button type="button" class="ib c" aria-label="Згорнути групу">{ic("chevron-down",16)}</button><span style="flex:1;display:flex;flex-direction:column"><span class="h3">Дача, Козин</span><span class="muted">5 активів</span></span><span class="sk" style="width:96px;height:24px"></span></div>
</div>''', '.gh{display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--line)}.mm{width:56px;height:56px;border-radius:8px;border:1px solid var(--line);background:linear-gradient(135deg,transparent 46%,var(--surface-200) 46% 52%,transparent 52%),radial-gradient(circle at 70% 30%,var(--surface-300) 0 30%,transparent 31%),var(--surface-100);position:relative}.mm::after{content:"";position:absolute;left:22px;top:22px;width:12px;height:12px;border-radius:999px;background:var(--brand);box-shadow:0 0 0 2px var(--surface-200)}')

# ---------------- Числа ----------------
C['Amount'] = ('Числа', 380, 'Розміри, борг, скорочення, приховано, немає значення', f'''<div class="stack">
<div class="row" style="gap:40px;align-items:flex-end">
<div class="cell"><div class="cap">xl · загальна</div><span class="amt" style="font:600 40px/44px Inter,sans-serif;letter-spacing:-.01em">{eur("128 450,00")}</span></div>
<div class="cell"><div class="cap">l · підсумок рахунку</div><span class="amt" style="font:600 28px/32px Inter,sans-serif;letter-spacing:-.01em">{eur("32 860,00")}</span></div>
<div class="cell"><div class="cap">m · рядок списку</div><span class="amt" style="font-size:16px;line-height:24px">{eur("42,80","-")}</span></div>
</div>
<div class="row" style="gap:40px">
<div class="cell"><div class="cap">Борг, справжній мінус</div><span class="amt" style="font-size:16px">{eur("640,00","-")}</span></div>
<div class="cell"><div class="cap">Надходження</div><span class="amt" style="font-size:16px">{eur("3 400,00","+")}</span></div>
<div class="cell"><div class="cap">Гривня</div><span class="amt" style="font-size:16px">{uah("829 680,00")}</span></div>
<div class="cell"><div class="cap">Скорочено (підказка — повне)</div><span style="display:inline-flex;flex-direction:column;align-items:flex-start;gap:6px"><span class="amt" tabindex="0" style="font-size:16px;text-decoration:underline dotted 2px var(--ink-muted);text-underline-offset:4px;cursor:help">128,4{NB}тис.{NB}€</span><span class="tip">{eur("128 450,00")}</span></span></div>
<div class="cell"><div class="cap">Великі значення</div><span class="amt" style="font-size:16px">1,24{NB}млн{NB}₴ · 12,35{NB}трлн{NB}€</span></div>
<div class="cell"><div class="cap">Приховано</div><span class="amt" style="font-size:16px" aria-label="Сума прихована">•••</span></div>
<div class="cell"><div class="cap">Немає значення</div><span class="amt muted" style="font-size:16px">–</span></div>
<div class="cell"><div class="cap">Завантаження</div><span class="sk" style="width:110px;height:24px"></span></div>
</div></div>''', '.tip{padding:6px 10px;background:var(--surface-200);border:1px solid var(--line);border-radius:8px;box-shadow:var(--elev);font-size:12px;line-height:16px;font-variant-numeric:tabular-nums;white-space:nowrap}')

C['Delta'] = ('Числа', 200, 'Стрілка без знака; колір — краще чи гірше', f'''<div class="row" style="gap:32px">
<div class="cell"><div class="cap">Вартість зросла (краще)</div><span class="up tab">▲ {eur("1 260,00")} · 32,0 % за 3 міс.</span></div>
<div class="cell"><div class="cap">Витрати зросли (гірше)</div><span class="dn tab">▲ {eur("792,62")} м/м</span></div>
<div class="cell"><div class="cap">Витрати знизились (краще)</div><span class="up tab">▼ {eur("140,00")} · 4,1 % м/м</span></div>
<div class="cell"><div class="cap">Капітал знизився (гірше)</div><span class="dn tab">▼ 2 п. п. р/р</span></div>
<div class="cell"><div class="cap">Без змін</div><span class="tab" style="color:var(--brand);font-weight:500">— м/м</span></div>
</div>''', '')

def _goal():
    def g(name, badge, cap, pct, color, extra='', mark=None, ico='plane'):
        m = f'<span class="mark" style="left:{mark}%" title="мало б бути на сьогодні"></span>' if mark else ''
        return (f'<div class="gp"><span class="gi">{ic(ico,18)}</span><span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">'
                f'<span style="display:flex;align-items:center;gap:6px"><b class="t1">{name}</b>{badge}</span><span class="t2">{cap}</span>'
                f'<span style="display:flex;align-items:center;gap:10px;padding-top:2px"><span class="bar" role="progressbar" aria-valuenow="{pct}" style="flex:1"><i style="width:{min(pct,100)}%;background:{color}"></i>{m}</span><span class="tab" style="width:52px;text-align:right;font-size:12px;font-weight:600">{str(pct).replace(".",",")} %</span></span>{extra}</span></div>')
    body = '<section class="card" style="max-width:520px;overflow:hidden">' + ''.join([
        g('Відпустка в Італії', f'<span class="tag brand">{ic("star",11,2)}Головна</span>', f'{eur("2 100,00")} з {eur("4 000,00")} · до 1 лип. 2027', 52.5, 'var(--goal-55)'),
        g('Подушка безпеки', '', f'{eur("9 000,00")} з {eur("12 600,00")} · без дати', 71.4, 'var(--goal-80)', ico='shield-check'),
        g('Ремонт кухні', f'<span style="color:var(--warn);font:500 12px/16px Inter,sans-serif;white-space:nowrap">! Відстає · {eur("900,00")}</span>', f'{eur("2 300,00")} з {eur("8 000,00")} · до 1 бер. 2027', 28.8, 'var(--goal-25)', mark=40, ico='house'),
        g('Новий ноутбук', '', f'{eur("0,00")} з {eur("1 200,00")} · до 1 січ. 2027', 0, 'var(--goal-0)', ico='laptop'),
        g('Машина', '<span class="tag pos">✓ Досягнуто</span>', f'{eur("15 450,00")} з {eur("15 000,00")} · + {eur("450,00")} понад ціль', 100, 'var(--goal-100)', ico='car'),
        g('Весілля', '<span class="tag">На паузі</span>', f'{eur("3 000,00")} з {eur("10 000,00")}', 30, 'var(--goal-paused)', ico='heart'),
    ]) + '</section>'
    css = '.gp{display:flex;gap:12px;padding:14px 16px;border-bottom:1px solid var(--surface-300)}.gp:last-child{border-bottom:0}.gi{width:36px;height:36px;flex:none;border-radius:8px;background:var(--surface-300);color:var(--brand);display:grid;place-items:center}'
    return ('Числа', 540, 'Шкала цілі від жовтого до зеленого; відстає, досягнуто, на паузі', body, css)
C['GoalProgress'] = _goal()

C['KpiTile'] = ('Числа', 300, 'Один показник, значення і зміна (MVP)', f'''<div class="grid3">
<div class="kp"><span class="kl">{ic("landmark",16)}Гроші разом</span><span class="kv">{eur("32 860,00")}</span><span class="up tab">▲ {eur("1 260,00")} · 4,0 % <span class="muted">м/м</span></span></div>
<div class="kp"><span class="kl">{ic("shopping-cart",16)}Витрати за місяць</span><span class="kv">{eur("1 015,30")}</span><span class="up tab">▼ {eur("140,00")} · 12,1 % <span class="muted">м/м</span></span></div>
<div class="kp"><span class="kl">{ic("credit-card",16)}Борги</span><span class="kv">{eur("55 700,00","-")}</span><span class="tab" style="color:var(--brand)">— <span class="muted">м/м</span></span></div>
<div class="kp"><span class="kl">{ic("gem",16)}Активи</span><span class="kv">≈ {eur("468 000,00")}</span><span class="sub">Оновлено 12 днів тому</span></div>
<div class="kp"><span class="kl">{ic("trending-up",16)}Інвестиції</span><span class="sk" style="width:60%;height:28px"></span><span class="sk" style="width:40%;height:14px"></span></div>
<div class="kp"><span class="kl">{ic("bitcoin",16)}Криптовалюта</span><span class="errt" style="font-size:14px">{ic("circle-alert",16)}Помилка<button type="button" class="ib c" aria-label="Спробувати ще раз">{ic("refresh-cw",16)}</button></span><span class="sub">Не вдалося завантажити.</span></div>
</div>''', '.kp{display:flex;flex-direction:column;gap:6px;padding:16px 20px;background:var(--surface-200);border:1px solid var(--line);border-radius:8px}.kl{display:flex;align-items:center;gap:6px;font:500 13px/18px Inter,sans-serif;color:var(--ink-muted)}.kv{font:600 24px/32px "Inter Tight",Inter,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap}')

# ---------------- Стани ----------------
C['Badge'] = ('Стани', 220, 'Плашка 20 px з радіусом 4: символ і слово', f'''<div class="stack">
<div class="row c" style="gap:8px"><span class="tag pos">✓ Активне</span><span class="tag warn">! Потребує дії</span><span class="tag neg">✕ Помилка</span><span class="tag info">i Листи</span><span class="tag">• Відключено</span></div>
<div class="row c" style="gap:8px"><span class="tag info">Висока упевненість · 92</span><span class="tag warn">Середня упевненість · 71</span><span class="tag warn">Комісія</span><span class="tag warn">! Оцінка застаріла</span><span class="tag brand">{ic("star",11,2)}Головна</span><span class="tag">Без категорії</span><span class="tag info">Поточний</span><span class="tag pos">Рекомендований</span></div>
</div>''', '')

def _banner():
    def b(tone, icon, title, text, act, color):
        return (f'<div class="bn" role="{"alert" if tone=="neg" else "status"}"><span class="bi" style="color:{color}">{ic(icon,18)}</span><span style="flex:1;min-width:0;display:flex;flex-direction:column"><b style="font-weight:600">{title}</b><span class="muted" style="font-size:13px;line-height:18px">{text}</span></span>{act}<button type="button" class="ib c" aria-label="Закрити">{ic("x",16)}</button></div>')
    body = '<div class="stack">' + ''.join([
        b('info', 'info', 'Частина даних не оновлена', 'Revolut не відповідає з 10:42. Показано дані на 2 лист., 09:00.', '<button type="button" class="btn sm">Оновити</button>', 'var(--link)'),
        b('warn', 'triangle-alert', '3 підключення потребують дії', 'Банки просять підтвердити доступ — без цього нові транзакції не надходять.', '<button type="button" class="btn sm">Перепідключити</button>', 'var(--warn)'),
        b('neg', 'circle-alert', 'Помилка. Імпорт не завершено', 'Файл monobank_жовтень.csv пошкоджено. Код: IMP-422.', '<button type="button" class="btn sm">Спробувати ще раз</button>', 'var(--loss)'),
        b('pos', 'circle-check', 'Імпорт завершено', '214 транзакцій додано, 7 чекають розбору.', '<button type="button" class="btn sm">До розбору</button>', 'var(--gain)'),
    ]) + '</div>'
    return ('Стани', 380, 'Інформація, увага, помилка, успіх', body, '.bn{display:flex;align-items:center;gap:12px;padding:10px 10px 10px 14px;border:1px solid var(--line);border-radius:8px;background:var(--inset)}.bi{display:grid;align-self:flex-start;padding-top:1px}')
C['Banner'] = _banner()

C['Toast'] = ('Стани', 220, 'Підтвердження власної дії, з «Скасувати»', f'''<div class="stack" style="align-items:flex-start">
<div class="ts" role="status"><span class="tm">{ic("check",12,3)}</span><span>Категорію змінено для 5 транзакцій</span><a href="#" class="tu">Скасувати</a><button type="button" class="tx" aria-label="Закрити">{ic("x",16)}</button></div>
<div class="ts" role="status"><span class="tm">i</span><span>Ціль збережено</span><button type="button" class="tx" aria-label="Закрити">{ic("x",16)}</button></div>
<div class="ts" role="alert"><span class="tm" style="background:var(--loss);color:var(--surface-200)">{ic("x",12,3)}</span><span>Помилка. Не вдалося зберегти зміни.</span><a href="#" class="tu">Спробувати ще раз</a><button type="button" class="tx" aria-label="Закрити">{ic("x",16)}</button></div>
</div>''', '.ts{display:inline-flex;align-items:center;gap:12px;padding:10px 8px 10px 14px;border-radius:8px;background:var(--toast);color:var(--on-toast);box-shadow:var(--elev)}.tm{width:20px;height:20px;border-radius:999px;background:var(--on-toast);color:var(--toast);display:grid;place-items:center;font:700 11px/1 Inter,sans-serif}.tu{color:var(--on-toast);font-weight:600;text-decoration:underline}.tx{width:32px;height:32px;display:grid;place-items:center;border:0;border-radius:6px;background:transparent;color:var(--on-toast);opacity:.8}')

C['Tooltip'] = ('Стани', 260, 'Повний текст скороченого; розкладка на графіку', f'''<div class="row" style="gap:40px;align-items:flex-start">
<div class="cell"><div class="cap">Кнопка-іконка</div><div style="display:flex;flex-direction:column;align-items:center;gap:6px"><span class="tp">Налаштування рахунку</span><button type="button" class="ib hov" aria-label="Налаштування рахунку">{ic("settings",20)}</button></div></div>
<div class="cell"><div class="cap">Скорочена сума</div><div style="display:flex;flex-direction:column;align-items:flex-start;gap:6px"><span class="tp tab">{eur("128 450,00")}</span><span class="amt" style="text-decoration:underline dotted 2px var(--ink-muted);text-underline-offset:4px">128,4{NB}тис.{NB}€</span></div></div>
<div class="cell"><div class="cap">Розкладка на графіку</div><div class="tp" style="width:300px;padding:10px 12px"><div style="font-weight:600;font-size:13px;padding-bottom:6px">Березень 2026 · Δ м/м</div>
<div class="tl"><span class="key" style="background:var(--ca)"></span><span style="flex:1" class="muted">Витрати</span><b class="tab">{eur("3 288,69")}</b><span class="dn tab" style="width:90px;text-align:right">▲ {eur("792,62")}</span></div>
<div class="tl"><span class="key" style="background:var(--cb)"></span><span style="flex:1" class="muted">Дохід</span><b class="tab">{eur("5 450,00")}</b><span class="up tab" style="width:90px;text-align:right">▲ {eur("70,00")}</span></div></div></div>
</div>''', '.tp{padding:6px 10px;background:var(--surface-200);border:1px solid var(--line);border-radius:8px;box-shadow:var(--elev);font-size:12px;line-height:16px;white-space:nowrap}.tl{display:flex;align-items:center;gap:8px;height:22px}.tl b{font-weight:600;white-space:nowrap}')

def _state_card(title, inner):
    return f'<div class="scard"><span style="font-weight:600">{title}</span><div class="sb">{inner}</div></div>'
SC_CSS = '.scard{background:var(--surface-200);border:1px solid var(--line);border-radius:12px;padding:16px;min-height:220px;display:flex;flex-direction:column;gap:10px}.sb{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center}.sb .muted{font-size:13px;line-height:18px}'

C['EmptyState'] = ('Стани', 300, 'Ще немає даних, нічого не знайдено, роботу завершено', f'''<div class="grid3">
{_state_card("Транзакції", f'<span class="muted">{ic("inbox",32)}</span><span style="font-weight:600">Транзакцій ще немає</span><span class="muted">Додайте першу вручну або імпортуйте виписку.</span><div class="row" style="gap:8px;justify-content:center"><a href="#" class="btn">Імпортувати</a><a href="#" class="btn pri">Нова транзакція</a></div>')}
{_state_card("Транзакції", f'<span class="muted">{ic("search",32)}</span><span style="font-weight:600">Нічого не знайдено</span><span class="muted">Змініть фільтри або пошуковий запит.</span><a href="#" class="btn">Скинути фільтри</a>')}
{_state_card("До розбору", f'<span style="color:var(--gain)">{ic("circle-check",32)}</span><span style="font-weight:600">Усе розібрано</span><span class="muted">Нові транзакції з’являться тут після імпорту.</span>')}
</div>''', SC_CSS)

C['ErrorState'] = ('Стани', 300, 'Без технічних деталей: що не вдалося, повтор і код', f'''<div class="grid3">
{_state_card("Транзакції", '<span style="font-weight:600">Не вдалося завантажити транзакції</span><span class="muted">Перевірте з’єднання і спробуйте ще раз.</span><a href="#" class="btn">Спробувати ще раз</a><span class="muted" style="font:11px ui-monospace,monospace">Код: TX-503</span>')}
{_state_card("Можна витратити", '<span style="font-weight:600">Не вдалося показати картку</span><span class="muted">Решта сторінки працює.</span><a href="#" class="btn" aria-busy="true"><span class="spin"></span>Спробувати ще раз</a><span class="muted" style="font:11px ui-monospace,monospace">Код: BUD-500</span>')}
{_state_card("Рахунки", f'<span class="muted">{ic("wifi-off",32)}</span><span style="font-weight:600">Немає з’єднання з інтернетом</span><span class="muted">Перевірте мережу і спробуйте ще раз.</span><a href="#" class="btn">Спробувати ще раз</a>')}
</div>''', SC_CSS)

C['Skeleton'] = ('Стани', 300, 'Скелетон у формі вмісту', f'''<div class="grid3">
<div class="scard"><span style="font-weight:600">Транзакції</span>{"".join('<div style="display:flex;gap:12px;align-items:center"><span class="sk" style="width:28px;height:28px;border-radius:999px"></span><span class="sk" style="width:40%;height:12px"></span><span style="flex:1"></span><span class="sk" style="width:64px;height:12px"></span></div>' for _ in range(4))}</div>
<div class="scard"><span style="font-weight:600">Можна витратити</span><span class="sk" style="width:50%;height:28px"></span><span class="sk" style="width:100%;height:10px;border-radius:999px"></span><div style="display:flex;gap:6px;align-items:flex-end;height:70px">{"".join(f'<span class="sk" style="width:12%;height:{h}px"></span>' for h in (30,50,40,62,45,70))}</div></div>
<div class="scard"><span style="font-weight:600">Новий рахунок</span><span class="sk" style="width:35%;height:12px"></span><span class="sk" style="width:100%;height:40px;border-radius:8px"></span><span class="sk" style="width:35%;height:12px"></span><span class="sk" style="width:100%;height:40px;border-radius:8px"></span><span class="muted" style="font-size:13px">Ще завантажується…</span></div>
</div>''', SC_CSS)

C['Dialog'] = ('Стани', 560, 'Коротке рішення по центру; форма — ліворуч', f'''<div class="row" style="gap:24px;align-items:flex-start">
<div class="scrim"><div class="dlg" role="alertdialog" aria-modal="true" aria-labelledby="d1"><button type="button" class="ib" style="position:absolute;top:12px;right:12px;border-radius:999px" aria-label="Закрити">{ic("x",20)}</button>
<div style="padding:32px 32px 24px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px"><span class="dic">{ic("save",24)}</span><h2 id="d1" class="h2" style="margin-top:4px">Зберегти зміни?</h2><p class="muted" style="margin:0;font-size:15px;line-height:22px;max-width:380px">Ви змінили залишок рахунку «Поточний рахунок». Збережіть їх, вийдіть без збереження або редагуйте далі.</p></div>
<div class="dft" style="grid-template-columns:repeat(3,minmax(0,1fr))"><button type="button" class="btn lg">Редагувати далі</button><button type="button" class="btn lg danger">Не зберігати</button><button type="button" class="btn lg pri">Зберегти</button></div></div></div>
<div class="scrim"><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="d2"><button type="button" class="ib" style="position:absolute;top:12px;right:12px;border-radius:999px" aria-label="Закрити">{ic("x",20)}</button>
<div style="padding:28px 32px 24px;display:flex;flex-direction:column;gap:16px"><h2 id="d2" class="h2" style="margin-right:40px">Оновити залишок</h2><span class="muted" style="font-size:13px">Поля з * обов'язкові.</span>
<div style="display:flex;justify-content:space-between" class="tab"><span class="muted">Залишок зараз</span><b>{eur("11 400,00")}</b></div>
<label class="fld"><span class="l">Поточний залишок<span class="req">*</span></span><span class="inp foc tab">11 650,00<span style="flex:1"></span><span class="muted">EUR</span></span></label>
<div style="display:flex;justify-content:space-between" class="tab"><span class="muted">Різниця</span><b>{eur("250,00","+")}</b></div></div>
<div class="dft" style="display:flex;justify-content:flex-end;gap:8px"><button type="button" class="btn lg">Скасувати</button><button type="button" class="btn lg pri">Оновити залишок</button></div></div></div>
</div>''', '.scrim{position:relative;padding:24px;border-radius:12px;background:var(--scrim)}.dlg{position:relative;width:500px;max-width:100%;background:var(--surface-200);border-radius:16px;box-shadow:var(--dlg);overflow:hidden}.dic{width:56px;height:56px;border-radius:16px;background:var(--tint);color:var(--brand);display:grid;place-items:center}.dft{display:grid;gap:8px;padding:20px 32px 28px;background:var(--inset);border-top:1px solid var(--surface-300)}.dft .btn{padding:0 12px}')

C['NotificationItem'] = ('Стани', 320, 'Непрочитане, прочитане, виконане (MVP)', f'''<section class="card" style="max-width:620px;overflow:hidden">
<div class="ni" style="background:var(--surface-100)"><span class="nd" aria-label="Непрочитане"></span><span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><b style="font-weight:600">7 нових транзакцій до розбору</b><span class="muted" style="font-size:13px">Імпорт monobank · жовтень 2026</span><span style="margin-top:6px"><button type="button" class="btn sm">До розбору</button></span></span><span class="sub">10 хв</span></div>
<div class="ni"><span style="width:8px"></span><span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="font-weight:500">Revolut потребує підтвердження доступу</span><span class="muted" style="font-size:13px">Без цього нові транзакції не надходять.</span></span><span class="sub">вчора</span></div>
<div class="ni"><span style="width:8px"></span><span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;color:var(--ink-muted)"><span style="font-weight:500">Ціль «Машина» досягнуто</span><span style="font-size:13px;color:var(--gain)">✓ Виконано</span></span><span class="sub">2 лист.</span></div>
</section>''', '.ni{display:flex;gap:12px;padding:14px 16px;border-bottom:1px solid var(--surface-300)}.ni:last-child{border-bottom:0}.nd{width:8px;height:8px;margin-top:6px;border-radius:999px;background:var(--brand-2);flex:none}')

C['Timeline'] = ('Стани', 320, 'Історія одного активу чи рахунку', f'''<div class="tlw">
<div class="ev"><span class="evd"></span><span class="sub">2 лист. 2026</span><b style="font-weight:600">Оновлено оцінку</b><span class="muted">{eur("215 000,00")} · оцінювач «Київ-Експерт»</span></div>
<div class="ev"><span class="evd"></span><span class="sub">14 бер. 2026</span><b style="font-weight:600">Додано страховку житла</b><span class="muted">«Арсенал» · до 14 бер. 2027</span></div>
<div class="ev"><span class="evd"></span><span class="sub">1 черв. 2021</span><b style="font-weight:600">Купівля</b><span class="muted">{eur("168 000,00")} · частка Олени 50 %</span></div>
<a href="#" style="margin-left:32px;font-weight:500">Показати ще</a>
</div>''', '.tlw{position:relative;display:flex;flex-direction:column;gap:20px;max-width:520px}.tlw::before{content:"";position:absolute;left:15px;top:6px;bottom:30px;width:2px;background:var(--line)}.ev{position:relative;display:flex;flex-direction:column;padding-left:32px}.evd{position:absolute;left:10px;top:4px;width:12px;height:12px;border-radius:999px;background:var(--brand);box-shadow:0 0 0 2px var(--surface-100)}')

# ---------------- Поверхні ----------------
C['Card'] = ('Поверхні', 360, 'Плоска, піднята, втоплена; заголовок великими', f'''<div class="grid3">
<section class="card pad" style="display:flex;flex-direction:column;gap:12px"><span style="display:flex;flex-direction:column;gap:2px"><span class="lbl">Гроші разом</span><span class="sub">готівкові мінус кредитні · у EUR</span></span><span class="big">{eur("32 860,00")}</span><span class="muted" style="font-size:13px">{eur("33 500,00")} готівкові − {eur("640,00")} кредитні</span></section>
<section class="card pad raised" style="display:flex;flex-direction:column;gap:12px"><span style="display:flex;align-items:center"><span style="flex:1;display:flex;flex-direction:column;gap:2px"><span class="lbl">Можна витратити</span><span class="sub">до кінця листопада</span></span><button type="button" class="ib c" aria-label="Відкрити «Бюджет»">{ic("chevron-right",16)}</button></span><span class="big">{eur("1 284,70")}</span><span class="bar"><i style="width:62%;background:var(--ca)"></i></span></section>
<section class="card pad" style="display:flex;flex-direction:column;gap:12px"><span class="lbl">Джерела даних</span><div class="card sunken" style="padding:12px 14px;display:flex;justify-content:space-between"><span>Підключені банки</span><b>3</b></div><div class="card sunken" style="padding:12px 14px;display:flex;justify-content:space-between"><span>Вручну</span><b>1</b></div></section>
<a href="#" class="card pad ring" style="color:var(--ink);display:flex;flex-direction:column;gap:6px"><span class="cap">Картка-посилання, фокус</span><b style="font-weight:600">Поточний ··4417</b><span class="amt">{eur("11 400,00")}</span></a>
<section class="card pad" style="display:flex;flex-direction:column;gap:12px"><span class="cap">Завантаження</span><span class="sk" style="width:40%;height:14px"></span><span class="sk" style="width:60%;height:32px"></span><span class="sk" style="width:80%;height:12px"></span></section>
</div>''', '')

def _widget():
    head = lambda t, sub, badge='': f'<div style="display:flex;align-items:flex-start;gap:8px"><span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="display:flex;align-items:center;gap:8px"><span class="h3">{t}</span>{badge}</span><span class="sub">{sub}</span></span><button type="button" class="ib c dis" aria-disabled="true" aria-label="Вигляд: Стовпчики">{ic("chart-no-axes-column",16)}</button><button type="button" class="ib c" aria-label="Відкрити">{ic("chevron-right",16)}</button></div>'
    w = lambda inner: f'<section class="card" style="padding:20px 24px;display:flex;flex-direction:column;gap:14px;min-height:240px">{inner}</section>'
    bars = ''.join(f'<span style="flex:1;height:{h}px;border-radius:2px 2px 0 0;background:var(--ca)"></span>' for h in (52,70,48,88,64,96))
    body = '<div class="grid2">' + ''.join([
        w(head('Витрати', 'Травень — жовтень 2026', '<span class="tag">6 міс.</span>') + f'<span class="big" style="font-size:24px;line-height:32px">{eur("3 288,69")}</span><div style="display:flex;gap:8px;align-items:flex-end;height:96px;border-bottom:1px solid var(--grid)">{bars}</div><a href="#" style="font-weight:500;font-size:13px">Усі витрати</a>'),
        w(head('Витрати', 'Травень — жовтень 2026') + '<span class="sk" style="width:40%;height:28px"></span><div style="display:flex;gap:8px;align-items:flex-end;height:96px">' + ''.join(f'<span class="sk" style="flex:1;height:{h}px"></span>' for h in (40,60,50,80,55,90)) + '</div>'),
        w(head('Цілі', 'Немає активних цілей') + '<div class="sb"><span style="font-weight:600">Ще немає цілей</span><span class="muted" style="font-size:13px">Додайте ціль — тут з’явиться прогрес.</span><a href="#" class="btn pri">Нова ціль</a></div>'),
        w(head('Рахунки', 'Оновлено 12 хв тому') + '<div class="sb"><span style="font-weight:600">Не вдалося показати віджет</span><span class="muted" style="font-size:13px">Решта сторінки працює.</span><a href="#" class="btn">Спробувати ще раз</a><span class="muted" style="font:11px ui-monospace,monospace">Код: ACC-500</span></div>'),
    ]) + '</div>'
    return ('Поверхні', 600, 'Рамка віджета: готово, завантаження, порожньо, помилка', body, '.sb{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center}')
C['Widget'] = _widget()
