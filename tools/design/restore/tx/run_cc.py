exec(open('/tmp/claude-0/-home-user/ce00d8b4-5791-5ba6-9cf7-6313fce4e28c/scratchpad/restore/tx/replay.py').read())
import sys
A='agent-a4831a5716465fd88.jsonl'; B='agent-a87a83e3284ba33dd.jsonl'; M='/root/.claude/projects/-home-user/ce00d8b4-5791-5ba6-9cf7-6313fce4e28c.jsonl'
stage=sys.argv[1]
def fixout(fn):
    p=NEW+'/tg/'+fn; s=open(p).read(); s=s.replace(OLD+'/p0canvas',NEW+'/p0canvas'); open(p,'w').write(s)
if stage=='cc':
    write(A,163); write(A,245); fixout('plan_chartcol.py')
    for ln in (253,268,270): bash(A,ln)
    for ln in (263,266,273): bash(B,ln)
    bash(M,14154); bash(M,14160)
if stage=='cs':
    write(A,363); fixout('cat_shades.py')
    for ln in (369,373): bash(A,ln)
    for ln in (14015,14020,14036): bash(M,ln)
