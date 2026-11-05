import re,sys,os
D=sys.argv[1]
X='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>'
COLS='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M9 3v18"></path><path d="M15 3v18"></path></svg>'
SLID='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 4h-7"></path><path d="M10 4H3"></path><path d="M21 12h-9"></path><path d="M8 12H3"></path><path d="M21 20h-5"></path><path d="M12 20H3"></path><path d="M14 2v4"></path><path d="M8 10v4"></path><path d="M16 18v4"></path></svg>'
IB='width: 36px; height: 36px; flex: none; display: grid; place-items: center; border: 0; border-radius: 8px; background: transparent; color: #566174; cursor: pointer;'
def ibtn(label,icon,pop): return f'<button type="button" aria-haspopup="{pop}" aria-expanded="false" aria-label="{label}" title="{label}" style="{IB}">{icon}</button>'
TOOLS=ibtn('Колонки',COLS,'dialog')+ibtn('Параметри',SLID,'menu')
FIELD={'Листопад 2026':'Період','1–31 жовт.':'Період','Рахунки: 2':'Рахунки','Ощадний ··1180':'Рахунок','Кредитна ··9021':'Рахунок','Рахунок: Кредитна ··9021':'Рахунок','ikea':'Пошук','Продукти':'Категорія'}
def chipname(t):
    t=t.strip()
    if ':' in t: a,b=t.split(':',1); return f'{a.strip()} — {b.strip()}'
    return f'{FIELD.get(t,"Фільтр")} — {t}'
def xbtn(name): return f'<button type="button" aria-label="Прибрати фільтр: {name}" title="Прибрати фільтр: {name}" style="width: 24px; height: 24px; flex: none; display: grid; place-items: center; margin-left: 2px; padding: 0; border: 0; border-radius: 999px; background: transparent; color: #566174; cursor: pointer;">{X}</button>'
def fix(s):
    # filter button: separate count bubble -> text
    s,n1=re.subn(r'Фільтри<span style="min-width: 18px;[^"]*">(\d+)</span>',r'Фільтри · \1',s)
    s=re.sub(r'(<(?:a|button)\b[^>]*?)( style="[^"]*height: 36px;[^"]*">\s*<svg[^>]*>(?:(?!</svg>).)*</svg>\s*Фільтри · )',lambda m:(m.group(1) if 'aria-haspopup' in m.group(1) else m.group(1)+' aria-haspopup="dialog" aria-expanded="false"')+m.group(2),s,flags=re.S)
    # chip x
    def chip(m):
        text=m.group(2); return m.group(1)+text+xbtn(chipname(text))
    s,n2=re.subn(r'(<span style="[^"]*height: ?32px;[^"]*">)([^<]+)<span aria-label="Прибрати"[^>]*>\s*<svg[^>]*>(?:(?!</svg>).)*</svg>\s*</span>',chip,s,flags=re.S)
    return s,n1,n2
for f in sys.argv[2:]:
    p=os.path.join(D,f+'.dc.html'); s=open(p).read()
    s,n1,n2=fix(s)
    n3=0
    if '--tools' in os.environ.get('TOOLS','') or f in os.environ.get('TOOLS',''):
        pat='<div style="flex: 1;"></div>\n  \n</div>'
        if pat in s: s=s.replace(pat,'<div style="flex: 1;"></div>\n  '+TOOLS+'\n</div>',1); n3=1
    open(p,'w').write(s); print(f,n1,n2,n3)
