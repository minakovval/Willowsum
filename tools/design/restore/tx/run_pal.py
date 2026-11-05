exec(open('/tmp/claude-0/-home-user/ce00d8b4-5791-5ba6-9cf7-6313fce4e28c/scratchpad/restore/tx/replay.py').read())
A='agent-a316ebfbfe55330a2.jsonl'
write(A,467)
write(A,498)
for ln in (510,529,566):
    bash(A,ln)
bash(A,589,lambda c:c.replace('kill 28702 2>/dev/null; ',''))
bash(A,596); bash(A,599)
