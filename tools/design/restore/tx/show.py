import json,sys
f=sys.argv[1]; f=f if f.startswith('/') else '/root/.claude/projects/-home-user/ce00d8b4-5791-5ba6-9cf7-6313fce4e28c/subagents/'+f
want=set(int(x) for x in sys.argv[2:])
for i,l in enumerate(open(f,encoding='utf8',errors='ignore'),1):
    if i not in want: continue
    d=json.loads(l)
    if 'message' not in d or not isinstance(d['message'].get('content'),list): continue
    for b in d['message']['content']:
        if b.get('type')=='tool_use': print(f'##### {i} {b["name"]}'); print(b['input'].get('command') or json.dumps(b['input'],ensure_ascii=False)[:3000])
        if b.get('type')=='tool_result':
            cc=b.get('content'); cc='\n'.join(y.get('text','') for y in cc if isinstance(y,dict)) if isinstance(cc,list) else cc
            print(f'##### {i} RESULT'); print(str(cc)[:1500])
