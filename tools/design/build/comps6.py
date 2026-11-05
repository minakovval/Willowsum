"""DS-01 (#32) merged rules: PRs #54–#56 (states, amounts, statuses; pickers, dialogs, banners, toasts; filters, menus, view switches)."""
from common import *
import comps1, comps2, comps5
C = {}
X14 = ic('x', 14)

# ---------- SelectionBar (CMP-73) ----------
def selbar(text, extra='', busy=False, menu=False):
    act = (f'<button type="button" class="sbb" aria-haspopup="menu" aria-expanded="{"true" if menu else "false"}"{" disabled" if busy else ""} title="{"Інша масова дія ще виконується" if busy else ""}">Дії з вибраними{ic("chevron-down",16)}</button>')
    return (f'<div class="sbar" role="toolbar" aria-label="Дії з вибраними записами"><span class="tab">{text}</span>{extra}<span style="flex:1"></span>{act}'
            f'<button type="button" class="sbx" aria-label="Зняти вибір" title="Зняти вибір">{ic("x",18)}</button></div>')
_menu = ('<div class="panel" style="position:absolute;right:52px;top:56px;width:250px;z-index:2">'
         + ''.join(f'<div class="mi{" hov" if i == 0 else ""}"><span class="i">{ic(icn,16)}</span>{t}</div>' for i, (icn, t) in enumerate([('tag', 'Змінити категорію'), ('tags', 'Додати теги'), ('check-check', 'Підтвердити категорії'), ('download', 'Експортувати CSV')]))
         + f'<div class="hr"></div><div class="mi dz"><span class="i">{ic("trash2",16)}</span>Видалити (лише ручні)</div></div>')
C['SelectionBar'] = ('Списки', 640, 'Режим вибору списку: «Вибрано N · Сума», одна кнопка дій, «×» (CMP-73)', f'''<div class="stack">
<div class="cell"><div class="cap">Вибрано 2 транзакції, меню дій відкрите</div><div style="position:relative;height:270px">{selbar(f"<b>Вибрано 2</b> · Сума {eur('238,90','-')}", menu=True)}{_menu}</div></div>
<div class="cell"><div class="cap">Вибрано всю сторінку, за фільтром більше</div>{selbar(f"<b>Вибрано 25</b> · Сума {eur('1 015,30','-')}", '<a href="#" class="sbl">Вибрати всі 42 за фільтром</a>')}</div>
<div class="cell"><div class="cap">Вибрано всі за фільтром</div>{selbar(f"<b>Вибрано всі 42 за фільтром</b> · Сума {eur('2 384,70','+')}", '<a href="#" class="sbl">Вибрати лише сторінку</a>')}</div>
<div class="cell"><div class="cap">Після ручного зняття 2 рядків</div>{selbar(f"<b>Вибрано 40 за фільтром</b> · Сума {eur('2 345,80','+')}", '<a href="#" class="sbl">Вибрати лише сторінку</a>')}</div>
<div class="cell"><div class="cap">Частина без курсу: сума приблизна; підказка суми</div><div style="display:flex;flex-direction:column;gap:6px">{selbar(f"<b>Вибрано 4</b> · Сума <span class='sbs' title='1 транзакція без курсу · 1 конвертовано'>приблизно {eur('312,40','-')}</span>")}<span class="tp" style="align-self:flex-start">1 транзакція без курсу · 1 транзакцію конвертовано</span></div></div>
<div class="cell"><div class="cap">Сума рахується; інша масова дія виконується</div>{selbar(f"<b>Вибрано 3</b> · <span style='opacity:.6'>Сума {eur('52,30','-')}</span> <span style='opacity:.85'>Оновлюється…</span>", busy=True)}</div>
</div>''', ('.sbar{height:52px;display:flex;align-items:center;gap:12px;padding:0 8px 0 16px;border-radius:10px;background:var(--brand);color:var(--on-brand);font:400 14px/20px Inter,sans-serif;white-space:nowrap}.sbar b{font-weight:600}'
            '.sbl{color:var(--on-brand);text-decoration:underline;font-weight:500}.sbs{border-bottom:1px dotted currentColor}'
            '.sbb{position:relative;height:36px;display:inline-flex;align-items:center;gap:6px;padding:0 12px;border:0;border-radius:6px;background:var(--surface-200);color:var(--brand);font:600 13px/18px Inter,sans-serif;cursor:pointer}.sbb:disabled{opacity:.55;cursor:not-allowed}'
            '.sbx{position:relative;width:36px;height:36px;display:grid;place-items:center;border:0;border-radius:6px;background:transparent;color:var(--on-brand)}'
            '.sbb::after,.sbx::after{content:"";position:absolute;left:50%;top:50%;width:max(100%,44px);height:44px;transform:translate(-50%,-50%)}'
            '.tp{padding:6px 10px;background:var(--surface-200);border:1px solid var(--line);border-radius:8px;box-shadow:var(--elev);font-size:12px;line-height:16px}'))

# ---------- Progress (CMP-74) ----------
def prog(pct, text, state='', above=False, act=''):
    col = {'': 'var(--link)', 'done': 'var(--gain)', 'err': 'var(--loss)'}[state]
    bar = f'<span class="pb" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="{pct}"><i style="width:{pct}%;background:{col}"></i></span>'
    if above:
        return f'<div style="display:flex;flex-direction:column;gap:6px">{text}{bar}</div>'
    return f'<div style="display:flex;align-items:center;gap:12px">{bar}<span class="pt2">{text}</span>{act}</div>'
C['Progress'] = ('Стани', 420, 'Визначений прогрес процесу з відомою кількістю кроків (CMP-74)', f'''<div class="stack">
<div class="card pad" style="display:flex;flex-direction:column;gap:14px"><span class="lbl">Черга розбору</span>
{prog(30, '<b class="tab">31 з 103</b> · лишилось 72')}
<span class="cap">Рахуємо кроки</span>{prog(0, 'Рахуємо…')}
<span class="cap">Текст над смугою</span>{prog(33, '<span class="pt2">Розпізнаємо сторінку <b class="tab">4 з 12</b></span>', above=True)}</div>
<div class="card pad" style="display:flex;flex-direction:column;gap:14px"><span class="lbl">Синхронізація рахунків</span>
<div class="pr"><span class="t1" style="width:130px">Поточний ··4417</span>{prog(100, '<span style="color:var(--gain);font-weight:600">✓ Готово · <span class="tab">1 214</span></span>', 'done')}</div>
<div class="pr"><span class="t1" style="width:130px">Кредитна ··9021</span>{prog(42, '<b class="tab">500 з 1 200</b> транзакцій')}</div>
<div class="pr"><span class="t1" style="width:130px">Виписка PDF</span>{prog(33, '<span style="color:var(--loss);font-weight:600">✕ Помилка · <span class="tab">4 з 12</span></span>', 'err', act='<button type="button" class="btn sm">Спробувати ще раз</button>')}</div></div>
</div>''', '.pb{display:block;flex:1;min-width:120px;height:6px;border-radius:999px;background:var(--surface-300);overflow:hidden}.pb>i{display:block;height:6px;border-radius:999px}.pt2{font:400 13px/18px Inter,sans-serif;color:var(--ink-muted);white-space:nowrap}.pt2 b{font-weight:600;color:var(--ink)}.pr{display:flex;align-items:center;gap:12px}.pr>div{flex:1}')

# ---------- EmptyState / ErrorState: «блок» і «область» ----------
_BLK = '.blk{display:flex;flex-direction:column;align-items:flex-start;gap:12px;max-width:480px}.blk h3{margin:0;font:600 18px/24px "Inter Tight",Inter,sans-serif}.blk p{margin:0;color:var(--ink-muted)}.area{display:flex;flex-direction:column;align-items:center;text-align:center;gap:14px;padding:32px 16px}.area h2{margin:0;font:600 22px/28px "Inter Tight",Inter,sans-serif;letter-spacing:-.015em}.area p{margin:0;max-width:420px;color:var(--ink-muted);font-size:15px;line-height:22px}.tile{width:64px;height:64px;border-radius:16px;display:grid;place-items:center}.acts{display:flex;gap:8px;flex-wrap:wrap}.code{font:400 13px/20px Inter,sans-serif;color:var(--ink-muted);font-variant-numeric:tabular-nums}.errh{display:flex;align-items:center;gap:4px;color:var(--loss);font:600 16px/24px Inter,sans-serif}'
C['EmptyState'] = ('Стани', 640, 'Два розміщення: «блок» ліворуч і «область» по центру; одна основна і одна другорядна дія', f'''<div class="stack">
<div class="cell"><div class="cap">«Область» — порожня вся сторінка «Транзакції»</div><section class="card"><div class="area"><span class="tile" style="background:var(--tint);color:var(--brand)">{ic("inbox",28)}</span><h2>Транзакцій ще немає</h2><p>Імпортуйте виписку банку або додайте першу транзакцію вручну.</p><div class="acts"><a href="#" class="btn pri">{ic("upload",16)}Імпортувати виписку</a><a href="#" class="btn">Додати вручну</a></div></div></section></div>
<div class="grid3">
<div class="cell"><div class="cap">«Блок» — порожній віджет</div><section class="card pad"><div class="blk"><span class="muted">{ic("flag",32)}</span><h3>Ще немає цілей</h3><p>Додайте ціль, щоб бачити, скільки лишилося відкласти.</p><div class="acts"><a href="#" class="btn">Нова ціль</a></div></div></section></div>
<div class="cell"><div class="cap">«Нічого не знайдено» — лише «Скинути фільтри»</div><section class="card pad"><div class="blk"><h3>Нічого не знайдено</h3><p>Спробуйте змінити або скинути фільтри.</p><div class="acts"><a href="#" class="btn">Скинути фільтри</a></div></div></section></div>
<div class="cell"><div class="cap">Роботу завершено</div><section class="card pad"><div class="blk"><span style="color:var(--gain)">{ic("circle-check",32)}</span><h3>Усе розібрано</h3><p>Нові транзакції з’являться тут після імпорту.</p></div></section></div>
</div></div>''', _BLK)

C['ErrorState'] = ('Стани', 560, '«✕ Помилка», що не вдалося, «Спробувати ще раз» і «Код: …» окремим рядком', f'''<div class="stack">
<div class="cell"><div class="cap">«Область» — не завантажився весь список</div><section class="card"><div class="area"><span class="tile" style="background:var(--neg-bg);color:var(--loss)">{ic("x",28,2.2)}</span><h2 style="color:var(--loss)">Помилка</h2><p>Не вдалося завантажити транзакції. Спробуйте ще раз.</p><div class="acts"><a href="#" class="btn">Спробувати ще раз</a></div><span class="code">Код: 7f3a-91c2</span></div></section></div>
<div class="grid3">
<div class="cell"><div class="cap">«Блок» — картка</div><section class="card pad"><div class="blk"><span class="errh">{ic("x",16,2.4)}Помилка</span><p>Не вдалося завантажити рахунки. Спробуйте ще раз.</p><a href="#" class="btn">Спробувати ще раз</a><span class="code">Код: 4c21-0b7e</span></div></section></div>
<div class="cell"><div class="cap">Повтор триває</div><section class="card pad"><div class="blk"><span class="errh">{ic("x",16,2.4)}Помилка</span><p>Не вдалося показати картку. Решта сторінки працює.</p><a href="#" class="btn" aria-busy="true"><span class="spin"></span>Спробувати ще раз</a><span class="code">Код: 9d02-e118</span></div></section></div>
<div class="cell"><div class="cap">Немає мережі</div><section class="card pad"><div class="blk"><span class="errh">{ic("x",16,2.4)}Помилка</span><p>Немає з’єднання з інтернетом. Перевірте мережу і спробуйте ще раз.</p><a href="#" class="btn">Спробувати ще раз</a></div></section></div>
</div></div>''', _BLK)

# ---------- Skeleton: 12 px смужки, радіус 6, 1,6 с ----------
_row = '<div style="display:flex;gap:12px;align-items:center"><span class="sk sh2" style="width:32px;height:32px;border-radius:8px"></span><span style="flex:1;display:flex;flex-direction:column;gap:6px"><span class="sk sh2" style="width:60%;height:12px"></span><span class="sk sh2" style="width:35%;height:12px"></span></span><span class="sk sh2" style="width:64px;height:12px"></span></div>'
C['Skeleton'] = ('Стани', 300, 'Форма вмісту; смужки 12 px, радіус 6 px, перелив 1,6 с; через 3 с — «Ще завантажується…»', f'''<div class="grid3">
<div class="scard"><span style="font-weight:600">Транзакції · row</span>{_row * 4}</div>
<div class="scard"><span style="font-weight:600">Можна витратити · block</span><span class="sk sh2" style="width:50%;height:32px"></span><span class="sk sh2" style="width:100%;height:6px;border-radius:999px"></span><div style="display:flex;gap:6px;align-items:flex-end;height:70px">{"".join(f'<span class="sk sh2" style="width:12%;height:{h}px"></span>' for h in (30,50,40,62,45,70))}</div></div>
<div class="scard"><span style="font-weight:600">Новий рахунок · text</span><span class="sk sh2" style="width:100%;height:12px"></span><span class="sk sh2" style="width:80%;height:12px"></span><span class="sk sh2" style="width:60%;height:12px"></span><span class="sk sh2" style="width:100%;height:40px;border-radius:8px"></span><span class="muted" style="font-size:13px">Ще завантажується…</span></div>
</div>''', comps2.SC_CSS + '.sh2{position:relative;overflow:hidden}.sh2::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.5),transparent);transform:translateX(-100%);animation:sh 1.6s ease-in-out infinite}[data-theme="dark"] .sh2::after{background:linear-gradient(90deg,transparent,rgba(255,255,255,.08),transparent)}@keyframes sh{to{transform:translateX(100%)}}@media (prefers-reduced-motion:reduce){.sh2::after{animation:none;display:none}}')

# ---------- Badge: обов'язковий символ, тон за змістом ----------
C['Badge'] = ('Стани', 220, 'Символ тону обов’язковий; тон визначає зміст статусу', '''<div class="stack">
<div class="cell"><div class="cap">Тони</div><div class="row c" style="gap:8px"><span class="tag pos">✓ Активне</span><span class="tag warn">! Потребує дії</span><span class="tag neg">✕ Помилка</span><span class="tag info">i Листи</span><span class="tag">• Відключено</span><span class="tag">• Чернетка</span></div></div>
<div class="cell"><div class="cap">Ознаки й стани в рядках</div><div class="row c" style="gap:8px"><span class="tag info">i Висока упевненість · 92</span><span class="tag warn">! Середня упевненість · 71</span><span class="tag warn">! Комісія</span><span class="tag warn">! Оцінка застаріла</span><span class="tag">• переказ</span><span class="tag">• Без категорії</span><span class="tag info">i Поточний план</span><span class="tag pos">✓ Рекомендований</span></div></div>
<div class="cell"><div class="cap">Заборонено: бейдж без символу; «Активне» не info, «Помилка» не attention</div><div class="row c" style="gap:8px;opacity:.55"><span class="tag pos" style="text-decoration:line-through">Активне</span><span class="tag info" style="text-decoration:line-through">✓ Активне</span><span class="tag warn" style="text-decoration:line-through">! Помилка</span></div></div>
</div>''', '')

# ---------- Amount: розміри за роллю ----------
C['Amount'] = ('Числа', 420, 'Розмір за роллю: xl, l, m — Inter Tight; s — Inter 14/20; «–» немає значення', f'''<div class="stack">
<div class="row" style="gap:40px;align-items:flex-end">
<div class="cell"><div class="cap">xl · головна сума картки · Inter Tight 32/40</div><span class="amt" style="font:600 32px/40px 'Inter Tight',Inter,sans-serif;letter-spacing:-.02em">{eur("1 284,70")}</span></div>
<div class="cell"><div class="cap">l · підсумок блоку · 24/30</div><span class="amt" style="font:600 24px/30px 'Inter Tight',Inter,sans-serif;letter-spacing:-.01em">{eur("3 288,69")}</span></div>
<div class="cell"><div class="cap">m · поруч з підсумками · 18/24</div><span class="amt" style="font:600 18px/24px 'Inter Tight',Inter,sans-serif;letter-spacing:-.01em">{eur("612,40")}</span></div>
<div class="cell"><div class="cap">s · рядок і клітинка · Inter 14/20</div><span class="amt" style="font:600 14px/20px Inter,sans-serif">{eur("42,80","-")}</span></div>
</div>
<div class="row" style="gap:32px">
<div class="cell"><div class="cap">Колір завжди ink</div><span class="amt">{eur("45,00","-")} <span class="muted" style="font-weight:400">· ✕ перевищено</span></span></div>
<div class="cell"><div class="cap">Виняток: сума стану поруч з маркером і словом</div><span class="amt" style="color:var(--loss)">! Дефіцит {eur("43,00","-")}</span></div>
<div class="cell"><div class="cap">Скорочено (підказка — повне)</div><span class="amt" tabindex="0" style="text-decoration:underline dotted 2px var(--ink-muted);text-underline-offset:4px;cursor:help">128,4{NB}тис.{NB}€</span></div>
<div class="cell"><div class="cap">Немає значення — коротке «–»</div><span class="amt muted">–</span></div>
<div class="cell"><div class="cap">Без змін (лише Delta) — довге «—»</div><span class="tab" style="color:var(--brand);font-weight:500">— м/м</span></div>
<div class="cell"><div class="cap">Приховано</div><span class="amt" aria-label="Сума прихована">•••</span></div>
<div class="cell"><div class="cap">Завантаження</div><span class="sk" style="width:110px;height:24px"></span></div>
</div></div>''', '')

# ---------- Delta: Inter 14/20 500, щаблі ----------
C['Delta'] = ('Числа', 240, 'Inter 14/20 500, стрілка без знака; щабель до 10 % — soft; «—» без змін', f'''<div class="stack"><div class="row" style="gap:32px">
<div class="cell"><div class="cap">Вартість +2,4 % (краще, до 10 %)</div><span class="dl" style="color:var(--gain-soft)">▲ 2,4 % <span class="pd">за місяць</span></span></div>
<div class="cell"><div class="cap">Вартість +32 % (краще, понад 10 %)</div><span class="dl" style="color:var(--gain)">▲ {eur("1 260,00")} · 32,0 % <span class="pd">за 3 міс.</span></span></div>
<div class="cell"><div class="cap">Вартість −1,1 % (гірше, до 10 %)</div><span class="dl" style="color:var(--loss-soft)">▼ 1,1 % <span class="pd">м/м</span></span></div>
<div class="cell"><div class="cap">Витрати +24 % (гірше)</div><span class="dl" style="color:var(--loss)">▲ {eur("792,62")} <span class="pd">м/м</span></span></div>
<div class="cell"><div class="cap">Борг знизився (краще)</div><span class="dl" style="color:var(--gain-soft)">▼ {eur("1 120,00")} <span class="pd">м/м</span></span></div>
<div class="cell"><div class="cap">Без змін (&lt; 1 % і &lt; 1 €)</div><span class="dl" style="color:var(--brand)">— <span class="pd">м/м</span></span></div>
<div class="cell"><div class="cap">Завантаження</div><span class="sk" style="width:90px;height:12px"></span></div>
</div></div>''', '.dl{font:500 14px/20px Inter,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap}.pd{font-weight:400;color:var(--ink-muted)}')

# ---------- Chip: «×» — справжня кнопка ----------
def fchip(t, ring=False):
    return f'<span class="fchip{" ring" if ring else ""}">{t}<button type="button" class="cx" aria-label="Прибрати фільтр: {t}" title="Прибрати фільтр">{X14}</button></span>'
CHIPCSS = '.fchip{height:32px;display:inline-flex;align-items:center;gap:2px;padding:0 6px 0 10px;border-radius:999px;background:var(--tint);color:var(--brand);font:500 13px/18px Inter,sans-serif;white-space:nowrap;max-width:240px}.cx{position:relative;width:20px;height:20px;display:grid;place-items:center;border:0;border-radius:999px;background:transparent;color:var(--ink-muted);padding:0;cursor:pointer}.cx::after{content:"";position:absolute;left:50%;top:50%;width:44px;height:44px;transform:translate(-50%,-50%)}.cx.ring{outline:3px solid var(--focus);outline-offset:2px}.tg{height:32px;display:inline-flex;align-items:center;gap:6px;padding:0 12px;border-radius:999px;border:1px solid var(--ctl);background:var(--surface-200);font:500 13px Inter,sans-serif;white-space:nowrap}.tg.on{background:var(--tint);border-color:transparent;color:var(--brand);font-weight:600}.tg.dis{background:var(--disabled-bg);border-color:transparent;color:var(--disabled-ink)}'
_ch = comps5.C['Chip']
_cb = f'''<div class="stack">
<div class="cell"><div class="cap">Фільтр зі зняттям: «×» — окрема кнопка «Прибрати фільтр: …», зона 44 px</div><ul class="row c" aria-label="Застосовані фільтри" style="gap:8px;list-style:none;margin:0;padding:0"><li>{fchip("Листопад 2026")}</li><li>{fchip("Категорія: Продукти")}</li><li><span class="fchip">Поточний ··4417<button type="button" class="cx ring" aria-label="Прибрати фільтр: Рахунок — Поточний ··4417">{X14}</button></span></li></ul></div>
<div class="cell"><div class="cap">Перемикач — button з aria-pressed</div><div class="row c" style="gap:8px"><button type="button" class="tg on" aria-pressed="true">{ic("check",16)}Нерухомість · 3</button><button type="button" class="tg on" aria-pressed="true">{ic("check",16)}Транспорт · 2</button><button type="button" class="tg" aria-pressed="false">Човни · 1</button><button type="button" class="tg dis" disabled>Метали · 0</button></div></div>
''' + _ch[3][_ch[3].index('<div class="cell"><div class="cap">Категорія і тег'):]
_cb = _cb.replace('<span class="tag">однакова сума</span><span class="tag">той самий день</span><span class="tag">#відпустка</span>', '<span class="tag">• однакова сума</span><span class="tag">• той самий день</span><span class="tag">• #відпустка</span>')
C['Chip'] = (_ch[0], 280, 'Фільтр зі зняттям («×» — кнопка), перемикач, категорія, тег', _cb, _ch[4] + CHIPCSS)

# ---------- FilterBar: «Фільтри · N» 36 px + варіант «у картці» ----------
FBTN = f'<button type="button" class="fbtn{{cls}}" aria-haspopup="{{hp}}" aria-expanded="{{ex}}">{ic("list-filter",16)}{{t}}</button>'
def fbtn(t, cls='', hp='dialog', ex='false'):
    return FBTN.format(cls=cls, hp=hp, ex=ex, t=t)
C['FilterBar'] = ('Списки', 640, '«Фільтри · N» 36 px без окремого лічильника; чипи з кнопкою «×»; варіант «у картці»', f'''<div class="stack">
<div class="cell"><div class="cap">Над списком: два активні фільтри</div><div class="row c" style="gap:8px"><span class="search" style="width:280px">{ic("search",16)}<span>Пошук за мерчантом, описом, сумою</span></span>{fbtn("Фільтри · 2")}{fchip("Листопад 2026")}{fchip("Категорія: Продукти")}</div>
<div style="display:flex;gap:20px;color:var(--ink-muted);font-size:13px" class="tab"><span>Знайдено 42 записи</span><span>Надходження <b style="color:var(--ink)">{eur("3 400,00","+")}</b></span><span>Списання <b style="color:var(--ink)">{eur("1 015,30","-")}</b></span></div></div>
<div class="grid2">
<div class="cell"><div class="cap">Панель відкрита (role=dialog без затемнення)</div><div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start">{fbtn("Фільтри · 2", " open", ex="true")}<div class="panel" style="width:380px;padding:16px;display:flex;flex-direction:column;gap:10px" role="dialog" aria-label="Фільтри">
<div class="fr"><span>Період</span><span class="inp" style="height:36px">Листопад 2026<span style="flex:1"></span>{ic("chevron-down",16,cls="muted")}</span></div>
<div class="fr"><span>Рахунки</span><span class="inp" style="height:36px"><span class="ph">Усі</span><span style="flex:1"></span>{ic("chevron-down",16,cls="muted")}</span></div>
<div class="fr"><span>Категорії</span><span class="inp" style="height:36px">Продукти<span style="flex:1"></span>{ic("chevron-down",16,cls="muted")}</span></div>
<div style="display:flex;justify-content:space-between;padding-top:6px"><button type="button" class="btn quiet">Скинути все</button><button type="button" class="btn pri">Застосувати</button></div></div></div></div>
<div class="cell"><div class="cap">Варіант «у картці»: меню-прапорці, діє одразу</div><section class="card pad" style="display:flex;flex-direction:column;gap:10px"><div style="display:flex;align-items:center;gap:8px"><span class="h3" style="flex:1">Категорії бюджету</span>{fbtn("Фільтри · 1", " open", "menu", "true")}</div>
<div class="panel" role="menu" style="align-self:flex-end;width:250px"><div class="mh">Стан</div><div class="mi" role="menuitemcheckbox" aria-checked="true"><span class="chk on">{ic("check",12,3)}</span>Перевищено<span class="k">2</span></div><div class="mi" role="menuitemcheckbox" aria-checked="false"><span class="chk"></span>Майже вичерпано<span class="k">3</span></div><div class="mh">Тип</div><div class="mi" role="menuitemcheckbox" aria-checked="false"><span class="chk"></span>Обов’язкові<span class="k">6</span></div><div class="hr"></div><div style="display:flex;justify-content:space-between;align-items:center;padding:4px 6px"><button type="button" class="btn quiet sm">Скинути</button><span class="sub">Показано 2 з 14</span></div></div>
<div class="row c" style="gap:8px">{fchip("Стан: перевищено")}</div></section></div>
</div></div>''', CHIPCSS + '.fbtn{position:relative;height:36px;display:inline-flex;align-items:center;gap:6px;padding:0 12px;border:1px solid var(--ctl);border-radius:8px;background:var(--surface-200);color:var(--ink);font:600 13px/18px Inter,sans-serif;white-space:nowrap;cursor:pointer}.fbtn svg{color:var(--ink-muted)}.fbtn.open{border-color:var(--brand-2);background:var(--tint)}.fbtn::after{content:"";position:absolute;left:0;right:0;top:50%;height:44px;transform:translateY(-50%)}.fr{display:flex;align-items:center;gap:12px}.fr>span:first-child{width:80px;color:var(--ink-muted);font-size:13px}.fr .inp{flex:1}')

# ---------- Menu: «Ще дії» ----------
_m = comps2.C['Menu']
_mb = _m[3].replace('<div class="row" style="gap:32px">', f'''<div class="stack"><div class="row c" style="gap:24px"><div class="cell"><div class="cap">Кнопка «…» — лише для меню; назва і підказка «Ще дії»</div><div class="row c" style="gap:8px"><button type="button" class="ib" aria-label="Ще дії" title="Ще дії" aria-haspopup="menu" aria-expanded="false">{ic("ellipsis",20)}</button><button type="button" class="ib on" aria-label="Ще дії" aria-haspopup="menu" aria-expanded="true">{ic("ellipsis",20)}</button><span class="tp2">Ще дії</span></div></div>
<div class="cell"><div class="cap">Одна дія без меню — власна іконка, не «…»</div><button type="button" class="ib" aria-label="Роз’єднати" title="Роз’єднати">{ic("unlink",20)}</button></div></div>
<div class="row" style="gap:32px">''', 1) + '</div>'
C['Menu'] = (_m[0], 480, '«Ще дії» з aria-haspopup="menu"; небезпечна дія — остання за роздільником', _mb, _m[4] + '.tp2{padding:4px 8px;background:var(--surface-200);border:1px solid var(--line);border-radius:8px;box-shadow:var(--elev);font-size:12px}')

# ---------- Segmented: тихий варіант ----------
C['Segmented'] = ('Форми', 320, 'Типовий — у формах; тихий — період графіка «1М · 3М · 1Р · Усе»; radiogroup', f'''<div class="stack">
<div class="cell"><div class="cap">Типовий: тип транзакції у формі</div><div class="seg" role="radiogroup" aria-label="Тип"><span class="on" role="radio" aria-checked="true">Списання</span><span role="radio" aria-checked="false">Надходження</span><span role="radio" aria-checked="false">Переказ</span></div></div>
<div class="cell"><div class="cap">Два вигляди тієї самої таблиці</div><div class="seg" role="radiogroup"><span class="on" role="radio" aria-checked="true">З порівнянням</span><span role="radio" aria-checked="false">Рік: план і факт</span></div></div>
<div class="cell"><div class="cap">Тихий — перемикач періоду в заголовку картки графіка</div><section class="card pad" style="display:flex;align-items:center;gap:12px;max-width:520px"><span class="h3" style="flex:1">Баланс рахунку</span><div class="qseg" role="radiogroup" aria-label="Період"><span role="radio" aria-checked="false">1М</span><span class="on" role="radio" aria-checked="true">3М</span><span role="radio" aria-checked="false">1Р</span><span role="radio" aria-checked="false">Усе</span></div></section></div>
<div class="row"><div class="cell"><div class="cap">Тихий: наведення</div><div class="qseg"><span class="hov">1М</span><span class="on">3М</span><span>1Р</span><span>Усе</span></div></div><div class="cell"><div class="cap">Тихий: фокус</div><div class="qseg"><span>1М</span><span class="on ring">3М</span><span>1Р</span><span>Усе</span></div></div><div class="cell"><div class="cap">Типовий: вимкнено</div><div class="seg" style="background:var(--disabled-bg)"><span style="color:var(--disabled-ink)">Місяць</span><span style="color:var(--disabled-ink)">Тиждень</span></div></div></div>
</div>''', '.qseg{display:inline-flex;gap:2px}.qseg>span{position:relative;height:32px;display:inline-flex;align-items:center;padding:0 10px;border-radius:4px;color:var(--ink-muted);font:500 13px/18px Inter,sans-serif}.qseg>.on{background:var(--surface-300);color:var(--ink);font-weight:600;box-shadow:inset 0 -2px 0 var(--brand)}.qseg>.hov{color:var(--ink)}.qseg>span::after{content:"";position:absolute;left:50%;top:50%;width:max(100%,44px);height:44px;transform:translate(-50%,-50%)}')

# ---------- Select: «з пошуком», «кнопка-список з підписом» ----------
CAT = comps5.CAT
def cchip(n, icn):
    return f'<span class="catc" style="background:transparent;padding:0"><span style="background:{CAT[n]};color:{comps5.CATI[n]}">{ic(icn,11,2.2)}</span>{n}</span>'
_s = comps1.C['Select']
_sb = f'''<div class="stack">{_s[3]}
<div class="grid2">
<div class="cell"><div class="cap">З пошуком: категорії (понад 8 пунктів)</div><span class="inp foc">{cchip("Продукти","shopping-cart")}<span style="flex:1"></span>{ic("chevron-up",16)}</span><div class="panel" style="padding:6px"><span class="search" style="height:36px;color:var(--ink)" role="combobox" aria-expanded="true">{ic("search",16,cls="muted")}прод</span><div class="mh">Часто для «Сільпо»</div><div class="mi hov">{cchip("Продукти","shopping-cart")}<span class="k">{ic("check",16)}</span></div><div class="mh">Харчування</div><div class="mi">{cchip("Кафе і ресторани","utensils")}</div><div class="mi">{cchip("Доставка їжі","truck")}</div><div class="hr"></div><div class="mi"><span class="i">{ic("plus",16)}</span>Нова категорія</div></div></div>
<div class="cell"><div class="cap">З пошуком: рахунки з маскою ··NNNN</div><span class="inp">{ic("landmark",16,cls="muted")}Поточний ··4417<span style="flex:1"></span>{ic("chevron-down",16,cls="muted")}</span><div class="panel" style="padding:6px"><span class="search" style="height:36px">{ic("search",16)}Пошук рахунку</span><div class="mi hov" style="height:auto;padding:6px 10px"><span class="logo" style="width:24px;height:24px;border-radius:6px"><span style="width:15px;height:15px;border-radius:4px;background:#1B2230;font-size:9px">m</span></span><span style="display:flex;flex-direction:column;line-height:16px"><span>Поточний ··4417</span><span class="sub">залишок {eur("11 400,00")}</span></span></div><div class="mi" style="height:auto;padding:6px 10px"><span class="logo" style="width:24px;height:24px;border-radius:6px"><span style="width:15px;height:15px;border-radius:4px;background:#0F5BA8;font-size:9px">R</span></span><span style="display:flex;flex-direction:column;line-height:16px"><span>Кредитна ··9021</span><span class="sub">залишок {eur("640,00","-")}</span></span></div><div class="hr"></div><div class="mi"><span class="i">{ic("plus",16)}</span>Новий рахунок</div></div></div>
</div>
<div class="cell"><div class="cap">Кнопка-список з підписом: єдиний фільтр чи вигляд сторінки</div><div class="row c" style="gap:8px"><button type="button" class="lbtn" aria-haspopup="listbox" aria-label="Категорія: Усі"><span class="muted">Категорія:</span> <b>Усі</b>{ic("chevron-down",16,cls="muted")}</button><button type="button" class="lbtn" aria-haspopup="listbox"><span class="muted">Порівняти з:</span> <b>Середнє за 3 міс.</b>{ic("chevron-down",16,cls="muted")}</button><button type="button" class="lbtn" aria-haspopup="listbox"><span class="muted">Вигляд:</span> <b>Повний</b>{ic("chevron-down",16,cls="muted")}</button></div></div>
</div>'''
C['Select'] = (_s[0], 760, 'Нативний список, «з пошуком» і «кнопка-список з підписом»', _sb, _s[4] + comps5.CATCSS + '.lbtn{position:relative;height:36px;display:inline-flex;align-items:center;gap:4px;padding:0 12px;border:1px solid var(--ctl);border-radius:8px;background:var(--surface-200);font:400 13px/18px Inter,sans-serif;color:var(--ink);white-space:nowrap}.lbtn b{font-weight:500}.lbtn::after{content:"";position:absolute;left:0;right:0;top:50%;height:44px;transform:translateY(-50%)}')

# ---------- Field: тип «дата» ----------
_f = comps1.C['Field']
def cal():
    days = ''
    wd = ['Пн','Вт','Ср','Чт','Пт','Сб','Нд']
    head = ''.join(f'<span class="cw">{d}</span>' for d in wd)
    cells = ['' for _ in range(5)] + list(range(1, 31))  # 1 лист. 2026 — неділя? keep simple layout
    for c in cells:
        if c == '': days += '<span></span>'; continue
        cls = 'cd'
        if c == 2: cls += ' sel'
        if c > 2: cls += ' fut'
        days += f'<button type="button" class="{cls}"{" aria-disabled=\"true\"" if c > 2 else ""}>{c}</button>'
    return (f'<div class="panel" style="width:300px;padding:10px"><div style="display:flex;align-items:center;gap:4px;padding-bottom:6px"><b style="flex:1;font-weight:600">Листопад 2026</b><button type="button" class="ib c" aria-label="Попередній місяць">{ic("chevron-left",16)}</button><button type="button" class="ib c" aria-label="Наступний місяць">{ic("chevron-right",16)}</button></div>'
            f'<div class="cg">{head}{days}</div><div class="row c" style="gap:6px;padding-top:8px"><span class="tag info">Сьогодні</span><span class="tag">Учора</span></div></div>')
_fb = _f[3].replace('</div>', f'''<label class="fld"><span class="l">Дата<span class="req">*</span></span><span class="inp">{ic("calendar",16,cls="muted")}2 лист. 2026 р.<span class="muted">· сьогодні</span><span style="flex:1"></span>{ic("chevron-down",16,cls="muted")}</span></label>
<label class="fld"><span class="l">Дата завершення</span><span class="inp">{ic("calendar",16,cls="muted")}<span class="ph">Без дати</span><span style="flex:1"></span>{ic("chevron-down",16,cls="muted")}</span></label>
<label class="fld"><span class="l">Дата<span class="req">*</span></span><span class="inp err tab" aria-invalid="true">{ic("calendar",16,cls="muted")}31.02.2026</span><span class="errt">{ic("circle-alert",16)}Помилка. Введіть дату у форматі 02.11.2026.</span></label>
</div><div class="cell" style="margin-top:20px"><div class="cap">Календар поля «дата»: майбутні дні недоступні</div>{cal()}</div>''', 1)
C['Field'] = (_f[0], 700, 'Текст, сума і тип «дата»; підпис над полем; стани', _fb, _f[4] + '.cg{display:grid;grid-template-columns:repeat(7,34px);gap:2px;justify-content:space-between}.cw{font:500 11px/20px Inter,sans-serif;color:var(--ink-muted);text-align:center}.cd{height:34px;border:0;border-radius:6px;background:transparent;font:400 13px Inter,sans-serif;color:var(--ink);font-variant-numeric:tabular-nums}.cd.sel{background:var(--brand);color:var(--on-brand);font-weight:600}.cd.fut{color:var(--disabled-ink)}')

# ---------- Dialog: кнопки 40 px, «Скасувати» на кожному кроці, ширини ----------
STEPS = comps1.C['Stepper']
C['Dialog'] = ('Стани', 900, 'Смуга дій: кнопки 40 px (зона 44); «Скасувати» на кожному кроці; ширини 560 / 640 / 900', f'''<div class="stack">
<div class="stack" style="gap:24px;align-items:flex-start">
<div class="scrim"><div class="dlg" role="alertdialog" aria-modal="true" aria-labelledby="d1"><button type="button" class="ib" style="position:absolute;top:12px;right:12px;border-radius:999px" aria-label="Закрити">{ic("x",20)}</button>
<div style="padding:32px 32px 24px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px"><span class="dic" style="background:var(--neg-bg);color:var(--loss)">{ic("trash2",24)}</span><h2 id="d1" class="h2" style="margin-top:4px">Видалити рахунок «Monobank»?</h2><p class="muted" style="margin:0;font-size:15px;line-height:22px;max-width:380px">Транзакції рахунку теж буде видалено. Цю дію не можна відмінити.</p></div>
<div class="dft" style="grid-template-columns:1fr 1fr"><button type="button" class="btn">Скасувати</button><button type="button" class="btn danger" style="border-width:1.5px">Видалити рахунок</button></div></div></div>
<div class="scrim"><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="d2"><button type="button" class="ib" style="position:absolute;top:12px;right:12px;border-radius:999px" aria-label="Закрити">{ic("x",20)}</button>
<div style="padding:28px 32px 24px;display:flex;flex-direction:column;gap:14px"><h2 id="d2" class="h2" style="margin-right:40px">Нова транзакція</h2>
<ol class="stp" aria-label="Кроки форми" style="margin:-6px 0 0 -8px;padding:0;list-style:none"><li style="display:contents"><button type="button" class="st done"><b>{ic("check",12,3)}</b>Основне</button></li><span class="sl"></span><li style="display:contents"><span class="st on" aria-current="step"><b>2</b>Контрагент і категорія</span></li><span class="sl"></span><li style="display:contents"><button type="button" class="st"><b>3</b>Додатково</button></li></ol>
<label class="fld"><span class="l">Контрагент</span><span class="inp">Сільпо</span></label><label class="fld"><span class="l">Категорія<span class="req">*</span></span><span class="inp"><span class="ph">Оберіть…</span></span></label></div>
<div class="dft" style="display:flex;gap:8px"><button type="button" class="btn">Скасувати</button><span style="flex:1"></span><button type="button" class="btn">Назад</button><button type="button" class="btn">Далі</button><button type="button" class="btn pri">Додати транзакцію</button></div></div></div>
</div>
<div class="cell"><div class="cap">Ширини: 560 — типовий; 640 — лише розділення транзакції; 900 — лише розпізнаний чек з оригіналом</div><div class="wd"><span style="width:56%">560 px · будь-який діалог</span><span style="width:64%">640 px · «Розділити транзакцію»</span><span style="width:90%">900 px · «Чек: оригінал і розпізнане»</span></div></div>
</div>''', STEPS[4] + '.scrim{position:relative;padding:24px;border-radius:12px;background:var(--scrim)}.dlg{position:relative;width:560px;max-width:100%;background:var(--surface-200);border-radius:16px;box-shadow:var(--dlg);overflow:hidden}.dic{width:56px;height:56px;border-radius:16px;background:var(--tint);color:var(--brand);display:grid;place-items:center}.dft{display:grid;gap:8px;padding:16px 24px 20px;background:var(--inset);border-top:1px solid var(--surface-300)}.wd{display:flex;flex-direction:column;gap:6px}.wd span{height:28px;display:flex;align-items:center;padding:0 10px;border:1px dashed var(--ctl);border-radius:6px;font-size:12px;color:var(--ink-muted)}.st.done b{background:var(--gain);color:var(--surface-200)}.st{border:0;background:transparent;cursor:pointer}')

# ---------- Stepper: ✓ gain, клікабельні, page-розмір ----------
def steps(items, page=False):
    out = []
    for lab, st in items:
        if st == 'done': out.append(f'<button type="button" class="st done" aria-label="{lab} — заповнено"><b>{ic("check",12,3)}</b>{lab}</button>')
        elif st == 'cur': out.append(f'<span class="st on" aria-current="step"><b>{len(out)+1}</b>{lab}</span>')
        elif st == 'avail': out.append(f'<button type="button" class="st av2"><b>{len(out)+1}</b>{lab}</button>')
        elif st == 'err': out.append(f'<button type="button" class="st er" aria-label="{lab} — є помилка"><b>!</b>{lab}</button>')
        else: out.append(f'<span class="st dis2" aria-disabled="true"><b>{len(out)+1}</b>{lab}</span>')
    return f'<ol class="stp{" pg" if page else ""}" style="list-style:none;margin:0;padding:0">' + '<span class="sl"></span>'.join(out) + '</ol>'
C['Stepper'] = ('Навігація', 360, 'Розміри dialog і page; пройдений «✓» gain і натискається; доступний, недоступний, з помилкою', f'''<div class="stack">
<div class="cell"><div class="cap">dialog · крок 2: пройдений, поточний, доступний</div>{steps([("Основне","done"),("Контрагент і категорія","cur"),("Додатково","avail")])}</div>
<div class="cell"><div class="cap">dialog · крок 1 з порожнім обов’язковим полем: наступні недоступні</div>{steps([("Основне","cur"),("Контрагент і категорія","dis"),("Додатково","dis")])}</div>
<div class="cell"><div class="cap">dialog · пройдений крок став невалідним</div>{steps([("Основне","err"),("Контрагент і категорія","cur"),("Додатково","dis")])}</div>
<div class="cell"><div class="cap">page · шапка майстра імпорту</div><div class="pgh"><b style="font-weight:600">Імпорт виписки</b><span style="flex:1;display:flex;justify-content:center">{steps([("Файли","done"),("Перевірка","cur"),("Результат","avail")], True)}</span><button type="button" class="ib" aria-label="Закрити">{ic("x",20)}</button></div></div>
</div>''', STEPS[4] + '.st{border:0;background:transparent;cursor:pointer;font-family:inherit}.st.done b{background:var(--gain);color:var(--surface-200)}.st.done{color:var(--ink)}.st.av2{color:var(--ink)}.st.dis2{color:var(--disabled-ink);cursor:default}.st.dis2 b{background:var(--disabled-bg);color:var(--disabled-ink)}.st.er{color:var(--ink)}.st.er b{background:var(--warn-bg);color:var(--warn)}.stp.pg .st b{width:24px;height:24px;font-size:12px}.stp.pg .st{font-size:14px;line-height:20px}.stp.pg .sl{width:32px;background:var(--line)}.pgh{height:64px;display:flex;align-items:center;gap:12px;padding:0 16px;border:1px solid var(--line);border-radius:8px;background:var(--surface-200)}.stp{display:flex;align-items:center;gap:2px;flex-wrap:wrap}')

# ---------- Banner: вбудований варіант ----------
_bn = comps2.C['Banner']
_bnb = _bn[3].replace('<div class="stack">', '<div class="stack"><div class="cap">Банер угорі сторінки чи розділу</div>', 1)
_bnb = _bnb[:-len('</div>')] + f'''<div class="cap" style="margin-top:4px">Вбудований — у діалозі, картці чи формі: 12 × 14 px, іконка 16 px, без «×» і смуг</div>
<div class="grid2"><div class="bni" role="note"><span style="color:var(--link)">{ic("info",16)}</span><span><b>Різницю буде записано як коригування.</b> Залишок рахунку зміниться на {eur("250,00","+")}.</span></div>
<div class="bni" role="note"><span style="color:var(--warn)">{ic("triangle-alert",16)}</span><span style="flex:1">Залишки не збігаються на {eur("12,40")}.</span><button type="button" class="btn sm">Звірити</button></div></div></div>'''
C['Banner'] = (_bn[0], 520, 'Банер сторінки і вбудований варіант; тон — іконка і слово, без смуг', _bnb, _bn[4] + '.bni{display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid var(--line);border-radius:8px;background:var(--inset);font-size:13px;line-height:18px}.bni b{font-weight:600}.bni>span:first-child{display:grid;align-self:flex-start;padding-top:1px}')

# ---------- Toast ----------
C['Toast'] = ('Стани', 300, 'Одне за раз; «Відмінити» (не «Скасувати»); 8 с, з дією 10 с; без відліку', f'''<div class="stack" style="align-items:flex-start">
<div class="cell"><div class="cap">Успіх з дією — видно 10 с</div><div class="ts" role="status"><span class="tm">{ic("check",12,3)}</span><span>Транзакцію видалено</span><a href="#" class="tu">Відмінити</a><button type="button" class="tx" aria-label="Закрити">{ic("x",16)}</button></div></div>
<div class="cell"><div class="cap">Масова дія — відміна далі у звіті про виконання</div><div class="ts" role="status"><span class="tm">{ic("check",12,3)}</span><span>Категорію змінено для 5 транзакцій</span><a href="#" class="tu">Відмінити</a><button type="button" class="tx" aria-label="Закрити">{ic("x",16)}</button></div></div>
<div class="cell"><div class="cap">Інформація — 8 с</div><div class="ts" role="status"><span class="tm" style="font:700 12px/1 Inter">i</span><span>Ціль збережено</span><button type="button" class="tx" aria-label="Закрити">{ic("x",16)}</button></div></div>
<div class="cell"><div class="cap">Помилка — не зникає сама</div><div class="ts" role="alert"><span class="tm" style="background:var(--loss);color:var(--surface-200)">{ic("x",12,3)}</span><span>Помилка. Не вдалося зберегти зміни.</span><a href="#" class="tu">Спробувати ще раз</a><button type="button" class="tx" aria-label="Закрити">{ic("x",16)}</button></div></div>
</div>''', comps2.C['Toast'][4])

# ---------- PeriodPicker: режим «Бюджетний період» ----------
_p = comps1.C['PeriodPicker']
_pb = _p[3].replace('<div class="stack">', f'''<div class="stack"><div class="cell"><div class="cap">Режим «Бюджетний період» (сторінка «Бюджет»): три контроли по 36 px, без «Тип періоду»</div><div class="row c" style="gap:4px"><button type="button" class="ib" aria-label="Попередній період">{ic("chevron-left",18)}</button><button type="button" class="bpb" aria-haspopup="listbox">{ic("calendar",16,cls="muted")}Листопад 2026{ic("chevron-down",16,cls="muted")}</button><button type="button" class="ib dis" aria-disabled="true" aria-label="Наступний період">{ic("chevron-right",18)}</button><span style="width:8px"></span><button type="button" class="ib" aria-label="Налаштування бюджету" style="border:1px solid var(--ctl)">{ic("settings",18)}</button></div></div>''', 1)
C['PeriodPicker'] = (_p[0], 420, 'Аналітичні таблиці: тип і конкретний період; режим «Бюджетний період»', _pb, _p[4] + '.bpb{position:relative;height:36px;display:inline-flex;align-items:center;gap:8px;padding:0 12px;border:1px solid var(--ctl);border-radius:8px;background:var(--surface-200);color:var(--ink);font:600 14px/20px Inter,sans-serif;white-space:nowrap}.bpb::after{content:"";position:absolute;left:0;right:0;top:50%;height:44px;transform:translateY(-50%)}')

# ---------- ViewSwitch: 28 × 28; «Таблиця» не вигляд графіка ----------
C['ViewSwitch'] = ('Навігація', 360, 'Кнопки 28 × 28 (зона 44); у меню графіка «Таблиці» немає — таблиця під графіком', f'''<div class="stack">
<div class="row">
<div class="cell"><div class="cap">Картки / Таблиця (лише для списків)</div><div class="vs" role="radiogroup" aria-label="Показати як"><span class="on" role="radio" aria-checked="true" aria-label="Картки">{ic("layout-grid",16)}</span><span role="radio" aria-checked="false" aria-label="Таблиця">{ic("table",16)}</span></div></div>
<div class="cell"><div class="cap">Наведення</div><div class="vs"><span class="on">{ic("layout-grid",16)}</span><span class="hov">{ic("table",16)}</span></div></div>
<div class="cell"><div class="cap">Фокус</div><div class="vs"><span class="on ring">{ic("layout-grid",16)}</span><span>{ic("table",16)}</span></div></div>
<div class="cell"><div class="cap">PoC: кнопка вигляду графіка неактивна</div><button type="button" class="ib c dis" aria-disabled="true" aria-label="Вигляд: Стовпчики" title="Вигляд: Стовпчики">{ic("chart-no-axes-column",16)}</button></div>
</div>
<div class="cell"><div class="cap">Варіант «меню» в заголовку картки графіка (PoC v2): виглядів графіка, без «Таблиці»</div><div class="row" style="gap:12px;align-items:flex-start"><button type="button" class="ib c on" aria-haspopup="menu" aria-expanded="true" aria-label="Вигляд: Стовпчики">{ic("chart-no-axes-column",16)}</button>
<div class="panel" style="width:220px"><div class="mi hov"><span class="i">{ic("chart-column",16)}</span>Стовпчики<span class="k">{ic("check",16)}</span></div><div class="mi"><span class="i">{ic("chart-bar-stacked",16)}</span>Накопичено</div><div class="mi"><span class="i">{ic("chart-line",16)}</span>По днях</div></div>
<span class="sub" style="max-width:260px">Таблиця тих самих чисел доступна під графіком у кожному вигляді.</span></div></div>
<div class="cell"><div class="cap">Вигляд усієї сторінки — не іконка, а кнопка-список</div><button type="button" class="lbtn" aria-haspopup="listbox"><span class="muted">Вигляд:</span> <b>Повний</b>{ic("chevron-down",16,cls="muted")}</button></div>
</div>''', '.vs{display:inline-flex;gap:2px}.vs span{position:relative;width:28px;height:28px;display:grid;place-items:center;border-radius:4px;color:var(--ink-muted)}.vs .on{background:var(--surface-300);color:var(--ink);box-shadow:inset 0 -2px 0 var(--brand)}.vs .hov{color:var(--ink);background:var(--surface-100)}.vs span::after{content:"";position:absolute;left:50%;top:50%;width:44px;height:44px;transform:translate(-50%,-50%)}.lbtn{position:relative;height:36px;display:inline-flex;align-items:center;gap:4px;padding:0 12px;border:1px solid var(--ctl);border-radius:8px;background:var(--surface-200);font:400 13px/18px Inter,sans-serif;color:var(--ink);white-space:nowrap;align-self:flex-start}.lbtn b{font-weight:500}')
