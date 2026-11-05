import json,re,sys
def load(f):
    d={}
    for l in open(f):
        m=re.match(r'(\S+) (\{.*\}) ?(.*)$',l.rstrip('\n'))
        if m: d[m.group(1)]=json.loads(m.group(2)); d[m.group(1)]['err']=m.group(3)
    return d
a=load(sys.argv[1]); b=load(sys.argv[2])
norm=lambda x: re.sub(r'[\d\s€₴$ ,.·−+]','',x)
for k in b:
    if k not in a: print('nobase',k,b[k]); continue
    oa=set(map(norm,a[k]['over'])); ob=set(map(norm,b[k]['over']))
    if ob-oa or a[k]['h']!=b[k]['h'] or b[k]['w']!=a[k]['w'] or b[k]['holes'] or b[k]['err'].strip():
        print(k,'h',a[k]['h'],b[k]['h'],'w',b[k]['w'],'new clip:',list(ob-oa)[:4],b[k]['holes'],b[k]['err'][:100])
print('compared',len(b))
