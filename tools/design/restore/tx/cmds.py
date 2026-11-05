import json,sys,re
f=sys.argv[1]; pat=re.compile(sys.argv[2]); lo=int(sys.argv[3]) if len(sys.argv)>3 else 0
for i,l in enumerate(open(f),1):
    if i<lo: continue
    d=json.loads(l); c=d.get('message',{}).get('content')
    if isinstance(c,list):
        for b in c:
            if b.get('type')=='tool_use':
                inp=b['input']; s=inp.get('command') or inp.get('content') or json.dumps(inp,ensure_ascii=False)
                if pat.search(json.dumps(inp,ensure_ascii=False)) and b['name'] in ('Bash','Write','Edit'):
                    print(f'##### {i} {b["name"]} {inp.get("file_path","")}'); 
                    if b['name']=='Edit': print('OLD:',inp['old_string']); print('NEW:',inp['new_string'])
                    elif b['name']=='Bash': print(s)
                    else: print('[write len',len(s),']')
