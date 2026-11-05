from common import *
C = {}

# ---------------- Основи ----------------
def _icon():
    groups = [
        ('Розділи', [('house','Головна'),('wallet','Гроші'),('arrow-left-right','Транзакції'),('landmark','Рахунки'),('target','Планування'),('flag','Цілі'),('repeat','Регулярні'),('credit-card','Борги'),('calculator','Чи можу я'),('gem','Активи'),('map-pin','Локації'),('file-text','Документи'),('shield-check','Страхування'),('bell','Сповіщення'),('settings','Налаштування'),('search','Пошук')]),
        ('Типи активів', [('building2','Нерухомість'),('car','Транспорт'),('palette','Мистецтво'),('wine','Вино'),('amphora','Колекції'),('watch','Годинники'),('sailboat','Човни'),('briefcase','Компанія'),('banknote','Готівка'),('bitcoin','Крипто'),('umbrella','Пенсія'),('vault','Метали')]),
        ('Дії', [('plus','Додати'),('pencil','Змінити'),('trash2','Видалити'),('upload','Імпорт'),('download','Експорт'),('refresh-cw','Оновити'),('link','Поєднати'),('sliders-horizontal','Параметри'),('arrow-up-down','Сортувати'),('list-filter','Фільтри'),('eye','Показати'),('eye-off','Приховати'),('x','Закрити'),('check','Готово'),('chevron-right','Відкрити'),('ellipsis','Ще дії')]),
    ]
    out = []
    for g, items in groups:
        cells = ''.join(f'<div class="ic">{ic(n,24)}<span>{l}</span></div>' for n, l in items)
        out.append(f'<div class="cell"><div class="sh">{g}</div><div class="icg">{cells}</div></div>')
    sizes = ''.join(f'<div class="ic">{ic("wallet",s)}<span>{s} px</span></div>' for s in (16,20,24,32,40))
    tones = (f'<div class="ic" style="color:var(--ink)">{ic("flag",24)}<span>Основний</span></div>'
             f'<div class="ic" style="color:var(--ink-muted)">{ic("flag",24)}<span>Приглушений</span></div>'
             f'<div class="ic" style="color:var(--brand)">{ic("flag",24)}<span>Бренд</span></div>'
             f'<div class="ic" style="background:var(--brand);color:var(--on-brand)">{ic("flag",24)}<span>На бренді</span></div>')
    out.append(f'<div class="row"><div class="cell"><div class="sh">Розміри</div><div class="icg">{sizes}</div></div><div class="cell"><div class="sh">Тони</div><div class="icg">{tones}</div></div></div>')
    css = '.icg{display:flex;flex-wrap:wrap;gap:8px}.ic{width:96px;height:76px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;border:1px solid var(--line);border-radius:8px;background:var(--surface-200);color:var(--ink)}.ic span{font-size:12px;line-height:16px;color:inherit;opacity:.85;text-align:center}'
    return ('Основи', 640, 'Набір Lucide, контур, штрих 1,8 px як на полотні', '<div class="stack">' + ''.join(out) + '</div>', css)
C['Icon'] = _icon()

C['BrandMark'] = ('Основи', 220, 'Знак, назва, розміри', f'''<div class="row c" style="gap:32px">
<div class="cell"><div class="cap">Знак і назва (навігація)</div><div style="display:flex;align-items:center;gap:10px">{mark(24)}<span style="font:600 18px/24px 'Inter Tight',Inter,sans-serif;letter-spacing:-.02em">Willowsum</span></div></div>
<div class="cell"><div class="cap">Екран входу</div><div style="display:flex;align-items:center;gap:10px">{mark(28)}<span style="font:600 22px/28px 'Inter Tight',Inter,sans-serif;letter-spacing:-.02em">Willowsum</span></div></div>
<div class="cell"><div class="cap">Розміри знака</div><div class="row c" style="gap:16px">{mark(16,True)}{mark(24,True)}{mark(32,True)}{mark(48,True)}</div></div>
<div class="cell"><div class="cap">Фокус</div><a href="#" class="ring" style="display:inline-flex;align-items:center;gap:10px;padding:4px 6px;border-radius:4px;color:var(--ink)">{mark(24)}<span style="font:600 18px/24px 'Inter Tight',Inter,sans-serif;letter-spacing:-.02em">Willowsum</span></a></div>
</div>''', '')

# ---------------- Дії ----------------
def _button():
    rows = []
    for v, cls, lab in [('Основна', 'pri', 'Імпортувати виписку'), ('Другорядна', 'sec', 'Нова транзакція'), ('Тиха', 'quiet', 'Історія імпорту'), ('Небезпечна', 'danger', 'Не зберігати')]:
        cells = []
        for st, extra in [('Типова', ''), ('Наведення', ' hov'), ('Натискання', ' prs'), ('Фокус', ' ring')]:
            icon = ic('upload', 16) if cls == 'pri' else (ic('plus', 16) if cls == 'sec' else '')
            cells.append(f'<div class="cell"><div class="cap">{st}</div><button type="button" class="btn {cls}{extra}">{icon}{lab}</button></div>')
        cells.append(f'<div class="cell"><div class="cap">Вимкнена</div><button type="button" class="btn dis" disabled>{lab}</button></div>')
        cells.append(f'<div class="cell"><div class="cap">Завантаження</div><button type="button" class="btn {cls}" aria-busy="true"><span class="spin" aria-hidden="true"></span>{lab}</button></div>')
        rows.append(f'<div class="cell"><div class="sh">{v}</div><div class="row">{"".join(cells)}</div></div>')
    rows.append(f'''<div class="cell"><div class="sh">Розміри</div><div class="row c">
<button type="button" class="btn pri">{ic("check",16)}Підтвердити</button>
<button type="button" class="btn sm">Ні</button><button type="button" class="btn sm">Зарахувати</button>
<button type="button" class="btn pri lg">Зберегти</button><button type="button" class="btn lg">Редагувати далі</button></div></div>''')
    return ('Дії', 760, 'Основна, другорядна, тиха, небезпечна; усі стани', '<div class="stack">' + ''.join(rows) + '</div>', '')
C['Button'] = _button()

C['IconButton'] = ('Дії', 220, 'Типова 36 px і компактна 28 px, усі стани', f'''<div class="stack">
<div class="row c">
<div class="cell"><div class="cap">Типова</div><button type="button" class="ib" aria-label="Ще дії" title="Ще дії">{ic("ellipsis",20)}</button></div>
<div class="cell"><div class="cap">Наведення</div><button type="button" class="ib hov" aria-label="Параметри">{ic("sliders-horizontal",20)}</button></div>
<div class="cell"><div class="cap">Меню відкрите</div><button type="button" class="ib on" aria-label="Колонки" aria-expanded="true">{ic("columns3",20)}</button></div>
<div class="cell"><div class="cap">Фокус</div><button type="button" class="ib ring" aria-label="Налаштування рахунку">{ic("settings",20)}</button></div>
<div class="cell"><div class="cap">Застосовано</div><button type="button" class="ib" aria-label="Сортувати: за датою, спочатку нові">{ic("arrow-up-down",20)}<span class="dot"></span></button></div>
<div class="cell"><div class="cap">Вимкнена</div><button type="button" class="ib dis" aria-disabled="true" aria-label="Вигляд: Стовпчики">{ic("chart-no-axes-column",20)}</button></div>
<div class="cell"><div class="cap">Завантаження</div><button type="button" class="ib" aria-busy="true" aria-label="Оновити"><span class="spin"></span></button></div>
</div>
<div class="row c">
<div class="cell"><div class="cap">Компактна, у заголовку віджета</div><div class="row c" style="gap:4px"><button type="button" class="ib c" aria-label="Вигляд">{ic("chart-no-axes-column",16)}</button><button type="button" class="ib c" aria-label="Відкрити «Транзакції»">{ic("chevron-right",16)}</button></div></div>
<div class="cell"><div class="cap">Закрити (діалог)</div><button type="button" class="ib" style="border-radius:999px" aria-label="Закрити">{ic("x",20)}</button></div>
<div class="cell"><div class="cap">Змінити категорію</div><button type="button" class="ib" style="width:32px;height:32px;border-radius:4px" aria-label="Змінити категорію">{ic("pencil",16)}</button></div>
</div></div>''', '')

# ---------------- Форми ----------------
C['Field'] = ('Форми', 360, 'Підпис над полем; типовий, наведення, фокус, помилка, вимкнено, лише читання', f'''<div class="grid3">
<label class="fld"><span class="l">Назва<span class="req">*</span></span><span class="inp"><span class="ph">Наприклад, Поточний monobank</span></span><span class="hint">До 40 символів</span></label>
<label class="fld"><span class="l">Email<span class="req">*</span></span><span class="inp hov">olena@example.com</span></label>
<label class="fld"><span class="l">Поточний залишок<span class="req">*</span></span><span class="inp foc tab">12 450,00<span style="flex:1"></span><span class="muted">EUR</span></span></label>
<label class="fld"><span class="l">Сума<span class="req">*</span></span><span class="inp err tab" aria-invalid="true">3 000,005</span><span class="errt">{ic("circle-alert",16)}Помилка. Використовуйте не більше 2 знаків після коми для євро.</span></label>
<label class="fld"><span class="l">Валюта</span><span class="inp dis">EUR — євро</span><span class="hint">Валюту рахунку не можна змінити після імпорту.</span></label>
<label class="fld"><span class="l">Залишок на 1 лист.</span><span class="inp ro tab">{eur("215 000,00")}</span></label>
<label class="fld"><span class="l">Пошук</span><span class="search">{ic("search",16)}<span>Пошук за мерчантом, описом, сумою</span></span></label>
<label class="fld"><span class="l">Назва цілі</span><span class="inp">Відпустка в Італії<span style="flex:1"></span><span class="muted tab" style="font-size:12px">18 / 40</span></span></label>
</div>''', '')

C['Select'] = ('Форми', 320, 'Випадний список: типовий, наведення, фокус, помилка, вимкнено', f'''<div class="grid3">
<label class="fld"><span class="l">Тип рахунку<span class="req">*</span></span><span class="inp">Поточний<span style="flex:1"></span>{ic("chevron-down",16,cls="muted")}</span><span class="hint">Картка або рахунок для щоденних витрат.</span></label>
<label class="fld"><span class="l">Валюта</span><span class="inp hov">UAH — гривня<span style="flex:1"></span>{ic("chevron-down",16)}</span></label>
<label class="fld"><span class="l">Рахунок<span class="req">*</span></span><span class="inp foc">Поточний ··4417<span style="flex:1"></span>{ic("chevron-up",16)}</span></label>
<label class="fld"><span class="l">Категорія<span class="req">*</span></span><span class="inp err" aria-invalid="true"><span class="ph">Оберіть…</span><span style="flex:1"></span>{ic("chevron-down",16)}</span><span class="errt">{ic("circle-alert",16)}Помилка. Обов'язкове поле.</span></label>
<label class="fld"><span class="l">Банк</span><span class="inp dis">monobank<span style="flex:1"></span>{ic("chevron-down",16)}</span></label>
<div class="fld"><span class="l">Відкритий список</span><div class="panel" style="box-shadow:var(--elev)"><div class="mi hov"><span class="i">{ic("check",16)}</span>Поточний</div><div class="mi"><span class="i"></span>Ощадний</div><div class="mi"><span class="i"></span>Кредитна картка</div><div class="mi"><span class="i"></span>Готівка</div></div></div>
</div>''', '')

def _checkbox():
    def box(state, label, extra='', hint=''):
        inner = ''
        if state == 'on': inner = ic('check', 12, 3)
        if state == 'mix': inner = '<span style="width:8px;height:2px;background:currentColor;border-radius:1px"></span>'
        cls = 'chk' + (' on' if state in ('on','mix') else '') + (' dis' if 'dis' in extra else '')
        ring = ' ring' if 'foc' in extra else ''
        col = ' style="color:var(--disabled-ink)"' if 'dis' in extra else ''
        h = f'<span class="hint" style="padding-left:28px">{hint}</span>' if hint else ''
        hov = ' style="border-color:var(--ink)"' if 'hov' in extra else ''
        return f'<label class="cb"{col}><span class="{cls}{ring}"{hov}>{inner}</span><span>{label}</span></label>{h}'
    body = f'''<div class="grid3">
<div class="cell"><div class="cap">Не відмічено</div>{box("off","Показати закриті рахунки")}</div>
<div class="cell"><div class="cap">Відмічено</div>{box("on","Підтвердити категорії")}</div>
<div class="cell"><div class="cap">Частково (вибрано 2 з 5)</div>{box("mix","Вибрати всі")}</div>
<div class="cell"><div class="cap">Наведення</div>{box("off","Приховати переказ","hov")}</div>
<div class="cell"><div class="cap">Фокус</div>{box("on","Застосувати до схожих","foc")}</div>
<div class="cell"><div class="cap">Вимкнено</div>{box("off","Назва (завжди)","dis","Обов'язкова колонка")}</div>
</div>
<div class="card" style="margin-top:20px;overflow:hidden"><div class="th"><span class="chk on">{ic("check",12,3)}</span><span>Контрагент</span></div>
<div class="tr sel"><span class="chk on">{ic("check",12,3)}</span><span class="t1">Сільпо</span><span style="flex:1"></span><span class="amt">{eur("42,80","-")}</span></div>
<div class="tr"><span class="chk"></span><span class="t1">Нова пошта</span><span style="flex:1"></span><span class="amt">{eur("96,10","-")}</span></div></div>'''
    return ('Форми', 400, 'Квадрат 16 px як у таблицях полотна; стани', body, '.cb{display:flex;align-items:center;gap:12px;min-height:44px;cursor:pointer}')
C['Checkbox'] = _checkbox()

def _switch():
    def sw(on, label, extra=''):
        cls = 'sw' + (' on' if on else '') + (' ' + extra if extra else '')
        return f'<label class="swl"><span class="{cls}" role="switch" aria-checked="{"true" if on else "false"}"><i></i></span><span>{label}</span></label>'
    body = f'''<div class="grid3">
<div class="cell"><div class="cap">Вимкнено</div>{sw(False,"Приховати суми")}</div>
<div class="cell"><div class="cap">Увімкнено</div>{sw(True,"Сповіщення email")}</div>
<div class="cell"><div class="cap">Наведення</div>{sw(False,"Показувати віджет","hov")}</div>
<div class="cell"><div class="cap">Фокус</div>{sw(True,"Автоматичні правила","ring")}</div>
<div class="cell"><div class="cap">Недоступно</div>{sw(False,"Синхронізація між пристроями","dis")}<span class="hint">З’явиться після підключення профілю.</span></div>
<div class="cell"><div class="cap">Сервер відмовив</div>{sw(False,"Сповіщення в застосунку")}<span class="errt">{ic("circle-alert",16)}Помилка. Не вдалося зберегти. Спробуйте ще раз.</span></div>
</div>'''
    css = ('.swl{display:flex;align-items:center;gap:12px;min-height:44px}'
           '.sw{position:relative;width:44px;height:28px;flex:none;border-radius:999px;border:1.5px solid var(--ctl);background:var(--surface-200)}'
           '.sw i{position:absolute;top:4.5px;left:4.5px;width:16px;height:16px;border-radius:999px;background:var(--chk)}'
           '.sw.on{background:var(--brand);border-color:var(--brand)}.sw.on i{left:20.5px;background:var(--on-brand)}'
           '.sw.hov{border-color:var(--ink-muted)}.sw.dis{background:var(--disabled-bg);border-color:transparent}.sw.dis i{background:var(--disabled-ink)}')
    return ('Форми', 300, 'Налаштування, що діє одразу', body, css)
C['Switch'] = _switch()

C['Segmented'] = ('Форми', 240, 'Сіра доріжка, обраний сегмент — біла плитка', f'''<div class="stack">
<div class="cell"><div class="cap">Тип транзакції у формі</div><div class="seg" role="radiogroup" aria-label="Тип"><span class="on">Списання</span><span>Надходження</span><span>Переказ</span></div></div>
<div class="cell"><div class="cap">З лічильниками (вкладка «Пари»)</div><div class="seg"><span class="on">Пропозиції · 3</span><span>Односторонні · 2</span><span>Підтверджені · 48</span></div></div>
<div class="row"><div class="cell"><div class="cap">Наведення</div><div class="seg"><span class="on">Місяць</span><span class="hov">Тиждень</span></div></div>
<div class="cell"><div class="cap">Фокус</div><div class="seg"><span class="on ring">Місяць</span><span>Тиждень</span></div></div>
<div class="cell"><div class="cap">Вимкнено</div><div class="seg" style="background:var(--disabled-bg)"><span style="color:var(--disabled-ink)">Місяць</span><span style="color:var(--disabled-ink)">Тиждень</span></div></div></div>
</div>''', '')

C['ThemeSwitch'] = ('Форми', 200, 'Світла, темна, як у системі (MVP)', f'''<div class="stack">
<fieldset style="border:0;margin:0;padding:0;display:flex;flex-direction:column;gap:8px"><legend class="fld" style="padding:0;margin-bottom:8px"><span style="font:500 13px/16px Inter,sans-serif">Тема</span></legend>
<div class="seg" role="radiogroup"><span class="on">{ic("sun",16)}Світла</span><span>{ic("moon",16)}Темна</span><span>{ic("monitor",16)}Як у системі</span></div></fieldset>
<div class="row"><div class="cell"><div class="cap">Обрано «Як у системі»</div><div class="seg"><span>{ic("sun",16)}Світла</span><span>{ic("moon",16)}Темна</span><span class="on">{ic("monitor",16)}Як у системі</span></div></div>
<div class="cell"><div class="cap">Фокус</div><div class="seg"><span>{ic("sun",16)}Світла</span><span class="on ring">{ic("moon",16)}Темна</span><span>{ic("monitor",16)}Як у системі</span></div></div></div>
</div>''', '')

C['HideAmountsToggle'] = ('Форми', 220, 'Суми видно і суми приховано (MVP)', f'''<div class="row" style="gap:32px">
<div class="cell"><div class="cap">Суми видно</div><div class="row c" style="gap:12px"><button type="button" class="ib" aria-pressed="false" aria-label="Приховати суми" title="Приховати суми">{ic("eye",20)}</button><span class="big">{eur("32 860,00")}</span></div></div>
<div class="cell"><div class="cap">Суми приховано</div><div class="row c" style="gap:12px"><button type="button" class="ib on" aria-pressed="true" aria-label="Приховати суми" title="Показати суми">{ic("eye-off",20)}</button><span class="big" aria-label="Сума прихована">•••</span><span class="up">▲ 3,2 % м/м</span></div></div>
<div class="cell"><div class="cap">Фокус</div><button type="button" class="ib ring" aria-label="Приховати суми">{ic("eye",20)}</button></div>
<div class="cell"><div class="cap">У налаштуваннях</div><label style="display:flex;align-items:center;gap:12px;min-height:44px"><span style="position:relative;width:44px;height:28px;border-radius:999px;background:var(--brand)"><i style="position:absolute;top:6px;left:22px;width:16px;height:16px;border-radius:999px;background:var(--on-brand)"></i></span>Приховати суми</label></div>
</div>''', '')

C['Dropzone'] = ('Форми', 560, 'Очікування, файл над зоною, завантаження, помилка, успіх', f'''<div class="grid2">
<div class="cell"><div class="cap">Очікування</div><div class="dz"><span style="color:var(--link)">{ic("upload",24)}</span><b>Перетягніть файли виписок сюди або оберіть їх</b><span class="hint">CSV, XLSX, XLS, OFX, QIF, PDF, фото · до 25 МБ</span><button type="button" class="btn">Обрати файли</button></div></div>
<div class="cell"><div class="cap">Файл над зоною</div><div class="dz" style="border-style:solid;border-color:var(--brand);background:var(--surface-300)"><span style="color:var(--brand)">{ic("upload",24)}</span><b>Відпустіть, щоб завантажити</b><span class="hint">monobank_жовтень.csv</span></div></div>
<div class="cell"><div class="cap">Завантаження</div><div class="dz" style="align-items:stretch;text-align:left"><div style="display:flex;align-items:center;gap:10px">{ic("file-text",20,cls="muted")}<span class="t1" style="flex:1">monobank_жовтень_2026.csv</span><span class="tab muted">45 %</span></div><div class="bar"><i style="width:45%;background:var(--brand-2)"></i></div><div style="display:flex;justify-content:space-between;align-items:center"><span class="hint">Завантажено 45 %</span><button type="button" class="btn sm">Скасувати</button></div></div></div>
<div class="cell"><div class="cap">Помилка</div><div class="dz" style="border-color:var(--loss)"><span style="color:var(--loss)">{ic("circle-alert",24)}</span><b>Помилка. Файл більший за 25 МБ.</b><span class="hint">Оберіть менший файл або розділіть виписку.</span><button type="button" class="btn">Обрати інший файл</button></div></div>
<div class="cell"><div class="cap">Успіх</div><div class="dz" style="border-style:solid"><span style="color:var(--gain)">{ic("circle-check",24)}</span><b>Завантажено</b><span class="hint">monobank_жовтень_2026.csv · 214 рядків</span></div></div>
</div>''', '.dz{display:flex;flex-direction:column;align-items:center;gap:8px;padding:24px;border:2px dashed var(--drop-line);border-radius:12px;background:var(--drop-bg);text-align:center}')

# ---------------- Навігація ----------------
def _nav():
    L1 = [('wallet','Гроші',False),('target','Планування',True)]
    subs = [('wallet','Бюджет',True,''),('flag','Цілі',False,''),('repeat','Регулярні платежі',False,''),('credit-card','Борги',False,''),('calculator','Чи можу я дозволити',False,'')]
    items = f'<div class="nav-i">{ic("wallet",20)}<span>Гроші</span></div><div class="nav-i on" aria-current="page">{ic("target",20)}<span>Планування</span></div><div style="display:flex;flex-direction:column;gap:2px;padding:2px 0 8px">'
    for i, l, on, c in subs:
        items += f'<div class="nav-s{" on" if on else ""}">{ic(i,16)}<span style="flex:1">{l}</span></div>'
    items += '</div>'
    side = f'''<nav class="side" aria-label="Розділи"><div style="display:flex;align-items:center;gap:10px;padding:0 0 16px 8px;min-height:36px">{mark(24)}<span style="font:600 18px/24px 'Inter Tight',Inter,sans-serif;letter-spacing:-.02em">Willowsum</span><span style="flex:1"></span><button type="button" class="ib" style="border-radius:4px;margin-right:-6px" aria-label="Згорнути панель">{ic("panel-left-close",18)}</button></div>
<button type="button" class="btn pri" style="margin:0 0 12px;font-size:15px">{ic("plus",18,2)}Додати</button>{items}<div style="flex:1"></div>
<div style="padding-top:12px;border-top:1px solid var(--surface-300)"><div style="display:flex;align-items:center;gap:10px;min-height:48px;padding:4px 8px"><span class="av">ОК</span><span style="flex:1;min-width:0;display:flex;flex-direction:column;line-height:16px"><span style="font-weight:500">Олена</span><span class="sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Родина Коваленків</span></span>{ic("chevrons-up-down",16,2,cls="muted")}</div></div></nav>'''
    side2 = side.replace('<div class="nav-i">'+ic("wallet",20)+'<span>Гроші</span></div><div class="nav-i on" aria-current="page">'+ic("target",20)+'<span>Планування</span></div>', '')
    money = (f'<div class="nav-i on" aria-current="page">{ic("wallet",20)}<span>Гроші</span></div><div style="display:flex;flex-direction:column;gap:2px;padding:2px 0 8px">'
             f'<div class="nav-s on">{ic("arrow-left-right",16)}<span style="flex:1">Транзакції</span><span class="muted" style="font-size:13px;font-weight:400">7</span></div>'
             f'<div class="nav-s">{ic("landmark",16)}<span style="flex:1">Рахунки</span></div></div><div class="nav-i">{ic("target",20)}<span>Планування</span></div>')
    side_money = side.split('<button type="button" class="btn pri"')[0] + f'<button type="button" class="btn pri" style="margin:0 0 12px;font-size:15px">{ic("plus",18,2)}Додати</button>' + money + '<div style="flex:1"></div>' + side.split('<div style="flex:1"></div>',1)[1]
    rail = f'''<nav class="rail" aria-label="Розділи"><div style="padding:6px 0 8px">{mark(24,True)}</div><button type="button" class="btn pri" style="width:40px;padding:0;margin:4px 0 12px" aria-label="Додати">{ic("plus",18,2)}</button>
<span class="ri on" aria-current="page" title="Гроші">{ic("wallet",20)}</span><span class="ri" title="Планування">{ic("target",20)}</span><div style="flex:1"></div><div style="padding-top:12px;border-top:1px solid var(--surface-300)"><span class="av">ОК</span></div>
<span aria-hidden="true" style="position:absolute;top:0;bottom:0;right:-2px;width:3px;background:var(--brand-2)"></span><button type="button" aria-label="Розгорнути панель" style="position:absolute;top:120px;right:-13px;width:24px;height:24px;padding:0;display:grid;place-items:center;border:1px solid var(--line);border-radius:999px;background:var(--surface-200);color:var(--brand);box-shadow:0 1px 3px rgba(11,37,69,.16)">{ic("chevron-right",14,2.2)}</button></nav>'''
    body = f'<div class="row" style="gap:28px"><div class="cell"><div class="cap">Бічна панель 212 px · Планування → Бюджет</div>{side}</div><div class="cell"><div class="cap">Гроші → Транзакції, лічильник «До розбору»</div>{side_money}</div><div class="cell"><div class="cap">Згорнута 64 px, наведення на межу</div>{rail}</div></div>'
    css = ('.side{width:212px;height:600px;display:flex;flex-direction:column;gap:4px;padding:16px 12px;border:1px solid var(--line);background:var(--surface-200)}'
           '.rail{position:relative;width:64px;height:600px;display:flex;flex-direction:column;align-items:center;gap:4px;padding:16px 10px;border:1px solid var(--line);background:var(--surface-200)}'
           '.ri{width:44px;height:44px;display:grid;place-items:center;border-radius:4px;color:var(--ink-muted)}.ri.on{background:var(--surface-300);color:var(--brand)}')
    return ('Навігація', 660, 'Бічна панель полотна: L1, L2, «+ Додати», профіль; згорнута панель', body, css)
C['AppNavigation'] = _nav()

C['PageHeader'] = ('Навігація', 400, 'Заголовок, підзаголовок, вкладки сторінки і дії', f'''<div class="stack">
<div class="ph"><div style="flex:1 1 360px;min-width:0;display:flex;flex-direction:column;gap:4px"><h1 class="h1">Транзакції</h1><span class="muted">Листопад 2026 · 42 транзакції</span><div class="ptabs" style="margin:6px 0 0 -14px"><span class="ptab on">Транзакції</span><span class="ptab">До розбору · 7</span><span class="ptab">Пари · 3</span></div></div>
<div class="row c" style="gap:8px"><button type="button" class="ib" aria-label="Ще дії">{ic("ellipsis",20)}</button><button type="button" class="btn quiet">Історія імпорту</button><button type="button" class="btn">{ic("plus",16)}Нова транзакція</button><button type="button" class="btn pri">{ic("upload",16)}Імпортувати виписку</button></div></div>
<div class="ph" style="border-top:1px solid var(--line);padding-top:20px"><div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px"><span class="muted">Гроші › Рахунки › Поточний рахунок</span><h1 class="h1">Поточний ··4417</h1><span class="muted">monobank · EUR · оновлено 12 хв тому</span></div><div class="row c" style="gap:8px"><button type="button" class="ib" aria-label="Налаштування рахунку">{ic("settings",20)}</button><button type="button" class="btn pri">{ic("upload",16)}Імпортувати виписку</button></div></div>
<div class="cell" style="border-top:1px solid var(--line);padding-top:20px"><div class="cap">Завантаження</div><span class="sk" style="width:40%;height:28px"></span><span class="sk" style="width:24%;height:14px"></span></div>
</div>''', '.ph{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap}')

C['Tabs'] = ('Навігація', 300, 'Вкладки сторінки (пігулки) і вкладки картки (підкреслення)', f'''<div class="stack">
<div class="cell"><div class="cap">Вкладки сторінки · Гроші</div><div class="ptabs" role="tablist"><span class="ptab on" role="tab" aria-selected="true">Транзакції</span><span class="ptab" role="tab">До розбору · 7</span><span class="ptab" role="tab">Пари · 3</span></div></div>
<div class="cell"><div class="cap">Стани: наведення, фокус, вимкнена</div><div class="ptabs"><span class="ptab on">Рахунки</span><span class="ptab hov">Підключення</span><span class="ptab ring">Архів · 4</span><span class="ptab dis">Закриті</span></div></div>
<div class="cell"><div class="cap">Вкладки картки</div><div class="ctabs" role="tablist"><span class="on">Огляд</span><span>Транзакції</span><span>Документи</span><span>Історія</span></div></div>
</div>''', '.ctabs{display:flex;gap:20px;border-bottom:1px solid var(--line)}.ctabs span{height:44px;display:inline-flex;align-items:center;color:var(--ink-muted);font-weight:500;border-bottom:3px solid transparent;margin-bottom:-1px}.ctabs .on{color:var(--ink);font-weight:600;border-bottom-color:var(--brand)}')

C['PillTabs'] = ('Навігація', 200, 'Швидкий фільтр: рівно один варіант', f'''<div class="stack">
<div class="cell"><div class="cap">Типи активів над галереєю</div><div class="row" style="gap:8px"><span class="pt on">Усі <small>24</small></span><span class="pt">Нерухомість <small>3</small></span><span class="pt">Транспорт <small>2</small></span><span class="pt">Мистецтво <small>11</small></span><span class="pt">Вино <small>8</small></span></div></div>
<div class="row"><div class="cell"><div class="cap">Наведення</div><span class="pt hov">Годинники <small>2</small></span></div><div class="cell"><div class="cap">Фокус</div><span class="pt ring">Човни <small>1</small></span></div><div class="cell"><div class="cap">Вимкнена</div><span class="pt dis">Метали <small>0</small></span></div></div>
</div>''', '.pt{height:36px;display:inline-flex;align-items:center;gap:6px;padding:0 14px;border-radius:999px;color:var(--ink-muted);font:500 14px/20px Inter,sans-serif;white-space:nowrap}.pt small{font:500 12px/16px Inter,sans-serif;font-variant-numeric:tabular-nums;color:var(--ink-muted)}.pt.on{background:var(--surface-300);color:var(--brand);font-weight:600}.pt.hov{color:var(--ink);background:var(--surface-100)}.pt.dis,.pt.dis small{color:var(--disabled-ink)}')

def _stepper():
    def steps(cur):
        names = ['Основне','Контрагент і категорія','Додатково']
        out = []
        for i, n in enumerate(names, 1):
            if i < cur: out.append(f'<span class="st done"><b>{ic("check",12,3)}</b>{n}</span>')
            elif i == cur: out.append(f'<span class="st on" aria-current="step"><b>{i}</b>{n}</span>')
            else: out.append(f'<span class="st"><b>{i}</b>{n}</span>')
        return '<span class="sl"></span>'.join(out)
    body = f'''<div class="stack">
<div class="cell"><div class="cap">Крок 1 у діалозі «Нова транзакція»</div><div class="stp">{steps(1)}</div></div>
<div class="cell"><div class="cap">Крок 2, перший пройдено</div><div class="stp">{steps(2)}</div></div>
<div class="cell"><div class="cap">Майстер імпорту (сторінка)</div><div class="stp"><span class="st done"><b>{ic("check",12,3)}</b>Файли</span><span class="sl"></span><span class="st on"><b>2</b>Перевірка</span><span class="sl"></span><span class="st"><b>3</b>Результат</span><span class="sl"></span><span class="st err"><b>!</b>Помилка у кроці</span></div></div>
</div>'''
    css = ('.stp{display:flex;align-items:center;gap:2px;flex-wrap:wrap}.sl{width:10px;height:1px;background:var(--ctl)}'
           '.st{height:44px;display:inline-flex;align-items:center;gap:8px;padding:0 10px 0 8px;border-radius:999px;color:var(--ink-muted);font:500 13px/18px Inter,sans-serif;white-space:nowrap}'
           '.st b{width:20px;height:20px;border-radius:999px;display:grid;place-items:center;background:var(--surface-300);color:var(--ink-muted);font:700 11px/1 Inter,sans-serif}'
           '.st.on{background:var(--tint);color:var(--ink);font-weight:600}.st.on b{background:var(--brand);color:var(--on-brand)}'
           '.st.done b{background:var(--brand-2);color:var(--surface-100)}.st.done{color:var(--ink)}.st.err b{background:var(--loss);color:var(--surface-200)}.st.err{color:var(--loss)}')
    return ('Навігація', 300, 'Кроки форми в діалозі і майстра', body, css)
C['Stepper'] = _stepper()

C['Pagination'] = ('Навігація', 200, 'Розмір сторінки, діапазон, попередня і наступна', f'''<div class="stack">
<div class="pg"><span class="muted">Рядків на сторінці</span><span class="inp" style="height:32px;padding:0 8px 0 10px;gap:4px">25{ic("chevron-down",14,cls="muted")}</span><span class="tab">1–25 з 1 240</span><button type="button" class="ib dis" aria-label="Попередня сторінка" aria-disabled="true">{ic("chevron-left",20)}</button><button type="button" class="ib" aria-label="Наступна сторінка">{ic("chevron-right",20)}</button></div>
<div class="pg"><span class="muted">Рядків на сторінці</span><span class="inp" style="height:32px;padding:0 8px 0 10px;gap:4px">50{ic("chevron-down",14,cls="muted")}</span><span class="tab">1 201–1 240 з 1 240</span><button type="button" class="ib ring" aria-label="Попередня сторінка">{ic("chevron-left",20)}</button><button type="button" class="ib dis" aria-label="Наступна сторінка" aria-disabled="true">{ic("chevron-right",20)}</button></div>
</div>''', '.pg{display:flex;align-items:center;justify-content:flex-end;gap:12px}')

C['PeriodPicker'] = ('Навігація', 320, 'Тип періоду і конкретний період в одній групі', f'''<div class="stack">
<div class="cell"><div class="cap">Місяць, наступний ще не почався</div><div class="pp"><span class="pt1">Місяць{ic("chevron-down",16,cls="muted")}</span><span class="pp2"><button type="button" class="ib" style="width:32px;height:32px;border-radius:4px" aria-label="Попередній період">{ic("chevron-left",16)}</button><b>Жовтень 2026</b><button type="button" class="ib dis" style="width:32px;height:32px;border-radius:4px" aria-label="Наступний період" aria-disabled="true">{ic("chevron-right",16)}</button></span></div></div>
<div class="row"><div class="cell"><div class="cap">Квартал</div><div class="pp"><span class="pt1">Квартал{ic("chevron-down",16,cls="muted")}</span><span class="pp2"><button type="button" class="ib" style="width:32px;height:32px;border-radius:4px" aria-label="Попередній період">{ic("chevron-left",16)}</button><b>III квартал 2026</b><button type="button" class="ib" style="width:32px;height:32px;border-radius:4px" aria-label="Наступний період">{ic("chevron-right",16)}</button></span></div></div>
<div class="cell"><div class="cap">Список типів відкрито</div><div class="panel" style="width:220px"><div class="mi"><span class="i">{ic("check",16)}</span>Місяць</div><div class="mi hov"><span class="i"></span>Квартал</div><div class="mi"><span class="i"></span>З початку року</div><div class="mi"><span class="i"></span>Рік</div><div class="mi"><span class="i"></span>Власний</div></div></div></div>
</div>''', '.pp{align-self:flex-start;display:inline-flex;align-items:center;height:38px;border:1px solid var(--ctl);border-radius:8px;background:var(--surface-200)}.pt1{height:36px;display:inline-flex;align-items:center;gap:6px;padding:0 8px 0 12px;border-right:1px solid var(--line);font-weight:500}.pp2{display:inline-flex;align-items:center;gap:2px;padding:0 2px}.pp2 b{padding:0 6px;font-weight:600;white-space:nowrap}')

C['CommandPalette'] = ('Навігація', 460, 'Пошук у верхньому рядку, результати під полем (MVP)', f'''<div style="max-width:560px">
<div class="search ring" style="height:40px;color:var(--ink)">{ic("search",16,cls="muted")}<span style="flex:1">сільпо</span><button type="button" class="ib c" aria-label="Очистити">{ic("x",16)}</button></div>
<div class="panel" style="margin-top:8px;padding:4px 4px 0"><div class="mh">Транзакції</div>
<div class="mi hov" style="box-shadow:inset 3px 0 0 var(--brand);font-weight:600"><span class="logo" style="width:24px;height:24px;border-radius:6px"><span style="width:15px;height:15px;border-radius:4px;background:#F26522;font-size:9px">С</span></span>Сільпо · 2 лист.<span class="k amt" style="font-size:13px;color:var(--ink)">{eur("42,80","-")}</span></div>
<div class="mi"><span class="logo" style="width:24px;height:24px;border-radius:6px"><span style="width:15px;height:15px;border-radius:4px;background:#F26522;font-size:9px">С</span></span>Сільпо · 28 жовт.<span class="k amt" style="font-size:13px;color:var(--ink)">{eur("118,35","-")}</span></div>
<div class="mh">Переходи</div><div class="mi"><span class="i">{ic("arrow-left-right",16)}</span>Транзакції<span class="k">G T</span></div><div class="mi"><span class="i">{ic("wallet",16)}</span>Бюджет<span class="k">G B</span></div>
<div class="mh">Дії</div><div class="mi"><span class="i">{ic("plus",16)}</span>Нова транзакція</div><div class="mi"><span class="i">{ic("upload",16)}</span>Імпортувати виписку</div>
<div style="display:flex;justify-content:space-between;align-items:center;margin:4px -4px 0;padding:8px 14px;border-top:1px solid var(--line);font-size:12px" class="muted"><span>↑ ↓ — вибір · Enter — відкрити · Esc — закрити</span><a href="#" style="font-weight:500">Усі результати · 14</a></div></div>
</div>''', '')

C['Checklist'] = ('Навігація', 200, 'Смуга кроків налаштування (MVP)', f'''<div class="stack">
<div class="chl"><span style="display:flex;flex-direction:column;line-height:16px"><b style="font-weight:600;line-height:20px">Чек-лист налаштування</b><span class="sub">3 з 5</span></span>
<span class="cs">{ic("circle",16,cls="muted")}Підключити банк</span><span class="cs">{ic("circle",16,cls="muted")}Створити бюджет</span><span class="cs hov">{ic("circle",16,cls="muted")}Додати ціль</span><span class="cs done"><span style="color:var(--gain)">{ic("check",16,2.6)}</span><s>Додати рахунок</s></span><span class="cs" style="padding:0 10px">+1 {ic("chevron-down",14)}</span><span style="flex:1"></span><button type="button" class="ib" aria-label="Приховати чек-лист">{ic("x",20)}</button></div>
<div class="chl"><span style="color:var(--gain)">{ic("circle-check",20)}</span><b style="font-weight:600">Усе налаштовано</b><span class="muted">Можна приховати чек-лист.</span><span style="flex:1"></span><button type="button" class="btn sm">Приховати</button></div>
</div>''', '.chl{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px 10px 16px;background:var(--surface-200);border:1px solid var(--line);border-radius:8px}.cs{height:32px;display:inline-flex;align-items:center;gap:6px;padding:0 12px 0 10px;border-radius:999px;background:var(--surface-100);border:1px solid var(--line);font-size:13px;white-space:nowrap}.cs.hov{background:var(--surface-300)}.cs.done{color:var(--ink-muted)}')

C['Tree'] = ('Навігація', 340, 'Вкладені локації і групи', f'''<div class="card" style="max-width:360px;padding:4px">
<div class="tn">{ic("chevron-down",16,cls="muted")}<span class="t1" style="font-weight:500">Україна</span><span class="n">14</span></div>
<div class="tn" style="padding-left:28px">{ic("chevron-down",16,cls="muted")}<span style="font-weight:500">Київ, Поділ</span><span class="n">9</span></div>
<div class="tn on" style="padding-left:44px" aria-current="true">{ic("chevron-right",16,cls="muted")}<span>Квартира</span><span class="n">6</span></div>
<div class="tn" style="padding-left:44px">{ic("chevron-right",16,cls="muted")}<span>Гараж</span><span class="n">3</span></div>
<div class="tn ring-in" style="padding-left:28px">{ic("chevron-right",16,cls="muted")}<span>Дача, Козин</span><span class="n">5</span></div>
<div class="tn">{ic("chevron-right",16,cls="muted")}<span style="font-weight:500">Іспанія</span><span class="n">2</span></div>
<div class="tn" style="padding-left:28px"><span style="width:16px"></span><span class="sk" style="width:50%;height:12px"></span></div>
</div>''', '.tn{display:flex;align-items:center;gap:8px;min-height:40px;padding:0 10px 0 12px;border-radius:4px}.tn .n{margin-left:auto;font-size:13px;color:var(--ink-muted);font-variant-numeric:tabular-nums}.tn.on{background:var(--surface-300);box-shadow:inset 3px 0 0 var(--brand);font-weight:600}')

C['ViewSwitch'] = ('Навігація', 320, 'Група кнопок-іконок і варіант «меню» (MVP)', f'''<div class="stack">
<div class="row">
<div class="cell"><div class="cap">Картки / Таблиця</div><div class="vs" role="radiogroup" aria-label="Показати як"><span class="on" aria-label="Картки">{ic("layout-grid",16)}</span><span aria-label="Таблиця">{ic("table",16)}</span></div></div>
<div class="cell"><div class="cap">Наведення</div><div class="vs"><span class="on">{ic("layout-grid",16)}</span><span class="hov">{ic("table",16)}</span></div></div>
<div class="cell"><div class="cap">Фокус</div><div class="vs"><span class="on ring">{ic("layout-grid",16)}</span><span>{ic("table",16)}</span></div></div>
<div class="cell"><div class="cap">PoC: вимкнено</div><button type="button" class="ib c dis" aria-disabled="true" aria-label="Вигляд: Стовпчики" title="Вигляд: Стовпчики">{ic("chart-no-axes-column",16)}</button></div>
</div>
<div class="cell"><div class="cap">Варіант «меню» в заголовку віджета</div><div class="row" style="gap:12px;align-items:flex-start"><button type="button" class="ib c on" aria-expanded="true" aria-label="Вигляд: Діаграма">{ic("chart-no-axes-column",16)}</button>
<div class="panel" style="width:220px"><div class="mi"><span class="i">{ic("chart-pie",16)}</span>Діаграма<span class="k">{ic("check",16)}</span></div><div class="mi hov"><span class="i">{ic("chart-column",16)}</span>Стовпчики</div><div class="mi"><span class="i">{ic("chart-line",16)}</span>Тренд</div><div class="mi"><span class="i">{ic("table",16)}</span>Таблиця</div></div></div></div>
</div>''', '.vs{display:inline-flex;gap:2px}.vs span{width:28px;height:28px;display:grid;place-items:center;border-radius:4px;color:var(--ink-muted)}.vs .on{background:var(--surface-300);color:var(--ink);box-shadow:inset 0 -2px 0 var(--brand)}.vs .hov{color:var(--ink);background:var(--surface-100)}')
