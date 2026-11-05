import re,glob,sys,collections
D=sys.argv[1]
C=collections.Counter(); ex={}
for f in sorted(glob.glob(D+'/Poc*.dc.html')):
    s=open(f,encoding='utf-8').read()
    for m in re.finditer('[€₴]',s):
        ctx=s[max(0,m.start()-12):m.end()+14]
        key=re.sub(r'\d','9',ctx)
        key=key.replace(' ','⍽').replace(' ','⌴')
        # classify following
        after=s[m.end():m.end()+3]; before=s[max(0,m.start()-2):m.start()]
        cls=('NUMAFTER' if re.match(r'[\s  ]?\d',after) else 'NUMBEFORE' if re.search(r'\d[\s  ]?$',before) else 'OTHER')
        C[cls]+=1
        if cls!='NUMBEFORE': ex.setdefault(cls,[]).append((f.split('/')[-1],ctx.replace('\n',' ')))
print(C)
for k,v in ex.items():
    print('==',k,len(v))
    seen=set()
    for fn,c in v:
        kk=re.sub(r'\d','9',c)
        if kk in seen: continue
        seen.add(kk); print(fn,'|',repr(c))
