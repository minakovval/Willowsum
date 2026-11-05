from common import *
from comps3 import spark, donut, SVGCSS, HATCH, ringp
C = {}

# ---------------- Продукт ----------------
def brow(name, spent, limit, pct, state, color, right, over=False):
    tail = f'<i style="position:absolute;left:100%;top:0;width:{over}%;height:6px;border-radius:0 999px 999px 0;background:var(--loss);opacity:.55"></i>' if over else ''
    return (f'<div class="br"><div style="display:flex;align-items:baseline;gap:12px"><b style="font-weight:600;font-size:16px;line-height:24px;flex:1" class="t1">{name}</b><span class="muted tab">{spent} з {limit}</span></div>'
            f'<div style="display:flex;align-items:center;gap:16px"><span class="bar" style="flex:1"><i style="width:{min(pct,100)}%;background:{color}"></i>{tail}</span><span style="width:150px;text-align:right;display:flex;flex-direction:column"><span class="amt">{right[0]}</span><span class="sub">{right[1]}</span></span></div>'
            f'<span style="font-size:13px;{state[1]}">{state[0]}</span></div>')

C['BudgetRow'] = ('Продукт', 520, 'Витрачено з ліміту, смуга і стан', '<section class="card" style="max-width:720px;overflow:hidden">' + ''.join([
    brow('Продукти', eur('412,40'), eur('600,00'), 69, ('• є залишок', 'color:var(--ink-muted)'), 'var(--ca)', (eur('187,60'), '31 % ліміту залишилось')),
    brow('Кафе і ресторани', eur('258,00'), eur('300,00'), 86, ('! майже вичерпано · 86 %', 'color:var(--warn)'), 'var(--ca)', (eur('42,00'), '14 % ліміту')),
    brow('Комунальні', eur('188,20'), eur('188,20'), 100, ('✓ ліміт вичерпано', 'color:var(--gain)'), 'var(--ca)', (eur('0,00'), 'обов’язкова')),
    brow('Таксі', eur('162,60'), eur('120,00'), 100, ('✕ перевищено', 'color:var(--loss)'), 'var(--loss)', (eur('42,60', '-'), '35 % понад ліміт'), over=12),
    brow('Подарунки', eur('0,00'), eur('150,00'), 0, ('• не почато', 'color:var(--ink-muted)'), 'var(--ca)', (eur('150,00'), '100 % ліміту')),
]) + '<div class="br"><span class="sk" style="width:40%;height:16px"></span><span class="sk" style="width:100%;height:6px"></span><span class="sk" style="width:25%;height:12px"></span></div></section>',
    '.br{display:flex;flex-direction:column;gap:8px;padding:14px 20px;border-bottom:1px solid var(--surface-300)}.br:last-child{border-bottom:0}.bar{overflow:visible}')

def conn(letter, color, name, upd, badge, detail, actions):
    return (f'<section class="card" style="padding:18px 20px;display:flex;flex-direction:column;gap:12px"><div style="display:flex;align-items:center;gap:12px"><span class="logo" style="width:40px;height:40px;border-radius:10px"><span style="width:24px;height:24px;border-radius:7px;background:{color};font-size:13px">{letter}</span></span>'
            f'<span style="flex:1;min-width:0;display:flex;flex-direction:column"><b class="t1" style="font-size:16px;line-height:24px">{name}</b><span class="muted">{upd}</span></span>{badge}</div>{detail}<div style="display:flex;gap:8px;justify-content:flex-end">{actions}</div></section>')

C['ConnectionCard'] = ('Продукт', 520, 'Активне, потребує дії, помилка, відключено, листи', '<div class="grid2">' + ''.join([
    conn('m', '#1B2230', 'monobank', 'Оновлено 12 хв тому · 3 рахунки', '<span class="tag pos">✓ Активне</span>', '', f'<button type="button" class="btn">{ic("refresh-cw",16)}Оновити зараз</button>'),
    conn('R', '#0F5BA8', 'Revolut · Олена', 'Оновлено 3 дні тому', '<span class="tag warn">! Потребує дії</span>', '<span class="inset" style="font-size:13px">Банк просить підтвердити доступ. Без цього нові транзакції не надходять.</span>', '<button type="button" class="btn pri">Перепідключити</button>'),
    conn('B', '#004481', 'BBVA', 'Остання спроба 10:42', '<span class="tag neg">✕ Помилка</span>', '<span class="inset" style="font-size:13px">Банк тимчасово не відповідає.<br><span class="muted" style="font-size:13px">Код: 4012</span></span>', '<button type="button" class="btn" aria-busy="true"><span class="spin"></span>Спробувати ще раз</button>'),
    conn('П', '#2E7D32', 'ПриватБанк', 'Відключено 12 вер. 2026 · дані лише для читання', '<span class="tag">• Відключено</span>', '', '<button type="button" class="btn">Підключити знову</button>'),
    conn('A', '#D71920', 'Абанк · Листи від банку', 'Останній лист 1 лист.', '<span class="tag info">i Листи</span>', '', '<button type="button" class="btn quiet">Налаштувати пересилання</button>'),
]) + '</div>', '')

def plan(name, price, desc, feats, cta, badge='', cur=False):
    st = 'border:2px solid var(--brand);' if cur else ''
    fl = ''.join(f'<li>{ic("check",16,2.2)}<span>{f}</span></li>' for f in feats)
    return (f'<section class="card" style="{st}padding:24px;display:flex;flex-direction:column;gap:12px"><span style="min-height:20px">{badge}</span><span class="h2">{name}</span>'
            f'<span style="display:flex;align-items:baseline;gap:6px"><b class="amt" style="font:600 28px/36px \'Inter Tight\',Inter,sans-serif">{price}</b><span class="muted">/ міс</span></span><span class="muted">{desc}</span><ul class="fl">{fl}</ul><span style="flex:1"></span>{cta}</section>')

C['PlanCard'] = ('Продукт', 520, 'План, поточний, рекомендований', '<div class="grid3">' + ''.join([
    plan('Базовий', eur('0,00'), 'Рахунки, транзакції і бюджет для однієї людини.', ['До 3 рахунків', 'Імпорт CSV і XLSX', 'Бюджет і цілі'], '<button type="button" class="btn dis wide" disabled>Поточний план</button>', '<span class="tag info">Поточний</span>', True),
    plan('Родина', eur('6,99'), 'Спільний простір для всієї родини.', ['До 6 учасників', 'Підключення банків', 'Активи і документи'], '<button type="button" class="btn pri wide">Перейти на «Родина»</button>', '<span class="tag pos">Рекомендований</span>'),
    plan('Капітал', eur('14,99'), 'Для складного майна і кількох країн.', ['Необмежено учасників', 'Мапа активів', 'Звіти для радника'], '<button type="button" class="btn wide">Перейти на «Капітал»</button>'),
]) + '</div>', '.fl{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}.fl li{display:flex;gap:8px;align-items:flex-start}.fl svg{color:var(--gain);margin-top:2px}')

# ---------------- Активи ----------------
PH_ICON = {'Нерухомість': 'building2', 'Транспорт': 'car', 'Мистецтво': 'palette', 'Вино': 'wine', 'Колекційні предмети': 'amphora', 'Годинники': 'watch', 'Човни': 'sailboat', 'Компанія': 'briefcase', 'Готівка': 'banknote', 'Криптовалюта': 'bitcoin', 'Пенсія': 'umbrella', 'Метали': 'vault',
           'Рахунок': 'landmark', 'Картка': 'credit-card', 'Кредит': 'hand-coins', 'Іпотека': 'house', 'Страхування': 'shield-check', 'Інвестиції': 'trending-up', 'Ціль': 'flag', 'Документ': 'file-text', 'Сейф': 'lock', 'Список бажань': 'heart', 'Інше': 'shapes'}

def ph(kind, size='tile', w=None):
    i = PH_ICON[kind]
    if size == 'thumb':
        return f'<span class="phd" style="width:48px;height:48px;border-radius:8px" role="img" aria-label="{kind}, фото ще немає">{ic(i,24,1.4)}</span>'
    big = size == 'large'
    return (f'<span class="phd" style="aspect-ratio:4/3;width:{w or "100%"};border-radius:8px" role="img" aria-label="{kind}, фото ще немає">{ic(i,56 if big else 36,1.1 if not big else 1)}'
            f'<b>{kind}</b>{"<span class=sub>Фото ще немає</span>" if big else ""}</span>')
PH_CSS = '.phd{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:12px;background:radial-gradient(circle at 30% 20%,var(--surface-200),var(--surface-300));color:var(--ink-muted);text-align:center}.phd b{font:600 13px/18px Inter,sans-serif;white-space:nowrap}'

C['AssetPlaceholder'] = ('Активи', 900, 'Заглушка без фото для кожного виду: thumb, tile, large', f'''<div class="stack">
<div class="cell"><div class="sh">Речі, якими володіють</div><div class="phg">{"".join(ph(k) for k in list(PH_ICON)[:12])}</div></div>
<div class="cell"><div class="sh">Гроші, покриття і плани</div><div class="phg">{"".join(ph(k) for k in list(PH_ICON)[12:])}</div></div>
<div class="row" style="align-items:flex-end"><div class="cell"><div class="cap">Мініатюра · 48 px</div><div class="row" style="gap:8px">{ph("Вино","thumb")}{ph("Нерухомість","thumb")}{ph("Рахунок","thumb")}</div></div><div class="cell"><div class="cap">Великий · переглядач</div>{ph("Мистецтво","large","320px")}</div></div>
</div>''', PH_CSS + '.phg{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}')

def tile(name, kind, value, photo=None, badge='', count=''):
    img = ph(kind) if not photo else f'<span style="display:block;aspect-ratio:4/3;border-radius:8px 8px 0 0;background:{photo}"></span>'
    if not photo: img = img.replace('border-radius:8px', 'border-radius:8px 8px 0 0')
    b = f'<span class="tag warn" style="position:absolute;left:8px;top:8px">{badge}</span>' if badge else ''
    c = f'<span style="position:absolute;right:8px;top:calc(75% - 30px);height:22px;padding:0 8px;border-radius:999px;background:var(--ink);color:var(--surface-100);font:500 12px/22px Inter,sans-serif">{ic("camera",12)} {count}</span>' if count else ''
    return (f'<button type="button" class="at"><span style="position:relative;display:block">{img}{b}{c}</span><span style="display:flex;flex-direction:column;padding:10px 12px 12px;text-align:left"><b class="t1" style="font-size:14px">{name}</b><span class="muted tab" style="font-size:13px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{kind} · {value}</span></span></button>')
AT_CSS = PH_CSS + '.at{display:flex;flex-direction:column;padding:0;border:1px solid var(--line);border-radius:8px;background:var(--surface-200);overflow:hidden;cursor:pointer;color:var(--ink);min-width:0}.at.hov{border-color:var(--ink)}.atg{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}'
PHOTO1 = 'linear-gradient(160deg,#C9D6E3 0 45%,#8FA6BD 45% 60%,#5E7590 60%)'
PHOTO2 = 'linear-gradient(200deg,#E8DCC6 0 50%,#B9A27E 50% 70%,#7D6747 70%)'
TILES = [tile('Квартира на Подолі', 'Нерухомість', eur('215 000,00'), PHOTO1, count='6'), tile('Дача, Козин', 'Нерухомість', eur('78 000,00'), PHOTO2, '! Оцінка застаріла', '3'),
         tile('Toyota RAV4', 'Транспорт', eur('24 500,00')), tile('Château Margaux 2015', 'Вино', eur('1 240,00')), tile('Omega Speedmaster', 'Годинники', eur('6 800,00')), tile('Картина М. Приймаченко', 'Мистецтво', eur('12 000,00'))]

C['AssetGallery'] = ('Активи', 760, 'Сітка, виділений перший, завантаження (MVP)', f'''<div class="stack">
<div class="cell"><div class="cap">Сітка</div><div class="atg">{"".join(TILES[:5])}</div></div>
<div class="cell"><div class="cap">Перший виділений</div><div class="feat">{TILES[0]}{"".join(TILES[2:6])}</div></div>
<div class="cell"><div class="cap">Завантаження</div><div class="atg">{"".join('<span class="sk" style="aspect-ratio:4/3;border-radius:8px"></span>' for _ in range(4))}</div></div>
</div>''', AT_CSS + '.feat{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.feat>.at:first-child{grid-column:span 2;grid-row:span 2}')

C['FolderCard'] = ('Активи', 400, 'Папка або група активів у сітці (MVP)', f'''<div class="atg" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">
<button type="button" class="at"><span style="display:block;aspect-ratio:4/3;background:{PHOTO2}"></span><span class="fc"><b style="font-size:16px;line-height:24px">Дача, Козин</b><span class="muted">5 активів</span><b class="amt" style="font:600 18px/24px 'Inter Tight',Inter,sans-serif">{eur("92 400,00")}</b></span></button>
<button type="button" class="at hov"><span class="phd" style="aspect-ratio:4/3">{ic("wine",36,1.1)}<b>Вино</b></span><span class="fc"><b style="font-size:16px;line-height:24px">Колекція вин</b><span class="muted">24 пляшки</span><b class="amt" style="font:600 18px/24px 'Inter Tight',Inter,sans-serif">≈ {eur("18 450,00")}</b></span></button>
<button type="button" class="at ring"><span class="phd" style="aspect-ratio:4/3">{ic("folder",36,1.1)}<b>Змішані</b></span><span class="fc"><b style="font-size:16px;line-height:24px">Спадок</b><span class="muted">7 активів</span><b class="amt" style="font:600 18px/24px 'Inter Tight',Inter,sans-serif">{eur("41 300,00")}</b></span></button>
<button type="button" class="at"><span class="phd" style="aspect-ratio:4/3">{ic("folder",36,1.1)}<b>Порожня</b></span><span class="fc"><b style="font-size:16px;line-height:24px">Гараж</b><span class="muted">0 активів</span><b class="amt muted">–</b></span></button>
</div>''', AT_CSS + '.fc{display:flex;flex-direction:column;padding:12px 14px 14px;text-align:left}')

MAPBG = ('<svg viewBox="0 0 640 400" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" aria-hidden="true" style="position:absolute;inset:0">'
         '<rect width="640" height="400" class="ml"/><path d="M0 250 C120 210 200 300 330 260 S520 180 640 220 V400 H0Z" class="mw"/><path d="M380 40 h120 v90 h-120z" class="mp" rx="8"/>'
         '<path d="M0 120 L640 160 M200 0 L260 400 M0 330 L640 300 M470 0 L430 400" class="mr" stroke-width="6" fill="none"/><path d="M0 60 L640 90 M90 0 L120 400 M560 0 L590 400" class="mr" stroke-width="3" fill="none"/></svg>')
MAP_CSS = '.ml{fill:var(--surface-100)}.mw{fill:var(--surface-300)}.mp{fill:var(--surface-300)}.mr{stroke:var(--surface-200)}[data-theme="dark"] .mr{stroke:#24456F}'

def pin(x, y, icon, sel=False):
    s = 44 if sel else 36
    bg = 'var(--ink)' if sel else 'var(--brand)'
    return (f'<button type="button" class="pin" style="left:{x}%;top:{y}%;width:{s}px;height:{s}px;background:{bg}" aria-label="маркер">{ic(icon,18 if not sel else 20)}</button>')

def amap(h=320):
    return (f'<div class="mapf" style="height:{h}px">{MAPBG}{pin(30,40,"building2",True)}{pin(62,30,"car")}{pin(70,62,"wine")}'
            f'<span class="clu" style="left:45%;top:68%">4</span><span class="apx" style="left:16%;top:18%"></span>'
            f'<span class="zm"><button type="button" aria-label="Наблизити">{ic("plus",18)}</button><button type="button" aria-label="Віддалити">{ic("minus",18)}</button></span><span class="attr">© Willowsum</span></div>')
AMAP_CSS = MAP_CSS + ('.mapf{position:relative;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--surface-100)}'
                      '.pin{position:absolute;transform:translate(-50%,-50%);display:grid;place-items:center;border:2px solid var(--surface-200);border-radius:999px 999px 999px 4px;color:var(--on-brand);box-shadow:var(--shadow-raised);padding:0}'
                      '.clu{position:absolute;transform:translate(-50%,-50%);width:40px;height:40px;border-radius:999px;background:var(--brand-2);color:#FFFFFF;display:grid;place-items:center;font:600 14px Inter,sans-serif;border:2px solid var(--surface-200)}[data-theme="dark"] .clu{color:var(--surface-100)}'
                      '.apx{position:absolute;width:90px;height:90px;transform:translate(-50%,-50%);border-radius:999px;border:2px dashed var(--brand);background:color-mix(in srgb,var(--brand) 14%,transparent)}'
                      '.zm{position:absolute;right:10px;bottom:28px;display:flex;flex-direction:column;border:1px solid var(--line);border-radius:8px;background:var(--surface-200);overflow:hidden}.zm button{width:44px;height:44px;border:0;background:transparent;display:grid;place-items:center;color:var(--ink)}.zm button+button{border-top:1px solid var(--line)}'
                      '.attr{position:absolute;right:8px;bottom:6px;font-size:11px;color:var(--ink-muted)}')

def mapsel():
    return (f'<div class="card" style="display:flex;gap:12px;align-items:center;padding:12px"><span style="width:72px;height:54px;border-radius:6px;background:{PHOTO1};flex:none"></span><span style="flex:1;min-width:0;display:flex;flex-direction:column"><b class="t1">Квартира на Подолі</b><span class="t2">Нерухомість · вул. Сагайдачного, Київ</span><b class="amt" style="font-size:13px">{eur("215 000,00")}</b></span><button type="button" class="btn sm">Відкрити</button></div>')

C['AssetMap'] = ('Активи', 640, 'Маркери, кластер, приблизна зона, картка вибраного (MVP)', f'''<div class="stack" style="gap:12px">
<div class="row c" style="gap:8px"><span class="tg on">{ic("check",16)}Нерухомість · 3</span><span class="tg on">{ic("check",16)}Транспорт · 2</span><span class="tg on">{ic("check",16)}Вино · 1</span><span class="tg">Човни · 1</span></div>
{amap(360)}{mapsel()}
<div style="display:flex;justify-content:space-between;font-size:13px" class="muted"><span>2 активи без локації · 1 адресу не розпізнано</span><a href="#" style="font-weight:500">Показати списком</a></div>
</div>''', AMAP_CSS + '.tg{height:32px;display:inline-flex;align-items:center;gap:6px;padding:0 12px;border-radius:999px;border:1px solid var(--ctl);background:var(--surface-200);font:500 13px Inter,sans-serif;white-space:nowrap}.tg.on{background:var(--tint);border-color:transparent;color:var(--brand);font-weight:600}')

def mini(s, kind='pt'):
    inner = MAPBG
    if kind == 'pt': dot = '<span class="mpt"></span>'
    elif kind == 'apx': dot = '<span class="apx" style="left:50%;top:50%;width:60%;height:60%"></span>'
    elif kind == 'err': return f'<span class="mini" style="width:{s}px;height:{s}px;display:grid;place-items:center;background:var(--surface-300);color:var(--ink-muted)">{ic("map-pin",16)}</span>'
    else: return f'<span class="sk" style="width:{s}px;height:{s}px;border-radius:8px"></span>'
    return f'<span class="mini" style="width:{s}px;height:{s}px">{inner}{dot}</span>'

C['MiniMap'] = ('Активи', 240, 'Статична мапа з однією точкою або зоною (MVP)', f'''<div class="row c" style="gap:28px">
<div class="cell"><div class="cap">96 px · картка активу</div>{mini(96)}</div>
<div class="cell"><div class="cap">56 px · заголовок групи</div>{mini(56)}</div>
<div class="cell"><div class="cap">44 px</div>{mini(44)}</div>
<div class="cell"><div class="cap">Приблизна зона</div>{mini(96,"apx")}</div>
<div class="cell"><div class="cap">Помилка підкладки</div>{mini(96,"err")}</div>
<div class="cell"><div class="cap">Завантаження</div>{mini(96,"sk")}</div>
<div class="cell"><div class="cap">Фокус</div><span class="ring" style="display:inline-block;border-radius:8px">{mini(96)}</span></div>
</div>''', AMAP_CSS + '.mini{position:relative;display:inline-block;border:1px solid var(--line);border-radius:8px;overflow:hidden}.mpt{position:absolute;left:50%;top:50%;width:12px;height:12px;margin:-6px;border-radius:999px;background:var(--brand);box-shadow:0 0 0 2px var(--surface-200)}.mini .apx{border:1.5px solid var(--brand-2);border-style:solid;background:color-mix(in srgb,var(--brand-2) 20%,transparent)}')

C['PhotoGallery'] = ('Активи', 640, 'Медіа активу: головне фото, лічильник, мініатюри', f'''<div class="stack" style="max-width:620px">
<div style="position:relative;aspect-ratio:4/3;border:1px solid var(--line);border-radius:8px;background:{PHOTO1};overflow:hidden">
<span class="pill" style="left:10px">★ Обкладинка</span><span class="pill" style="right:10px">2 / 6</span>
<button type="button" class="nb" style="left:12px" aria-label="Попереднє">{ic("chevron-left",20)}</button><button type="button" class="nb" style="right:12px" aria-label="Наступне">{ic("chevron-right",20)}</button>
<button type="button" class="nb" style="right:12px;top:auto;bottom:12px;transform:none;border-radius:8px" aria-label="Розгорнути">{ic("maximize",18)}</button></div>
<div class="row" style="gap:8px"><span class="th2" style="background:{PHOTO2}"></span><span class="th2" style="background:{PHOTO1};outline:2px solid var(--ink);outline-offset:-2px"></span><span class="th2" style="background:linear-gradient(120deg,#D7DEE6,#9AA8B6)"></span><span class="th2" style="display:grid;place-items:center;background:var(--surface-300);color:var(--ink-muted)">{ic("play",20)}</span><span class="th2" style="display:grid;place-items:center;border:1.5px dashed var(--ctl);background:transparent;color:var(--ink-muted)" aria-label="Додати фото">{ic("plus",20)}</span></div>
<div class="row" style="align-items:flex-start"><div class="cell"><div class="cap">Без фото</div><div style="width:240px">{ph("Мистецтво","large")}</div><button type="button" class="btn sm" style="align-self:flex-start">{ic("upload",14)}Завантажити фото</button></div>
<div class="cell" style="flex:1;min-width:220px"><div class="cap">Завантаження і помилка</div><div class="inset" style="display:flex;flex-direction:column;gap:8px"><span class="t1" style="font-weight:400">IMG_2041.HEIC</span><span class="bar"><i style="width:60%;background:var(--brand-2)"></i></span></div><span class="errt">{ic("circle-alert",16)}Помилка. Файл не підтримується. Оберіть JPG, PNG або HEIC.</span></div></div>
</div>''', PH_CSS + '.pill{position:absolute;top:10px;height:24px;padding:0 10px;border-radius:999px;background:var(--ink);color:var(--surface-100);font:500 12px/24px Inter,sans-serif}.nb{position:absolute;top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:999px;border:1.5px solid var(--ctl);background:var(--surface-200);color:var(--ink);display:grid;place-items:center}.th2{width:56px;height:56px;border-radius:6px}')

# ---------------- Віджети ----------------
def whead(t, sub, badge=''):
    return (f'<div style="display:flex;align-items:flex-start;gap:4px"><span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="display:flex;align-items:center;gap:8px"><span class="h3">{t}</span>{badge}</span><span class="sub">{sub}</span></span>'
            f'<button type="button" class="ib c" aria-label="Вигляд">{ic("chart-no-axes-column",16)}</button><button type="button" class="ib c" aria-label="Відкрити">{ic("chevron-right",16)}</button></div>')
def wbox(inner, extra=''):
    return f'<section class="card" style="padding:20px 24px;display:flex;flex-direction:column;gap:14px{extra}">{inner}</section>'

C['AssetGalleryWidget'] = ('Віджети', 520, 'Галерея активів у рамці віджета (MVP)', '<div class="stack">' + wbox(whead('Активи', '1–3 з 12') + f'<div class="atg" style="grid-template-columns:repeat(3,minmax(0,1fr))">{TILES[0]}{TILES[1]}{TILES[2]}</div>') +
    '<div class="grid2">' + wbox(whead('Активи', '12 активів') + '<div class="atg">' + ''.join('<span class="sk" style="aspect-ratio:4/3;border-radius:8px"></span>' for _ in range(3)) + '</div>') +
    wbox(whead('Активи', '0 активів') + '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;min-height:120px"><b style="font-weight:600">Ще немає активів</b><span class="muted" style="font-size:13px">Додайте нерухомість, авто чи колекцію.</span><a href="#" class="btn pri">Додати актив</a></div>') + '</div></div>', AT_CSS)

C['AssetMapWidget'] = ('Віджети', 640, 'Мапа активів у рамці віджета (MVP)', '<div class="stack">' + wbox(whead('Мапа', '8 активів у 3 локаціях', '<span class="tag">8 активів</span>') + amap(260)) +
    '<div class="grid2">' + wbox(whead('Мапа', 'Оновлюється') + '<span class="sk" style="height:160px;border-radius:8px"></span>') +
    wbox(whead('Мапа', '') + '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;min-height:160px"><b style="font-weight:600">Помилка. Не вдалося завантажити мапу.</b><a href="#" class="btn">Спробувати ще раз</a></div>') + '</div></div>', AMAP_CSS)

def atw(kind, title, val, delta, sig):
    return wbox(f'<div style="display:flex;align-items:center;gap:10px"><span class="gi">{ic(PH_ICON[kind],18)}</span><span style="flex:1;min-width:0;display:flex;flex-direction:column"><span class="muted" style="font-size:13px">{title}</span><b class="amt" style="font:600 22px/28px \'Inter Tight\',Inter,sans-serif">{val}</b></span><span class="{delta[0]} tab" style="font-size:13px">{delta[1]}</span></div>{sig}')

def _atw():
    re_sig = (f'<div style="display:flex;flex-direction:column;gap:6px"><span class="sub">Кому належить вартість</span><div style="display:flex;height:14px;gap:2px;border-radius:4px;overflow:hidden"><span style="width:74%;background:var(--ca)"></span><span class="hatch" style="width:26%"></span></div>'
              f'<div class="leg" style="font-size:12px"><span><span class="key" style="background:var(--ca)"></span>Моя частка {eur("159 300,00")}</span><span><span class="key hatch"></span>Банк {eur("55 700,00")}</span></div>'
              f'<div style="display:flex;justify-content:space-between;font-size:13px;border-top:1px solid var(--surface-300);padding-top:8px" class="tab"><span class="muted">Жовтень: оренда − витрати</span><b>{eur("640,00","+")}</b></div></div>')
    car_sig = ('<div style="display:flex;flex-direction:column;gap:6px"><span class="sub">До наступного ТО · 11 з 15 тис. км</span><div style="display:flex;gap:3px">' + ''.join(f'<span style="flex:1;height:12px;border-radius:2px;background:{"var(--ca)" if i < 11 else "var(--surface-300)"}"></span>' for i in range(15)) + '</div>'
               '<div style="display:flex;justify-content:space-between;font-size:13px;border-top:1px solid var(--surface-300);padding-top:8px"><span class="muted">Страховка ОСЦПВ</span><b>ще 43 дні</b></div></div>')
    wine_sig = ('<div style="display:flex;flex-direction:column;gap:6px"><span class="sub">Стелаж · 24 пляшки</span><div style="display:flex;flex-wrap:wrap;gap:4px">' +
                ''.join(f'<span style="width:14px;height:14px;border-radius:999px;{s}"></span>' for s in ['background:var(--ca)'] * 12 + ['border:1.5px solid var(--ca)'] * 9 + ['background:repeating-linear-gradient(45deg,var(--ink-muted) 0 2px,var(--surface-200) 2px 4px)'] * 3) +
                '</div><div class="leg" style="font-size:12px"><span><span class="key" style="background:var(--ca);border-radius:999px"></span>Готове · 12</span><span><span class="key" style="border:1.5px solid var(--ca);border-radius:999px"></span>Тримати · 9</span><span><span class="key hatch" style="border-radius:999px"></span>Минув пік · 3</span></div></div>')
    cash_sig = (f'<div style="display:flex;flex-direction:column;gap:6px"><span class="sub">За валютами</span><div style="display:flex;height:10px;gap:2px;border-radius:4px;overflow:hidden"><span style="width:34%;background:#1D4E89"></span><span style="width:56%;background:#4F7CAC"></span><span style="width:10%;background:#9DB2C8"></span></div>'
                f'<span class="sub" style="margin-top:4px">Працюють і лежать</span><div style="display:flex;height:10px;gap:2px;border-radius:4px;overflow:hidden"><span style="width:62%;background:var(--ca)"></span><span class="hatch" style="width:38%"></span></div><span class="muted" style="font-size:13px">{eur("12 480,00")} лежить без відсотків · 38 %</span></div>')
    stale = wbox(f'<div style="display:flex;align-items:center;gap:10px"><span class="gi">{ic("palette",18)}</span><span style="flex:1;display:flex;flex-direction:column"><span class="muted" style="font-size:13px">Мистецтво</span><b class="amt" style="font:600 22px/28px \'Inter Tight\',Inter,sans-serif">≈ {eur("12 000,00")}</b></span><span class="tag warn">! Оцінка застаріла</span></div>'
                 '<div style="display:flex;flex-direction:column;gap:6px"><span class="sub">Оцінки за роками</span><div style="position:relative;height:28px"><span style="position:absolute;left:0;right:0;top:13px;height:2px;background:var(--line)"></span>' +
                 ''.join(f'<span style="position:absolute;left:{x}%;top:8px;width:12px;height:12px;border-radius:999px;background:var(--ca);border:2px solid var(--surface-200)"></span>' for x in (2, 40, 88)) +
                 '</div><div style="display:flex;justify-content:space-between" class="sub tab"><span>2019 · 7 тис.</span><span>2022 · 9,5 тис.</span><span>2024 · 12 тис.</span></div></div>')
    empty = wbox('<div style="display:flex;align-items:center;gap:10px"><span class="gi">' + ic('wine', 18) + '</span><span class="muted" style="font-size:13px">Вино</span></div><div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:100px"><b style="font-weight:600">Немає вина</b><a href="#" class="btn">Додати вино</a></div>')
    body = '<div class="grid2">' + atw('Нерухомість', 'Нерухомість', eur('215 000,00'), ('up', '▲ 2,4 % р/р'), re_sig) + atw('Транспорт', 'Транспорт', eur('24 500,00'), ('dn', '▼ 8,0 % р/р'), car_sig) + atw('Вино', 'Вино', eur('18 450,00'), ('up', '▲ 6,1 % р/р'), wine_sig) + atw('Готівка', 'Готівка', eur('32 860,00'), ('up', '▲ 4,0 % м/м'), cash_sig) + stale + empty + '</div>'
    return ('Віджети', 760, 'Підписний вигляд кожного виду активів (MVP)', body, '.gi{width:36px;height:36px;flex:none;border-radius:8px;background:var(--surface-300);color:var(--brand);display:grid;place-items:center}')
C['AssetTypeWidget'] = _atw()

def _summary():
    P = [(58, 'var(--ca)'), (18, 'var(--cplan)'), (14, 'var(--cc)'), (5, 'var(--cb)'), (5, 'url(#h)')]
    svg = donut(P, r=62, w=16, size=150, center=('', '')).replace('aria-label="Кільцева діаграма">', 'aria-label="Кільцева діаграма">' + HATCH)
    names = [('Нерухомість', eur('271 400,00')), ('Інвестиції', eur('84 200,00')), ('Гроші', eur('65 500,00')), ('Транспорт', eur('24 500,00')), ('Інші · 3', eur('22 400,00'))]
    rows = ''.join(f'<div style="display:flex;align-items:center;gap:10px;height:30px;border-bottom:1px solid var(--surface-300);font-size:13px"><span class="key {"hatch" if "url" in c else ""}" style="{"" if "url" in c else "background:"+c}"></span><span style="flex:1">{n}</span><b class="amt">{a}</b><span class="muted tab" style="width:40px;text-align:right">{p} %</span></div>' for (p, c), (n, a) in zip(P, names))
    top = f'<div style="display:flex;flex-direction:column;gap:2px"><span class="muted" style="font:500 14px/20px Inter,sans-serif">Активи разом</span><span style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap"><b class="amt" style="font:600 28px/32px Inter,sans-serif">{eur("468 000,00")}</b><span class="up tab" style="font-size:13px">▲ {eur("9 900,00")} · 2,2 % р/р</span></span></div>'
    w1 = wbox(whead('Розподіл активів', 'Станом на 2 лист. 2026') + top + f'<div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">{svg}<div style="flex:1;min-width:220px">{rows}</div></div><span class="sub">Перераховано в EUR за сьогоднішнім курсом.</span>')
    bars = ''.join(f'<div style="display:flex;align-items:center;gap:10px;height:28px;font-size:13px"><span style="width:110px" class="t1">{n}</span><span style="flex:1"><i style="display:block;height:14px;width:{p/58*100:.0f}%;border-radius:0 4px 4px 0;background:var(--ca)"></i></span><b class="amt" style="width:100px;text-align:right">{a}</b></div>' for (p, c), (n, a) in zip(P, names))
    w2 = wbox(whead('Борги', 'Вигляд: Стовпчики') + f'<div style="display:flex;flex-direction:column;gap:2px"><span class="muted" style="font:500 14px/20px Inter,sans-serif">Борги разом</span><span style="display:flex;align-items:baseline;gap:12px"><b class="amt" style="font:600 28px/32px Inter,sans-serif">{eur("56 340,00","-")}</b><span class="up tab" style="font-size:13px">▼ {eur("1 120,00")} м/м</span></span></div>' +
              ''.join(f'<div style="display:flex;align-items:center;gap:10px;height:28px;font-size:13px"><span style="width:110px" class="t1">{n}</span><span style="flex:1"><i style="display:block;height:14px;width:{p}%;border-radius:0 4px 4px 0;background:var(--ca)"></i></span><b class="amt" style="width:100px;text-align:right">{a}</b></div>' for n, p, a in [('Іпотека', 100, eur('55 700,00', '-')), ('Кредитна', 2, eur('640,00', '-'))]))
    w3 = wbox(whead('Витрати за категоріями', 'Жовтень 2026') + '<span class="sk" style="width:45%;height:28px"></span><div style="display:flex;gap:20px;align-items:center"><span class="sk" style="width:120px;height:120px;border-radius:999px"></span><div style="flex:1;display:flex;flex-direction:column;gap:10px">' + ''.join('<span class="sk" style="height:12px"></span>' for _ in range(4)) + '</div></div>')
    body = f'<div class="stack">{w1}<div class="grid2">{w2}{w3}</div></div>'
    return ('Віджети', 760, 'Підсумок і склад: кільце, стовпці, завантаження (MVP)', body, SVGCSS)
C['SummaryWidget'] = _summary()

# ---------------- Обкладинка ----------------
COVER = '''<!-- @dsCard height=288 -->
<!doctype html><html lang="uk"><head><meta charset="utf-8">''' + FONTS + '''<style>
html,body{margin:0;background:var(--surface-100)}svg{display:block}
.g{fill:var(--surface-100)}.b{fill:var(--brand)}.b2{fill:var(--brand-2)}.a{fill:var(--accent)}.s3{fill:var(--surface-300)}.s2{fill:var(--surface-200);stroke:var(--line);stroke-width:1}
.name{font:600 80px "Inter Tight",system-ui,sans-serif;letter-spacing:-0.03em;fill:var(--ink)}.tag{font:400 14px "Inter",system-ui,sans-serif;fill:var(--ink-muted)}
</style></head><body>
<svg width="960" height="288" viewBox="0 0 960 288" role="img" aria-label="Willowsum">
<!-- derivation
blocks: brand 288 leaf, brand-2 192 leaf, accent 96 leaf (the mark, nested on its sharp corner); surface-200 cards with a line hairline and surface-300 pills — the white-card-on-ground look of the canvas
arrangement: the mark enlarged bottom-left of the right half, bleeding off the bottom; to its right a stack of white cards (radius-md 8) cut on a 48 px row (space-7) with pill-shaped bars (radius-pill), bleeding off the right edge
pattern: literal motif (leaf) from DS-02 plus "borders not shadows": cards are surface-200 with a 1 px line, bars are the canvas page-tab pills in surface-300 and one brand-2 progress pill
steps and radii: 48 / 24 / 16 px steps (space-7, space-5, space-4), radii 144 / 96 / 48 on the leaves, radius-md 8 on cards, pills at half their height; no gradients, no shadows
-->
<rect class="g" width="960" height="288"/>
<path class="b" d="M480 288 V144 A144 144 0 0 1 624 0 H768 V144 A144 144 0 0 1 624 288 Z"/>
<path class="b2" d="M480 288 V192 A96 96 0 0 1 576 96 H672 V192 A96 96 0 0 1 576 288 Z"/>
<path class="a" d="M480 288 V240 A48 48 0 0 1 528 192 H576 V240 A48 48 0 0 1 528 288 Z"/>
<rect class="s2" x="792.5" y="24.5" width="200" height="72" rx="8"/>
<rect class="s3" x="816" y="44" width="96" height="12" rx="6"/><rect class="b2" x="816" y="68" width="120" height="8" rx="4"/>
<rect class="s2" x="792.5" y="120.5" width="200" height="72" rx="8"/>
<rect class="s3" x="816" y="140" width="64" height="12" rx="6"/><rect class="s3" x="816" y="164" width="140" height="8" rx="4"/>
<rect class="s2" x="792.5" y="216.5" width="200" height="96" rx="8"/>
<rect class="s3" x="816" y="236" width="112" height="12" rx="6"/><rect class="b" x="816" y="260" width="72" height="24" rx="8"/>
<text class="name" x="42" y="204">Willowsum</text>
<text class="tag" x="46" y="244">Спокійне місце для всього, чим родина володіє,</text>
<text class="tag" x="46" y="264">що винна і що планує.</text>
</svg></body></html>
'''

import comps2 as _c2
_g = _c2.C['GroupHeader']
MINI_CSS = '.mini{position:relative;display:inline-block;flex:none;border:1px solid var(--line);border-radius:8px;overflow:hidden}.mpt{position:absolute;left:50%;top:50%;width:12px;height:12px;margin:-6px;border-radius:999px;background:var(--brand);box-shadow:0 0 0 2px var(--surface-200)}'
C['GroupHeader'] = (_g[0], _g[1], _g[2], _g[3].replace('<span class="mm"></span>', mini(56)), _g[4] + AMAP_CSS + MINI_CSS)
