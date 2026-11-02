/**
 * Rumo do projeto e o gestor do projeto.
 * - Rumo: "para onde vamos" (objetivo, foco do momento, o que não fazer). O Gustavo escreve; agentes podem ajustar, cada
 *   versão fica guardada com autor e motivo. Vai em todo prompt de agente do projeto.
 * - Gestor do projeto: sob demanda (botão, chat ou rotina), um agente lê rumo, ideias aprovadas, backlog, memória e
 *   código e organiza o backlog. Nada roda sozinho de madrugada sem pedido.
 */
import type { DirectionDto, RunDto } from '../src/app/shared/contract';
import { Emit, startRun } from './agents';
import { all, get, run } from './db';
import { SIZE_BUDGET } from './routines';

export const getDirection = (slug: string) =>
  get<DirectionDto>('select * from directions where project_slug = ? order by id desc limit 1', slug) ?? null;

export const directionHistory = (slug: string) =>
  all<DirectionDto>('select * from directions where project_slug = ? order by id desc limit 30', slug);

export function setDirection(slug: string, text: string, author: string, note: string | null): DirectionDto {
  if (!get('select 1 from projects where slug = ?', slug)) throw new Error('Projeto não encontrado.');
  const t = text.trim();
  if (!t) throw new Error('Escreva o rumo.');
  if (t.length > 6000) throw new Error('Rumo longo demais: resuma (até 6.000 caracteres).');
  if (getDirection(slug)?.text === t) return getDirection(slug)!;
  run('insert into directions (project_slug, text, author, note) values (?,?,?,?)', slug, t, author, note?.trim() || null);
  return getDirection(slug)!;
}

/** Bloco do rumo para os prompts dos agentes do projeto. */
export function directionBlock(slug: string): string {
  const d = getDirection(slug);
  const parent = get<{ parent_slug: string | null }>('select parent_slug from projects where slug = ?', slug)?.parent_slug;
  const g = parent ? getDirection(parent) : null;
  const pname = parent ? get<{ name: string }>('select name from projects where slug = ?', parent)?.name : null;
  return [
    g ? `## Rumo do grupo ${pname} (este projeto é uma frente dele)\n${g.text}` : '',
    d ? `## Rumo do projeto (o Gustavo define; siga-o)\n${d.text}` : '',
  ].filter(Boolean).join('\n\n');
}

const PLAN_MARK = '[gestor:planejar]';

/** Gestor do projeto: transforma rumo + ideias aprovadas no backlog. request = pedido extra do Gustavo. */
export function planBacklog(slug: string, request: string | null, emit: Emit): RunDto {
  const p = get<{ name: string }>('select name from projects where slug = ?', slug);
  if (!p) throw new Error('Projeto não encontrado.');
  if (get(`select 1 from runs where project_slug = ? and status in ('queued','preparing','running') and prompt like ?`, slug, `%${PLAN_MARK}%`)) {
    throw new Error('O gestor já está organizando este projeto.');
  }
  const d = getDirection(slug);
  const approved = all<{ id: number; title: string; body: string | null; tasks: number }>(
    `select i.id, i.title, i.body, (select count(*) from tasks t where t.idea_id = i.id) tasks from ideas i
     where i.project_slug = ? and i.status in ('approved','doing') order by i.approved_at`, slug);
  const repos = all<{ name: string; path: string }>('select name, path from repos where project_slug = ? order by name', slug);
  const prompt = `${PLAN_MARK} Você é o gestor do projeto "${p.name}" (slug ${slug}). O Gustavo pediu para organizar o backlog.
${request?.trim() ? `\nPedido dele agora: ${request.trim()}\n` : ''}
${d ? `Rumo atual (definido por ele):\n${d.text}` : 'O projeto ainda não tem rumo escrito: proponha um com update_direction (ele revisa) e planeje pelo que o código e o backlog mostram.'}

Ideias aprovadas (insumo para o backlog):
${approved.map(i => `- #${i.id} ${i.title}${i.tasks ? ` (já tem ${i.tasks} tarefa(s))` : ''}${i.body ? `: ${i.body.slice(0, 300)}` : ''}`).join('\n') || '- nenhuma'}

O que fazer, nesta ordem:
1. Leia o backlog do projeto (list_tasks), as ideias (list_ideas), a memória (memory_recall) e, se precisar, o código (code_map, code_search).
2. Para cada ideia aprovada sem tarefas: quebre em tarefas pequenas (cada uma cabe num PR) com create_task, passando idea_id,
   repo_path (caminho completo do repositório) e um corpo com o que fazer e como saber que terminou.
3. Reordene pelo rumo: o que avança o foco atual vai para "todo" (A fazer) com prioridade alta; o resto fica em "backlog".
   Tarefas que contrariam o rumo: não apague; mova para backlog e diga no resumo.
4. Se descobrir algo que precisa de decisão dele, crie uma decisão (create_decision). Ideia nova que vale guardar: create_idea.
5. Se o rumo estiver desatualizado pelo que você viu (algo já feito, foco mudou), proponha a nova versão com update_direction e diga o motivo.
Não execute tarefas nem altere código. Termine com um resumo curto: o que criou, o que reordenou e o que precisa dele.
Repositórios: ${repos.map(r => `${r.name} (${r.path})`).join(', ') || 'nenhum'}.`;
  return startRun({ project_slug: slug, repo_path: null, agent_id: null, proposal_id: null, budget_usd: SIZE_BUDGET.medium, permission: 'edits', prompt }, emit);
}
