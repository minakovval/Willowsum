# Own ports, databases and processes

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-16

Shared by several skills (owner, 2026-11-13: rare parts moved out of the skills). Read when you start a dev server, the API, a test database or any background process.

**Own ports, databases and processes** (owner, 2026-11-13): several agents run at once (limit: `pr-pipeline` §3), so the lead gives you
a slot `k` (1–10; none given → ask, or use 4). Use only your slot: the web dev server
`pnpm --filter @willowsum/web exec vite --port 517k --strictPort` (5171–5179; preview `--port 417k`; slot 10: web 5180, preview 4180 — lead decision, not approved by the owner, 2026-11-16, #331), the API with
`WS_PORT=808k` (8081–8089; slot 10: 8090), and `WS_API_ORIGIN=http://localhost:808k` for the web proxy. Test databases only through
`pnpm db:test` from your own worktree: their names carry your branch (`ws_t_<branch>_<random>`; `HEAD` in a
detached worktree, shared with other reviewers); record the names it prints and drop only those. Start a server in the background and record its PID (`echo $! >> <scratchpad>/pr<n>-<role>/pids`); stop only
your own PIDs (`kill $(cat <scratchpad>/pr<n>-<role>/pids)`), never `pkill`, `killall`, a kill by port or process
name, or `pnpm local:down` (it stops the shared environment). `pnpm test:e2e` picks free ports by itself.
