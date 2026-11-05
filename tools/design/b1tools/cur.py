import re,glob,sys
D=sys.argv[1]; NB=' '
NUM=r'\d{1,3}(?:[   ]\d{3})*(?:,\d+)?'
pat=re.compile(r'([+\-−]?)([€₴])[   ]?('+NUM+r')(?:([  ])(тис\.|млн))?(?!\d|,\d)')
tot=0
for f in sorted(glob.glob(D+'/Poc*.dc.html')):
    s=open(f,encoding='utf-8').read()
    def rep(m):
        sign,sym,num,_,unit=m.groups()
        if sign=='-': sign='−'
        num=re.sub(r'[  ]',NB,num)
        u=(NB+unit) if unit else ''
        return f'{sign}{num}{u}{NB}{sym}'
    s2,n=pat.subn(rep,s)
    if n:
        open(f,'w',encoding='utf-8').write(s2); tot+=n
        print(f.split('/')[-1],n)
print('total',tot)
