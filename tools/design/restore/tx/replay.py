import json,re,sys,os,subprocess
SUB='/root/.claude/projects/-home-user/ce00d8b4-5791-5ba6-9cf7-6313fce4e28c/subagents/'
OLD='/tmp/claude-0/-home-user/ce00d8b4-5791-5ba6-9cf7-6313fce4e28c/scratchpad'
NEW=OLD+'/restore'
def get(f,line):
    L=open(f if f.startswith('/') else SUB+f).readlines(); d=json.loads(L[line-1])
    for b in d['message']['content']:
        if b.get('type')=='tool_use': return b['name'],b['input']
def write(f,line):
    n,i=get(f,line); assert n=='Write'
    p=i['file_path'].replace(OLD,NEW); open(p,'w').write(i['content']); print('wrote',p)
def edit(f,line):
    n,i=get(f,line); assert n=='Edit'
    p=i['file_path'].replace(OLD,NEW); s=open(p).read()
    assert s.count(i['old_string'])>=1,(line,'edit miss')
    s=s.replace(i['old_string'],i['new_string']) if i.get('replace_all') else s.replace(i['old_string'],i['new_string'],1)
    open(p,'w').write(s); print('edited',p,line)
def bash(f,line,transform=lambda c:c):
    n,i=get(f,line); assert n=='Bash'
    c=transform(i['command']).replace(OLD,NEW)
    r=subprocess.run(['bash','-c',c],capture_output=True,text=True,timeout=120)
    print('bash',line,'rc',r.returncode,(r.stdout[-400:]+r.stderr[-800:]).strip())
