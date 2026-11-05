import re,sys,os,collections
NB=' '
NUM=r'\d{1,3}(?:[   ]\d{3})*(?:,\d+)?'
CUR=re.compile(r'([+\-−]?)([€₴$])[   ]?('+NUM+r')(?:([  ])(тис\.|млн))?(?!\d|,\d)')
def currency(s):
    def rep(m):
        sign,sym,num,_,unit=m.groups()
        if sign=='-': sign='−'
        num=re.sub(r'[  ]',NB,num); u=(NB+unit) if unit else ''
        return f'{sign}{num}{u}{NB}{sym}'
    # protect "$preview" and template ${...}
    s=CUR.sub(lambda m: m.group(0) if m.group(2)=='$' and (m.start()>0 and s[m.start()-1] in '"{' ) else rep(m),s)
    s=re.sub(r'(\d{1,3}(?:[  ]\d{3})*,\d\d)[  ]EUR\b',lambda m: m.group(1).replace(' ',NB)+NB+'€',s)
    s=re.sub(r'(<span style="margin-left: ?auto; ?color: ?#566174;?">)EUR</span>',r'\1€</span>',s)
    s=s.replace('<span style="color: #566174; font-weight: 500;">EUR</span>','<span style="color: #566174; font-weight: 500;">€</span>')
    return s
def moredots(s):
    def rep(m):
        t=m.group(0)
        t=re.sub(r'aria-label="Ще дії[^"]*"','aria-label="Ще дії"',t)
        t=re.sub(r'title="Ще дії[^"]*"','title="Ще дії"',t)
        if 'role="menu"' in t: return re.sub(r' title="Ще дії"','',t)
        if 'title=' not in t: t=t.replace('aria-label="Ще дії"','aria-label="Ще дії" title="Ще дії"')
        if 'aria-haspopup' not in t: t=t.replace('aria-label="Ще дії"','aria-haspopup="menu" aria-expanded="false" aria-label="Ще дії"')
        return t
    return re.sub(r'<[a-z]+\b[^>]*aria-label="Ще дії[^"]*"[^>]*>',rep,s)
TONE={'#1D4E89':'#1D4E89','#A15C07':'#7A4505','#27704C':'#27704C','#B7791F':'#7A4505','#B23A3A':'#B23A3A','#C24A3E':'#B23A3A'}
def bold_lead(t):
    if '<b' in t[:200] or t.startswith('<'): return t
    m=re.match(r'([^<]{4,}?[.:!?])(\s|$)',t)
    if m and len(m.group(1))<=90: return '<b style="font-weight: 600;">'+m.group(1)+'</b>'+t[len(m.group(1)):]
    return t
def banners(s):
    open_re=re.compile(r'<div style="([^"]*?)border-left: ?3px solid (#[0-9A-Fa-f]{6});([^"]*)">')
    out=[];pos=0;n=0
    for m in open_re.finditer(s):
        if m.start()<pos: continue
        pre,col,post=m.group(1),m.group(2).upper(),m.group(3); tone=TONE.get(col,col)
        st=pre+post
        st=re.sub(r'background: ?#[0-9A-Fa-f]{6};?','',st); st=re.sub(r'(?<![-\w])color: ?#[0-9A-Fa-f]{6};?','',st); st=re.sub(r'border-radius: ?\d+px;?','',st)
        st=st.strip().rstrip(';'); st=(st+'; ' if st else '')+'border: 1px solid #E5E5E2; border-radius: 8px; background: #FAFAF8; color: #1B2230;'
        new='<div role="note" style="'+st+'">'
        rest=s[m.end():]
        im=re.match(r'<span style="display: grid; padding-top: 1px;">',rest)
        out.append(s[pos:m.start()])
        if im:
            rest2=rest[im.end():]; k=rest2.find('</span>')+7
            new+='<span style="display: grid; padding-top: 1px; color: '+tone+';">'+rest2[:k]
            tm=re.match(r'<span style="flex: 1;">',rest2[k:])
            if tm:
                ins=k+tm.end(); body=rest2[ins:]; e=body.find('</span>')
                new+=rest2[k:ins]+bold_lead(body[:e]); consumed=ins+e
            else: consumed=k
            out.append(new); pos=m.end()+im.end()+consumed
        else:
            out.append(new); pos=m.end()
        n+=1
    out.append(s[pos:]); return ''.join(out)
MK={'#EEF2F7':'i','#F1F1EF':'•','#FBF3E8':'!','#E9F3EE':'✓','#F8ECEC':'✕'}
POS={'Активне','Завершено','Підключено'}; NEG={'Помилка'}
def badges(s):
    def rep(m):
        pre,st,post,body=m.group(1) or '',m.group(2),m.group(3),m.group(4)
        if not re.search(r'font: ?500 11px',st): return m.group(0)
        bg=re.search(r'background: ?(#[0-9A-Fa-f]{6})',st)
        if not bg: return m.group(0)
        bgc=bg.group(1).upper(); txt=re.sub('<[^>]+>','',body).strip()
        if txt[:1] in '✓!✕i•★' and (len(txt)<2 or txt[1] in '  '): return m.group(0)
        if txt in POS:
            st=re.sub(r'background: ?#[0-9A-Fa-f]{6}','background: #E9F3EE',st); st=re.sub(r'(?<![-\w])color: ?#[0-9A-Fa-f]{6}','color: #27704C',st); bgc='#E9F3EE'
        if txt in NEG:
            st=re.sub(r'background: ?#[0-9A-Fa-f]{6}','background: #F8ECEC',st); st=re.sub(r'(?<![-\w])color: ?#[0-9A-Fa-f]{6}','color: #B23A3A',st); bgc='#F8ECEC'
        mk='★' if txt=='Головна' else MK.get(bgc)
        if not mk: return m.group(0)
        if 'gap' not in st: st=st.rstrip('; ')+'; gap: 4px;'
        return f'<span{pre} style="{st}"{post}><span aria-hidden="true">{mk}</span>{body}</span>'
    return re.sub(r'<span((?: [^>]*?)?) style="([^"]*height: ?20px;[^"]*)"([^>]*)>((?:(?!<span|</span>).)*)</span>',rep,s)
def borders(s):
    s=re.sub(r'(border: ?1px solid )#C9CDD3',r'\g<1>#7B8494',s)
    s=re.sub(r'(border: ?(?:1\.5|2)px solid )#9AA3AF',r'\g<1>#7B8494',s)
    s=re.sub(r'(width: 36px; height: 20px; flex: none; border-radius: 999px; background: )#C9CDD3',r'\g<1>#7B8494',s)
    s=s.replace('background: transparent; color: #C9CDD3;','background: transparent; color: #8A8F99;')
    s=re.sub(r'(border: ?1px dashed )#C9CDD3(;[^"]*"[^>]*>(?:<[^>]+>)*\s*Без категорі)',r'\g<1>#7B8494\2',s)
    def rep(m):
        tag,pre,st,attrs,post=m.group(1),m.group(2),m.group(3),m.group(4),m.group(5)
        h=re.search(r'(?<![-\w])height: ?(\d+)px',st)
        if not h: return m.group(0)
        h=int(h.group(1)); ok=(tag in('button','label') and 32<=h<=40) or (tag=='div' and h==38 and 'role="group"' in pre) or (tag=='span' and h==32 and post.startswith('10<svg'))
        if not ok: return m.group(0)
        return f'<{tag}{pre}style="{re.sub(r"(border: ?1px solid )#E5E5E2",r"\g<1>#7B8494",st,count=1)}"{attrs}>{post}'
    return re.sub(r'<(button|label|div|span)\b([^>]*?)style="([^"]*border: ?1px solid #E5E5E2[^"]*)"([^>]*)>(.{0,12})',rep,s)
def danger(s): return s.replace('border: 1px solid #E7B9B9','border: 1.5px solid #B23A3A')
def deltas(s):
    s=s.replace('#2E7D4F','#27704C').replace('#5FA77D','#387F5A').replace('#D46A6A','#C34A48')
    return s.replace('color: #2E7D32; font: 500 12px/16px Inter, sans-serif; white-space: nowrap;">✓','color: #27704C; font: 500 12px/16px Inter, sans-serif; white-space: nowrap;">✓')
VSTY='width: 28px; height: 28px; flex: none; display: grid; place-items: center; padding: 0; border: 0; border-radius: 4px; background: transparent; color: #8A8F99; cursor: default; text-decoration: none; box-sizing: border-box;'
def viewbtn(s,disabled=True):
    def rep(m):
        tag,attrs,inner=m.group(1),m.group(2),m.group(3)
        lab=re.search(r'aria-label="([^"]*)"',attrs).group(1)
        if not lab.startswith('Вигляд') or lab.startswith('Вигляд сторінки') or lab.startswith('Вигляд порівняння'): return m.group(0)
        if lab=='Вигляд графіка' or lab=='Вигляд': lab='Вигляд: Стовпчики'
        lab=lab.replace('Вигляд графіка:','Вигляд:')
        lab=re.sub(r'Вигляд: (\w)',lambda x:'Вигляд: '+x.group(1).upper(),lab)
        inner=re.sub(r'<svg width="\d+" height="\d+"','<svg width="16" height="16"',inner,1)
        exp='true' if 'aria-expanded="true"' in attrs else 'false'
        if 'disabled' in attrs and 'aria-expanded="true"' not in attrs:
            return f'<{tag}{" type=\"button\"" if tag=="button" else ""} aria-disabled="true" aria-haspopup="menu" aria-expanded="false" aria-label="{lab}" title="{lab}" style="{VSTY}">{inner}</{tag}>'
        sty=VSTY.replace('color: #8A8F99; cursor: default;','color: #566174; cursor: pointer;')
        if exp=='true': sty=sty.replace('background: transparent;','background: #F1F1EF;').replace('color: #566174;','color: #1B2230;')
        return f'<{tag}{" type=\"button\"" if tag=="button" else ""} aria-haspopup="menu" aria-expanded="{exp}" aria-label="{lab}" title="{lab}" style="{sty}">{inner}</{tag}>'
    return re.sub(r'<(button|a)\b([^>]*aria-label="Вигляд[^"]*"[^>]*)>(.*?)</\1>',rep,s,flags=re.S)
def periodswitch(s):
    for m in list(re.finditer(r'<div role="group" aria-label="Період" style="display: flex; gap: 2px;">(.*?)</div>',s,re.S)):
        blk=m.group(0)
        if '1М' not in blk: continue
        nb=blk.replace('<div role="group" aria-label="Період" style="display: flex; gap: 2px;">','<div role="radiogroup" aria-label="Період графіка" style="display: flex; gap: 2px;">')
        nb=re.sub(r'<button type="button" aria-pressed="true" style="([^"]*)">','<button type="button" role="radio" aria-checked="true" style="height: 32px; padding: 0 10px; border: 0; border-radius: 4px; background: #F1F1EF; color: #1B2230; font: 600 13px Inter, sans-serif; box-shadow: inset 0 -2px 0 #0B2545;">',nb)
        nb=re.sub(r'<button type="button" style="','<button type="button" role="radio" aria-checked="false" style="',nb)
        s=s.replace(blk,nb)
    return s
SEG='<div style="display: inline-flex; gap: 2px; padding: 3px; border-radius: 8px; background: #F1F1EF;">'
def segmented(s):
    pos=0
    while True:
        a=s.find(SEG,pos)
        if a<0: break
        e=s.find('</div>',a); blk=s[a:e]
        lab='Тип транзакції' if 'Списання' in blk else 'Показати' if 'Мерчанти' in blk else 'Пари' if 'Пропозиції' in blk else 'Вигляд'
        nb=blk.replace(SEG,f'<div role="radiogroup" aria-label="{lab}" style="display: inline-flex; gap: 2px; padding: 3px; border-radius: 8px; background: #F1F1EF;">')
        nb=re.sub(r'<span style="([^"]*background: #FFFFFF;[^"]*)">',r'<span role="radio" aria-checked="true" style="\1">',nb)
        nb=re.sub(r'<span style="([^"]*background: transparent;[^"]*)">',r'<span role="radio" aria-checked="false" style="\1">',nb)
        s=s[:a]+nb+s[e:]; pos=a+len(nb)
    # tablist segmented (compare view, focus view)
    def tl(m):
        b=m.group(0)
        return b.replace('role="tablist"','role="radiogroup"').replace('role="tab" aria-selected="true"','role="radio" aria-checked="true"').replace('role="tab" aria-selected="false"','role="radio" aria-checked="false"')
    s=re.sub(r'<div role="tablist" aria-label="(?:Вигляд порівняння|Фокус|Фокус-вид|Показати)[^"]*"[^>]*>.*?</div>',tl,s,flags=re.S)
    return s
BUDMAP={'є залишок':'#27704C','майже вичерпано':'#7A4505','перевищено':'#B23A3A','ліміт вичерпано':'#566174','не почато':'#566174','вичерпано':'#7A4505'}
def budgetstates(s):
    def rep(m):
        key=m.group(1).split('·')[0].strip()
        if key not in BUDMAP: return m.group(0)
        return re.sub(r'((?<![-\w])color: )#[0-9A-F]{6}',r'\g<1>'+BUDMAP[key],m.group(0))
    s=re.sub(r'<span title="([^"]*)" style="[^"]*"><span aria-hidden="true" style="[^"]*">.</span>',rep,s)
    s=re.sub(r'(?<![-\w])color: #(C94D3D|E81B0D|D14637|DF3322|E5584A|F2281A); (font-weight: 600;|white-space: nowrap;)">([−+]?[\d  ,]+ €)',r'color: #1B2230; \2">\3',s)
    s=s.replace('#7D8794','#566174')
    return s
REF='rgba(27, 34, 48, 0.6)'
def chartref(s,name):
    def rep(m):
        t=m.group(0); da=re.search(r'stroke-dasharray="([^"]*)"',t).group(1)
        if 'stroke="#3A4350"' not in t: return t
        if (name.startswith('PlanBudget') or name.startswith('PlanTrend') or name=='Main') and da in ('12 4','4 4'): return t.replace('stroke="#3A4350"',f'stroke="{REF}"')
        if name.startswith('PlanGoal') and da=='6 4': return t.replace('stroke="#3A4350"',f'stroke="{REF}"').replace('stroke-dasharray="6 4"','stroke-dasharray="4 4"')
        return t
    return re.sub(r'<(line|path|polyline)\b[^>]*stroke-dasharray="[^"]*"[^>]*>',rep,s)
def hint_i(s):
    INFO='<span style="display: grid; padding-top: 1px; color: #1D4E89;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4M12 8h.01"></path></svg></span>'
    OLD_I='<span aria-hidden="true" style="width:16px;height:16px;flex:none;border-radius:999px;border:1.5px solid #566174;box-sizing:border-box;display:grid;place-items:center;font:700 10px/1 Inter;color:#566174;margin-top:1px;">i</span>'
    OLD_BOX='<div style="display:flex;gap:10px;padding:12px 14px;border-radius:10px;background:#EEF2F7;color:#1B2230;font-size:13px;line-height:18px;">'
    NEW_BOX='<div role="note" style="display:flex;gap:10px;padding:12px 14px;border:1px solid #E5E5E2;border-radius:8px;background:#FAFAF8;color:#1B2230;font-size:13px;line-height:18px;">'
    return s.replace(OLD_BOX+OLD_I+'<span>',NEW_BOX+INFO+'<span>')
def notebtn32(s):
    pos=0
    while True:
        a=s.find('<div role="note"',pos)
        if a<0: break
        depth=0;e=None
        for m in re.finditer(r'<div\b|</div>',s[a:]):
            depth+=1 if m.group(0)=='<div' else -1
            if depth==0: e=a+m.end(); break
        blk=s[a:e]; nb=re.sub(r'(<(?:a|button)\b[^>]*style="[^"]*?)height: 40px;([^"]*?)font: 600 14px',r'\1height: 32px;\2font: 600 13px',blk)
        s=s[:a]+nb+s[e:]; pos=a+len(nb)
    return s
def dialogs(s):
    s=re.sub(r'height: 48px; padding: 0 12px; (border: [^;]*;) border-radius: 10px',r'height: 40px; padding: 0 12px; \1 border-radius: 8px',s)
    s=re.sub(r'(height: 40px; padding: 0 12px; border: [^;]*; border-radius: 8px;[^"]*?)font: 600 15px',r'\1font: 600 14px',s)
    return s
def stepper(s):
    a=s.find('<div role="tablist" aria-label="Кроки форми"')
    if a>=0:
        e=s.find('</div>',a); blk=s[a:e+6]
        nb=blk.replace('<div role="tablist" aria-label="Кроки форми" style="','<ol aria-label="Кроки форми" style="list-style: none; padding: 0; ',1)[:-6]+'</ol>'
        nb=re.sub(r'(<(?:a|button|span) [^>]*?)role="tab" aria-selected="true"',r'\1aria-current="step"',nb)
        nb=re.sub(r'(<(?:a|button|span) [^>]*?)role="tab" aria-selected="false" ',r'\1',nb)
        nb=re.sub(r'(<(a|button) .*?</\2>)',r'<li style="display: contents;">\1</li>',nb,flags=re.S)
        nb=re.sub(r'(<span aria-hidden="true" style="width: 10px; height: 1px;[^"]*"></span>)',r'<li aria-hidden="true" style="display: contents;">\1</li>',nb)
        s=s.replace(blk,nb)
    return re.sub(r'background: #[0-9A-F]{6}; color: #FFFFFF; font: 700 11px/1 Inter, sans-serif;">✓','background: #27704C; color: #FFFFFF; font: 700 11px/1 Inter, sans-serif;">✓',s)
def cancel_on_steps(s,href):
    j=s.rfind('border-top: 1px solid #F1F1EF')
    if j<0: return s
    foot=s[j:]
    if '>Скасувати</' in foot or '>Назад</' not in foot: return s
    m=re.search(r'<(a href="[^"]+"|button type="button" ) *style="([^"]*)">Назад</(a|button)>',foot)
    if not m: return s
    btn=f'<a href="{href}" style="{m.group(2)}">Скасувати</a>'
    foot2=foot.replace(m.group(0)+'<span style="flex: 1;"></span>',btn+'<span style="flex: 1;"></span>'+m.group(0),1)
    if foot2==foot: print('  !! cancel not placed')
    return s[:j]+foot2
def apply_all(path,palette=False):
    name=os.path.basename(path)[:-8]
    s=open(path,encoding='utf-8').read(); o=s
    s=currency(s)
    if not palette:
        for f in (moredots,banners,badges,borders,danger,deltas,viewbtn,periodswitch,segmented,budgetstates,hint_i,notebtn32,dialogs,stepper): s=f(s)
        s=chartref(s,name)
    if s!=o: open(path,'w',encoding='utf-8').write(s); return True
    return False
if __name__=='__main__':
    D=sys.argv[1]; names=sys.argv[2:]
    for n in names:
        print(n, apply_all(os.path.join(D,n+'.dc.html'), palette=n in ('PlanPalette','PlanChartColors','CatShades')))
