import json,re,glob
SUB='/root/.claude/projects/-home-user/ce00d8b4-5791-5ba6-9cf7-6313fce4e28c/subagents/'
files=[SUB+'agent-'+x+'.jsonl' for x in 'a4831a5716465fd88 ad17638bc704fd3b9 a6960e74c595fadc2 a87a83e3284ba33dd ad29740191f561765 a09457578abad45c1 ad705cad7a71831fd a18c63be6ea1d8518'.split()]+['/root/.claude/projects/-home-user/ce00d8b4-5791-5ba6-9cf7-6313fce4e28c.jsonl']
T=re.compile(r'(cat_shades|plan_chartcol|chartcol|plan_goalcolors)\.py')
MOD=re.compile(r"p='(tg/)?(cat_shades|plan_chartcol|chartcol|plan_goalcolors)\.py'|sed -i[^;&|]*(cat_shades|plan_chartcol|chartcol|plan_goalcolors)\.py|>>? ?\S*(cat_shades|plan_chartcol|chartcol|plan_goalcolors)\.py|cp [^;&]*(cat_shades|chartcol|plan_chartcol)\.py\b|open\(p,'w'\)")
ops=[]
for f in files:
    for i,l in enumerate(open(f,encoding='utf8',errors='ignore'),1):
        if not T.search(l): continue
        d=json.loads(l); c=d.get('message',{}).get('content')
        if not isinstance(c,list): continue
        for b in c:
            if b.get('type')!='tool_use' or b['name'] not in ('Bash','Write','Edit'): continue
            inp=b['input']; s=inp.get('command','') if b['name']=='Bash' else inp.get('file_path','')
            if b['name']=='Bash':
                if not (T.search(s) and MOD.search(s)): continue
                # need the modifying target to be one of ours
                if not re.search(r"p='(tg/)?(cat_shades|plan_chartcol|chartcol|plan_goalcolors)\.py'|sed -i[^;&|]*(cat_shades|plan_chartcol|chartcol|plan_goalcolors)\.py|>> ?\S*(cat_shades|chartcol|plan_chartcol)\.py|cp [^;&]*\b(cat_shades|chartcol|plan_chartcol)\.py",s): continue
            elif not T.search(s): continue
            ops.append((d.get('timestamp',''),f.split('/')[-1][:14],i,b['name'],s[:160].replace('\n',' ')))
for o in sorted(ops): print(*o)
