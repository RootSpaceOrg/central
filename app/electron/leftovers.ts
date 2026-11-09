/**
 * Processos que os agentes deixam rodando (ng serve, ng test, npm run dev…): a Central vigia a árvore de cada execução
 * enquanto ela roda, anota o que nasce lá e, quando ela termina, derruba testes/builds na hora; servidores ficam para o
 * Gustavo testar a entrega e caem quando ele aprova/descarta, ou depois de SERVER_TTL. Fica no banco: sobrevive a reinício.
 * O pid sozinho não basta (o Windows reaproveita): confere a hora de criação antes de matar.
 */
import { execFile } from 'node:child_process';
import { all, run } from './db';
import { killTree } from './proc';

const IS_WIN = process.platform === 'win32';
const SCAN_MS = 20_000;
const SERVER_TTL_MS = 2 * 3600_000;
/** servidor de dev: fica até a revisão (ou o TTL) */
const SERVER = /\b(serve|dev|start|preview|vite|webpack-dev-server|http-server|live-server|nodemon|next dev|ng s)\b/i;
/** o que não é nosso: o próprio Claude e servidores MCP que ele abre */
const IGNORE = /claude(\.exe)?["\s]|mcp|server\.mjs/i;

interface Proc { pid: number; ppid: number; start: string; cmd: string }
const watched = new Map<number, number>(); // pid raiz (claude da execução) → execução
let timer: ReturnType<typeof setInterval> | null = null;

function snapshot(): Promise<Proc[]> {
  return new Promise(resolve => {
    const done = (out: string) => resolve(out.split(/\r?\n/).map(l => {
      const [pid, ppid, start, ...cmd] = l.split('|');
      return { pid: Number(pid), ppid: Number(ppid), start: start ?? '', cmd: cmd.join('|') };
    }).filter(p => p.pid > 0));
    if (IS_WIN) {
      execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId)|$($_.ParentProcessId)|$($_.CreationDate.ToFileTimeUtc())|$($_.CommandLine)\" }"],
        { windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (_e, out) => done(String(out ?? '')));
    } else {
      execFile('ps', ['-A', '-o', 'pid=,ppid=,lstart=,command='], { maxBuffer: 32 * 1024 * 1024 }, (_e, out) => done(String(out ?? '').split('\n').map(l => {
        const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+(.*)$/);
        return m ? `${m[1]}|${m[2]}|${m[3]}|${m[4]}` : '';
      }).join('\n')));
    }
  });
}

/** anota o que nasceu nas árvores vigiadas (inclusive netos cujo pai já morreu, pelo que já foi anotado) */
async function scan(): Promise<Proc[]> {
  const ps = await snapshot();
  const kids = new Map<number, Proc[]>();
  for (const p of ps) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p]);
  for (const [root, runId] of watched) {
    const known = new Set(all<{ pid: number }>('select pid from run_procs where run_id = ?', runId).map(x => x.pid));
    const queue = [root, ...known];
    const seen = new Set<number>(queue);
    while (queue.length) {
      for (const c of kids.get(queue.shift()!) ?? []) {
        if (seen.has(c.pid)) continue;
        seen.add(c.pid);
        queue.push(c.pid);
        if (!known.has(c.pid) && c.cmd && !IGNORE.test(c.cmd) && /node|npm|npx|ng\.js|python|java|dotnet|chrome/i.test(c.cmd))
          run('insert into run_procs (run_id, pid, start, cmd, server) values (?,?,?,?,?)', runId, c.pid, c.start, c.cmd.slice(0, 400), SERVER.test(c.cmd) ? 1 : 0);
      }
    }
  }
  return ps;
}

function ensureTimer(): void {
  if (timer) return;
  timer = setInterval(() => { scan().catch(() => {}); reap().catch(() => {}); }, SCAN_MS);
}

/** começa a vigiar a execução (pid do claude dela) */
export function watchRun(runId: number, pid: number | undefined): void {
  if (!pid) return;
  watched.set(pid, runId);
  ensureTimer();
}

/** a execução terminou: última olhada; testes/builds caem já, servidores ganham prazo (ou caem na revisão) */
export async function runEnded(runId: number, pid: number | undefined): Promise<void> {
  try { await scan(); } catch { /* sem lista: fica para o próximo */ }
  if (pid) watched.delete(pid);
  run(`update run_procs set kill_after = case when server = 1 then ? else ? end where run_id = ? and kill_after is null`,
    new Date(Date.now() + SERVER_TTL_MS).toISOString(), new Date().toISOString(), runId);
  await reap();
}

/** entrega revisada (aprovada/descartada): os servidores dela já podem cair */
export function deliveryReviewed(runId: number): void {
  run('update run_procs set kill_after = ? where run_id = ?', new Date().toISOString(), runId);
  reap().catch(() => {});
}

/** mata o que venceu (conferindo a hora de criação) e esquece o que já morreu */
export async function reap(): Promise<number> {
  const due = all<{ id: number; pid: number; start: string }>(`select id, pid, start from run_procs where kill_after is not null and kill_after <= ?`, new Date().toISOString());
  if (!due.length) {
    if (!watched.size && timer && !all('select 1 from run_procs limit 1').length) { clearInterval(timer); timer = null; }
    return 0;
  }
  const alive = new Map((await snapshot()).map(p => [p.pid, p.start]));
  let n = 0;
  for (const d of due) {
    if (alive.get(d.pid) === d.start) { killTree(d.pid); n++; }
    run('delete from run_procs where id = ?', d.id);
  }
  return n;
}

/** ao abrir a Central: o que venceu enquanto ela estava fechada cai; o resto volta a ser vigiado pelo prazo */
export function startLeftovers(): void {
  setTimeout(() => { reap().catch(() => {}); }, 15_000);
  if (all('select 1 from run_procs limit 1').length) ensureTimer();
}
