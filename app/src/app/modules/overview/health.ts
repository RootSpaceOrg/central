/**
 * Saúde de um projeto a partir do que a Central já sabe (commits, backlog, roadmap, rumo, triagem, execuções).
 * Puro de propósito: a Visão geral monta a entrada; o check em scripts/health.check.mjs cobre as regras.
 *
 * risco    = pede uma ação sua (pasta sumiu, execução não terminou, tarefa prioritária aberta)
 * atenção  = pendências: algo esperando ou envelhecendo (decisão, PR para revisar, tarefa parada, sem rumo/marco…)
 * parado   = projeto ativo sem commit nem agente há 30 dias
 * saudável = nada disso
 * Manutenção cobra menos (sem rumo/marco/ritmo); congelado só olha risco.
 */

export type Health = 'risco' | 'atencao' | 'parado' | 'ok';

export interface HealthTask { column: 'backlog' | 'todo' | 'doing' | 'review' | 'dev' | 'done'; priority: number; updatedAt: Date; title: string }

export interface HealthInput {
  status: string;
  folderExists: boolean;
  lastCommitAt: Date | null;
  dirtyRepos: number;
  openProposals: number;
  tasks: HealthTask[];
  newIdeas: number;
  failedRuns7d: number;
  activeRuns: number;
  /** marcos em Agora: quantos e quantos têm tarefas ligadas */
  nowMilestones: number;
  nowWithoutTasks: number;
  rumoAt: Date | null;
}

export interface Signal {
  level: 'risco' | 'atencao';
  text: string;
  /** para onde ir resolver */
  go: 'triagem' | 'backlog' | 'execucoes' | 'rumo' | 'roadmap' | 'projeto' | 'producao';
}

const DAY = 86_400_000;
const days = (from: Date, now: number) => Math.floor((now - from.getTime()) / DAY);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function health(i: HealthInput, now = Date.now()): { health: Health; signals: Signal[] } {
  const out: Signal[] = [];
  const risk = (text: string, go: Signal['go']) => out.push({ level: 'risco', text, go });
  const warn = (text: string, go: Signal['go']) => out.push({ level: 'atencao', text, go });
  const active = i.status === 'active', frozen = i.status === 'frozen';
  const open = i.tasks.filter(t => t.column !== 'done');

  if (!i.folderExists) risk('a pasta do projeto não existe mais', 'projeto');
  if (i.failedRuns7d) risk(`${plural(i.failedRuns7d, 'execução não terminou', 'execuções não terminaram')} nesta semana`, 'execucoes');
  const urgent = open.filter(t => t.priority === 0);
  if (urgent.length) risk(urgent.length === 1 ? `prioritária: ${urgent[0].title}` : `${urgent.length} tarefas prioritárias abertas`, 'backlog');

  if (!frozen) {
    if (i.openProposals) warn(`${plural(i.openProposals, 'decisão esperando', 'decisões esperando')} você`, 'triagem');
    const review = open.filter(t => t.column === 'review');
    if (review.length) warn(`${plural(review.length, 'tarefa', 'tarefas')} em revisão (PR para olhar)`, 'backlog');
    const stuck = open.filter(t => t.column === 'doing' && days(t.updatedAt, now) >= 7);
    if (stuck.length) warn(`${plural(stuck.length, 'tarefa parada', 'tarefas paradas')} em "fazendo" há 7+ dias`, 'backlog');
    const waitingProd = open.filter(t => t.column === 'dev' && days(t.updatedAt, now) >= 7);
    if (waitingProd.length) warn(`${plural(waitingProd.length, 'tarefa em dev', 'tarefas em dev')} há 7+ dias esperando produção`, 'producao');
    if (i.newIdeas >= 3) warn(`${i.newIdeas} ideias para triar`, 'triagem');
    if (i.dirtyRepos) warn(`${plural(i.dirtyRepos, 'repositório', 'repositórios')} com mudança sem commit`, 'projeto');
  }
  if (active) {
    if (!i.rumoAt) warn('sem rumo escrito', 'rumo');
    else if (days(i.rumoAt, now) > 45) warn(`rumo sem revisão há ${days(i.rumoAt, now)} dias`, 'rumo');
    if (!i.nowMilestones) warn('nada em Agora no roadmap', 'roadmap');
    else if (i.nowWithoutTasks) warn(`${plural(i.nowWithoutTasks, 'marco', 'marcos')} em Agora sem tarefas`, 'roadmap');
  }

  const quiet = active && !i.activeRuns && (!i.lastCommitAt || days(i.lastCommitAt, now) >= 30);
  const h: Health = out.some(s => s.level === 'risco') ? 'risco' : quiet ? 'parado' : out.length ? 'atencao' : 'ok';
  return { health: h, signals: out };
}

export const HEALTH: Record<Health, { label: string; color: string; order: number }> = {
  risco: { label: 'Pede ação', color: '#E8A36A', order: 0 },
  atencao: { label: 'Pendências', color: '#8FB4FF', order: 1 },
  parado: { label: 'Sem movimento', color: '#9aa3b5', order: 2 },
  ok: { label: 'Em dia', color: '#7ED69A', order: 3 },
};
