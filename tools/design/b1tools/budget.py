import re,sys
DOTS='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>'
pat=re.compile(r'<button type="button" aria-label="Редагувати категорію (.+?): [^"]*" title="[^"]*" style="([^"]*)">(<svg.*?</svg>)</button>',re.S)
def balanced_end(s,a):
    depth=0
    for m in re.finditer(r'<div\b|</div>',s[a:]):
        depth+=1 if m.group(0)=='<div' else -1
        if depth==0: return a+m.end()
def fix(p):
    s=open(p).read(); o=s
    # filter button 36
    m=re.search(r'(<button type="button" aria-haspopup="menu" aria-expanded="(?:true|false)" aria-label="Фільтри категорій[^"]*" style=")height: 32px;([^"]*?)padding: 0 10px;([^"]*">)(<svg.*?</svg>)(Фільтри(?: · \d)?)(<svg.*?</svg>)</button>',s,re.S)
    if m: s=s.replace(m.group(0),m.group(1)+'height: 36px;'+m.group(2)+'padding: 0 12px;'+m.group(3)+m.group(4)+m.group(5)+'</button>')
    menu_at=s.find('<div role="menu" style="position: absolute; right: 16px; top: 44px;')
    out=[];pos=0;n=0
    for m in pat.finditer(s):
        name,sty,svg=m.group(1),m.group(2),m.group(3)
        is_open = menu_at>0 and m.end()<menu_at and s.find('aria-label="Редагувати категорію',m.end(),menu_at)<0 and menu_at-m.end()<4000
        psty=sty.replace('background: #F1F1EF','background: transparent')
        pencil=f'<button type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="Змінити ліміт {name}" title="Змінити ліміт" style="{psty}">{svg}</button>'
        dsty=re.sub(r'background: [^;]*;','background: #F1F1EF;' if is_open else 'background: transparent;',sty)
        dots=f'<button type="button" aria-haspopup="menu" aria-expanded="{"true" if is_open else "false"}" aria-label="Ще дії" title="Ще дії" style="{dsty}">{DOTS}</button>'
        out.append(s[pos:m.start()]); out.append(pencil+dots); pos=m.end(); n+=1
    out.append(s[pos:]); s=''.join(out)
    # drop pencil in rows with «Задати ліміт»
    pos=0
    while True:
        i=s.find('Задати ліміт',pos)
        if i<0: break
        k=s.find('<button type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="Змінити ліміт',i)
        nxt=s.find('Задати ліміт',i+5)
        if k>0 and not (nxt>0 and k>nxt) and k-i<3000:
            e=s.find('</button>',k)+9; s=s[:k]+'<span aria-hidden="true" style="width: 32px; height: 32px; flex: none;"></span>'+s[e:]
        pos=i+5
    if n:
        i=s.find('title="Сортувати за: залишок"'); j=s.find('<span style="width: 32px;"></span></div>',i)
        if i>0 and 0<j-i<1500: s=s[:j]+'<span style="width: 74px; flex: none;"></span></div>'+s[j+len('<span style="width: 32px;"></span></div>'):]
        i=s.find('>Разом<'); j=s.find('<span style="width: 32px;"></span>',i)
        if i>0 and 0<j-i<2500: s=s[:j]+'<span style="width: 74px; flex: none;"></span>'+s[j+len('<span style="width: 32px;"></span>'):]
    if menu_at>0:
        a=s.find('<div role="menu" style="position: absolute; right: 16px; top: 44px;'); e=balanced_end(s,a); old=s[a:e]
        svgs=re.findall(r'<svg.*?</svg>',old,re.S); ticon=svgs[1] if len(svgs)>1 else svgs[0]
        X='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>'
        LOCK='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>'
        MI='display: flex; align-items: center; gap: 10px; min-height: 38px; padding: 0 10px; border-radius: 6px; color: #1B2230; text-decoration: none;'
        tgt=re.search(r'href="([^"]*Target[^"]*)"',old); tgt=tgt.group(1) if tgt else '#'
        new=('<div role="menu" aria-label="Дії категорії" style="position: absolute; right: 16px; top: 44px; z-index: 5; width: 340px; box-sizing: border-box; padding: 4px; background: #FFFFFF; border: 1px solid #E5E5E2; border-radius: 8px; box-shadow: 0 8px 24px rgba(11,37,69,.16); font-size: 14px; text-align: left;">'
         f'<a href="{tgt}" role="menuitem" style="{MI}"><span style="display: grid; color: #566174;">{ticon}</span><span style="flex: 1;">Цільова сума…</span></a>'
         f'<div role="menuitemcheckbox" aria-checked="false" style="display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 10px; border-radius: 6px;"><span style="display: grid; color: #566174;">{LOCK}</span><span style="flex: 1; display: flex; flex-direction: column;"><span>Обов’язкова</span><span style="color: #566174; font-size: 12px; line-height: 16px;">залишок ліміту зменшує «Можна витратити»</span></span><span aria-hidden="true" style="width: 36px; height: 20px; flex: none; border-radius: 999px; background: #7B8494; position: relative; display: inline-block;"><span style="position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 999px; background: #FFFFFF;"></span></span></div>'
         '<div role="separator" style="height: 1px; background: #E5E5E2; margin: 4px 8px;"></div>'
         f'<div role="menuitem" style="{MI.replace("#1B2230","#B23A3A")}"><span style="display: grid; color: #B23A3A;">{X}</span><span style="flex: 1;">Прибрати ліміт</span></div></div>')
        s=s[:a]+new+s[e:]
    if s!=o: open(p,'w').write(s)
    return n
for p in sys.argv[1:]: print(p,fix(p))
