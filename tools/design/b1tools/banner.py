import re,glob,sys
D=sys.argv[1]
TONE={'#1D4E89':'#1D4E89','#A15C07':'#7A4505','#27704C':'#27704C','#B7791F':'#7A4505','#B23A3A':'#B23A3A'}
open_re=re.compile(r'<div style="([^"]*?)border-left: ?3px solid (#[0-9A-Fa-f]{6});([^"]*)">')
def bold_lead(t):
    if '<b' in t[:200] or t.startswith('<'): return t
    m=re.match(r'([^<]{4,}?[.:!?])(\s|$)',t)
    if m and len(m.group(1))<=90:
        return '<b style="font-weight: 600;">'+m.group(1)+'</b>'+t[len(m.group(1)):]
    return t
for f in sorted(glob.glob(D+'/Poc*.dc.html')):
    s=open(f,encoding='utf-8').read(); n=0
    out=[];pos=0
    for m in open_re.finditer(s):
        pre,col,post=m.group(1),m.group(2).upper(),m.group(3)
        tone=TONE.get(col,col)
        st=pre+post
        st=re.sub(r'background: ?#[0-9A-Fa-f]{6};?','',st)
        st=re.sub(r'(?<![-\w])color: ?#[0-9A-Fa-f]{6};?','',st)
        st=re.sub(r'border-radius: ?\d+px;?','',st)
        st=st.strip().rstrip(';')
        st=(st+'; ' if st else '')+'border: 1px solid #E5E5E2; border-radius: 8px; background: #FAFAF8; color: #1B2230;'
        st=re.sub(r';\s*;',';',st)
        new='<div role="note" style="'+st+'">'
        # icon span directly after?
        rest=s[m.end():]
        im=re.match(r'<span style="display: grid; padding-top: 1px;">',rest)
        if im:
            new+='<span style="display: grid; padding-top: 1px; color: '+tone+';">'
            rest2=rest[im.end():]
            k=rest2.find('</span>')+7
            new+=rest2[:k]
            tm=re.match(r'<span style="flex: 1;">',rest2[k:])
            if tm:
                inner_start=k+tm.end()
                # find inner text up to matching close (assume no nested span before text)
                body=rest2[inner_start:]
                new+=rest2[k:inner_start]+bold_lead(body[:body.find('</span>')])
                consumed=inner_start+body.find('</span>')
            else:
                consumed=k
            out.append(s[pos:m.start()]); out.append(new); pos=m.end()+im.end()+consumed
        else:
            out.append(s[pos:m.start()]); out.append(new); pos=m.end()
            print('  noicon',f.split('/')[-1])
        n+=1
    if n:
        out.append(s[pos:]); open(f,'w',encoding='utf-8').write(''.join(out)); print(f.split('/')[-1],n)
