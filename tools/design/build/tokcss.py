import json,re
t=json.load(open('/tmp/claude-0/-home-user/ce00d8b4-5791-5ba6-9cf7-6313fce4e28c/scratchpad/v12/project/tokens.json'))
def v(x): 
    m=re.fullmatch(r'\{(.+)\}',x); return f'var(--{m.group(1)})' if m else x
L=[];D=[]
for tk in t['color']['tokens']+t['shadow']['tokens']:
    val=tk['value']
    if isinstance(val,str): val={'light':val}
    L.append(f"--{tk['name']}:{v(val['light'])};")
    if 'dark' in val: D.append(f"--{tk['name']}:{v(val['dark'])};")
o=[]
for fam in ('spacing','radius','layout','zIndex','duration','easing','opacity'):
    o+= [f"--{x['name']}:{x['value']};" for x in t[fam]['tokens']]
fams=''.join(f'--font-{k}:{s};' for k,s in t['type']['families'].items())
css=':root,[data-theme="light"]{'+''.join(L)+'}[data-theme="dark"]{'+''.join(D)+'}:root{'+''.join(o)+fams+'}'
open('tokens.css','w').write(css)
