import re,glob,sys
D=sys.argv[1]
MK={'#EEF2F7':'i','#F1F1EF':'•','#FBF3E8':'!','#E9F3EE':'✓','#F8ECEC':'✕'}
POS={'Активне','Завершено','Підключено'}
tot=0
for f in sorted(glob.glob(D+'/Poc*.dc.html')):
    s=open(f,encoding='utf-8').read(); n=0
    def rep(m):
        global n
        st,body=m.group(1),m.group(2)
        if not re.search(r'font: ?500 11px',st): return m.group(0)
        bg=re.search(r'background: ?(#[0-9A-Fa-f]{6})',st)
        if not bg: return m.group(0)
        bgc=bg.group(1).upper(); txt=re.sub('<[^>]+>','',body).strip()
        if txt[:1] in '✓!✕i•★' and (len(txt)<2 or txt[1] in '  '): return m.group(0)
        if txt in POS:
            st=re.sub(r'background: ?#[0-9A-Fa-f]{6}','background: #E9F3EE',st)
            st=re.sub(r'(?<![-\w])color: ?#[0-9A-Fa-f]{6}','color: #27704C',st); bgc='#E9F3EE'
        mk='★' if txt=='Головна' else MK.get(bgc)
        if not mk: return m.group(0)
        if 'gap' not in st: st=st.rstrip('; ')+'; gap: 4px;'
        n+=1
        return f'<span{m.group(3)}style="{st}"{m.group(4)}><span aria-hidden="true">{mk}</span>{body}</span>'
    s2=re.sub(r'<span( [^>]*?)?style="([^"]*height: ?20px;[^"]*)"([^>]*)>((?:(?!<span|</span>).)*)</span>',lambda m: rep(type('M',(),{'group':lambda self,i,m=m:{0:m.group(0),1:m.group(2),2:m.group(4),3:(m.group(1) or '')+' ',4:m.group(3)}[i]})()),s)
    if n: open(f,'w',encoding='utf-8').write(s2); print(f.split('/')[-1],n); tot+=n
print(tot)
