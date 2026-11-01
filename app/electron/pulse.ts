/**
 * Piloto automático (a "inquietação"): de madrugada, cada projeto com o piloto ligado pega a tarefa do topo de
 * "A fazer" e um agente leva até um PR rascunho. De manhã tem trabalho pronto para revisar, não mais propostas.
 *
 * Travas: só tarefas que o Gustavo escreveu ou aprovou ("A fazer"); nada novo enquanto houver tarefa do projeto
 * em Fazendo/Revisão (um PR esperando revisão = nenhuma execução nova); só de madrugada; pula se a cota estiver alta.
 */
import type { PulseItemDto, PulseStatusDto } from '../src/app/shared/contract';
import { Emit, startRun } from './agents';
import { createProposal, getSetting, setSetting } from './backlog';
import { all, get, now, run } from './db';
import { SIZE_BUDGET } from './routines';
import { getUsage } from './usage';

/** janela da madrugada (hora local): não disputa a cota com as sessões do dia */
const NIGHT = { from: 1, to: 6 };
const MAX_SESSION = 60;
const MAX_WEEK = 85;

const today = () => new Date().toLocaleDateString('sv');

export function pulseStatus(): PulseStatusDto {
  const last = getSetting('pulse:last');
  return { last: last ? JSON.parse(last) : null, window: `${String(NIGHT.from).padStart(2, '0')}:00–${String(NIGHT.to).padStart(2, '0')}:00` };
}

/** O que o pulso faria (ou fez) num projeto. Separado para dar para testar sem disparar agente. */
export function plan(slug: string): Omit<PulseItemDto, 'run_id'> & { task?: { id: number; title: string; body: string | null; repo: string } } {
  const p = get<{ name: string }>('select name from projects where slug = ?', slug)!;
  const base = { slug, name: p.name };
  const waiting = get<{ title: string; column: string }>(
    `select title, "column" from tasks where project_slug = ? and "column" in ('doing','review') order by "column" = 'review' desc limit 1`, slug);
  if (waiting) return { ...base, action: 'waiting', text: `"${waiting.title}" ainda está em ${waiting.column === 'review' ? 'revisão' : 'andamento'}` };
  const task = get<{ id: number; title: string; body: string | null; repo_path: string | null }>(
    `select id, title, body, repo_path from tasks where project_slug = ? and "column" = 'todo' order by priority, position limit 1`, slug);
  if (!task) return { ...base, action: 'empty', text: 'Nada em "A fazer"' };
  const repos = all<{ path: string }>('select path from repos where project_slug = ?', slug);
  const repo = task.repo_path ?? (repos.length === 1 ? repos[0].path : null);
  if (!repo) return { ...base, action: 'blocked', text: `"${task.title}" não diz em qual repositório` };
  return { ...base, action: 'started', text: task.title, task: { id: task.id, title: task.title, body: task.body, repo } };
}

/** Uma passada em todos os projetos com piloto ligado. manual = botão "Rodar agora" (ignora a janela, não a cota). */
export async function runPulse(emit: Emit, manual: boolean): Promise<PulseStatusDto> {
  const slugs = all<{ slug: string }>(`select slug from projects where autopilot = 1 and status <> 'dead' order by name`).map(r => r.slug);
  const usage = (await getUsage(false)).limits;
  const session = usage.find(l => l.kind === 'session')?.percent ?? 0;
  const week = usage.find(l => l.kind === 'weekly_all')?.percent ?? 0;
  const items: PulseItemDto[] = [];
  for (const slug of slugs) {
    const step = plan(slug);
    if (step.action === 'started' && (session >= MAX_SESSION || week >= MAX_WEEK)) {
      items.push({ slug, name: step.name, action: 'quota', text: `Cota alta (sessão ${session}%, semana ${week}%)` });
      continue;
    }
    if (step.action === 'started' && step.task) {
      const t = step.task;
      // a pergunta "ficou sem tarefa" perdeu o sentido
      run(`update proposals set status = 'rejected', updated_at = ? where source = 'pulse' and project_slug = ? and status = 'proposed'`, now(), slug);
      const r = startRun({
        project_slug: slug, repo_path: t.repo, task_id: t.id, proposal_id: null, budget_usd: SIZE_BUDGET.medium, permission: 'edits',
        prompt: `${t.title}${t.body ? `\n\n${t.body}` : ''}\n\n(Piloto automático da Central, de madrugada: leve esta tarefa até um PR rascunho. `
          + 'Se faltar informação para decidir algo importante, pare e registre uma decisão para o Gustavo em vez de adivinhar.)',
      }, emit);
      items.push({ slug, name: step.name, action: 'started', text: t.title, run_id: r.id });
      continue;
    }
    // sem próximo passo: uma pergunta só (não repete enquanto a anterior estiver esperando)
    if (step.action === 'empty' && !get(`select 1 from proposals where source = 'pulse' and project_slug = ? and status = 'proposed'`, slug)) {
      createProposal({
        project_slug: slug, source: 'pulse', title: `O piloto automático do ${step.name} ficou sem tarefa`,
        body: 'Não há nada em "A fazer". Mova algo do backlog para lá, ou aprove esta decisão e converse com a Central para quebrar o próximo objetivo em tarefas.',
        next_action: 'Planejar as próximas tarefas com a Central',
      });
    }
    items.push({ slug, name: step.name, action: step.action, text: step.text });
  }
  const status = { at: now(), manual, items };
  setSetting('pulse:last', JSON.stringify(status));
  if (!manual) setSetting('pulse:date', today());
  emit.changed();
  return pulseStatus();
}

/** A cada 5 min: uma passada por noite, dentro da janela da madrugada. */
export function watchPulse(emit: Emit, onDone: (s: PulseStatusDto) => void): void {
  const tick = () => {
    const h = new Date().getHours();
    if (h < NIGHT.from || h >= NIGHT.to || getSetting('pulse:date') === today()) return;
    runPulse(emit, false).then(onDone).catch(e => console.error('pulso', e));
  };
  setTimeout(tick, 30_000);
  setInterval(tick, 5 * 60_000);
}
