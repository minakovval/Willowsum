import json,sys
f,a,b=sys.argv[1],int(sys.argv[2]),int(sys.argv[3])
L=open(f).readlines()
for i in range(a-1,min(b,len(L))):
    d=json.loads(L[i]); m=d.get('message',{}); c=m.get('content')
    if isinstance(c,str): print(f'--- {i+1} {m.get("role")} TEXT\n{c[:3000]}'); continue
    if not isinstance(c,list): continue
    for x in c:
        t=x.get('type')
        if t=='text': print(f'--- {i+1} text\n{x["text"][:3000]}')
        elif t=='tool_use': print(f'--- {i+1} TOOL_USE {x["name"]}\n'+json.dumps(x['input'],ensure_ascii=False,indent=0)[:int(sys.argv[4]) if len(sys.argv)>4 else 20000])
        elif t=='tool_result':
            cc=x.get('content'); 
            if isinstance(cc,list): cc='\n'.join(y.get('text','') for y in cc if isinstance(y,dict))
            print(f'--- {i+1} RESULT\n{str(cc)[:int(sys.argv[5]) if len(sys.argv)>5 else 1500]}')
