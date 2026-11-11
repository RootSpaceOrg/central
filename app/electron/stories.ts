/**
 * Histórias: uma tarefa-mãe (a entrega ponta a ponta que o Gustavo valida como usuário final) com subtarefas (as partes que
 * os agentes fazem). Subtarefa não passa pelo Gustavo: terminou bem, a Central faz o merge do PR em develop sozinha e a nota
 * de entrega fica só como registro. Quando todas chegam em develop, um agente usa o produto em dev como usuário, cria
 * subtarefas de conserto para o que achar quebrado e, com tudo funcionando, entrega UM roteiro de usuário para o Gustavo.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { moveTaskForRun } from './backlog';
import { all, get, now, run } from './db';

const execFileP = promisify(execFile);

/** execução que valida a história como usuário final (não é uma parte do trabalho) */
export const STORY_HEAD = '[história:teste]';
const MERGE_FAILED = 'Merge automático falhou';

export const parentOf = (taskId: number) => get<{ p: number | null }>('select parent_id p from tasks where id = ?', taskId)?.p ?? null;
export const isStory = (taskId: number) => !!get('select 1 from tasks where parent_id = ?', taskId);
/** subtarefas que ainda não chegaram em develop */
export const openChildren = (storyId: number) =>
  get<{ n: number }>(`select count(*) n from tasks where parent_id = ? and "column" not in ('dev','done')`, storyId)!.n;

/** Merge do PR de uma subtarefa (só em develop; nunca main/master). null = mergeado; texto = por que não deu. */
export async function ghMerge(pr: string): Promise<string | null> {
  try {
    const v = JSON.parse((await execFileP('gh', ['pr', 'view', pr, '--json', 'state,baseRefName'], { windowsHide: true, timeout: 60_000 })).stdout) as { state: string; baseRefName: string };
    if (v.state === 'MERGED') return null;
    if (v.state !== 'OPEN') return `o PR está ${v.state.toLowerCase()}`;
    if (/^(main|master)$/i.test(v.baseRefName)) return `o PR aponta para ${v.baseRefName}; subtarefa só entra em develop`;
    // ponytail: confia nas regras do repositório (checagens obrigatórias, conflito) para recusar; sem elas, entra como o agente entregou
    await execFileP('gh', ['pr', 'merge', pr, '--squash'], { windowsHide: true, timeout: 120_000 });
    return null;
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    return (err.stderr?.trim() || err.message || String(e)).split('\n')[0].slice(0, 300);
  }
}

/**
 * Fim da execução de uma subtarefa: falhou → A fazer; sem PR → Feito; com PR → merge em develop e Em dev/Feito. Merge que
 * não deu volta para o agente consertar uma vez; na segunda, fica na Revisão do Gustavo (o único caso em que ele vê a parte).
 */
export async function childFinished(runId: number, taskId: number, ok: boolean, pr: string | null, merge = ghMerge): Promise<void> {
  if (!ok) return moveTaskForRun(taskId, 'todo', pr);
  if (!pr) return moveTaskForRun(taskId, 'done');
  moveTaskForRun(taskId, 'review', pr);
  const err = await merge(pr);
  const prod = !!get(`select 1 from tasks t join projects p on p.slug = t.project_slug where t.id = ? and p.done_when = 'prod'`, taskId);
  if (!err) return moveTaskForRun(taskId, prod ? 'dev' : 'done');
  const body = get<{ b: string | null }>('select body b from tasks where id = ?', taskId)?.b ?? '';
  if (body.includes(MERGE_FAILED)) {
    run(`update deliveries set status = 'review', what = substr(what || ?, 1, 2000) where run_id = ?`, `\n\n${MERGE_FAILED} de novo: ${err}`, runId);
    return;
  }
  run('update tasks set body = ?, updated_at = ? where id = ?',
    `${body.trim()}\n\n${MERGE_FAILED} (${pr}): ${err}. Conserte o PR (conflito, checagem vermelha, base errada) e entregue de novo.`.trim(), now(), taskId);
  moveTaskForRun(taskId, 'todo');
}

/** histórias prontas para o teste de usuário: todas as subtarefas em develop e nenhum teste rodando ou recém-falho */
export function storiesToTest(since: string) {
  return all<{ id: number; title: string; body: string | null; project_slug: string; repo_path: string | null }>(
    `select t.id, t.title, t.body, t.project_slug, t.repo_path from tasks t
     where t.project_slug is not null and t."column" not in ('review','done')
       and exists (select 1 from tasks c where c.parent_id = t.id)
       and not exists (select 1 from tasks c where c.parent_id = t.id and c."column" not in ('dev','done'))
       and not exists (select 1 from runs r where r.task_id = t.id and (r.status in ('queued','preparing','running') or (r.status = 'failed' and r.finished_at > ?)))
       and not exists (select 1 from proposals p where p.task_id = t.id and p.status = 'proposed')
       -- já testou depois da última subtarefa mexer: não testa de novo em laço
       and not exists (select 1 from runs r where r.task_id = t.id and r.status = 'succeeded' and r.prompt like '${STORY_HEAD}%'
         and r.finished_at > (select max(c.updated_at) from tasks c where c.parent_id = t.id))
     order by t.priority, t.id`, since);
}

export function storyPrompt(s: { id: number; title: string; body: string | null }): string {
  const kids = all<{ id: number; title: string; how: string | null }>(
    `select c.id, c.title, (select d.how_to_test from deliveries d where d.task_id = c.id order by d.id desc limit 1) how
     from tasks c where c.parent_id = ? order by c.id`, s.id);
  // o que o Gustavo disse da última vez que testou ("Não funcionou")
  const said = get<{ n: string }>(`select review_note n from deliveries where task_id = ? and review_note is not null order by id desc limit 1`, s.id)?.n;
  return `${STORY_HEAD} Validar a história #${s.id} como o usuário final: ${s.title}
${s.body ? `\n${s.body}\n` : ''}${said ? `\nO Gustavo já testou e disse: "${said}". Confira primeiro que isso está resolvido.\n` : ''}
As partes desta história já foram feitas e mergeadas em develop, sem revisão humana:
${kids.map(k => `- #${k.id} ${k.title}${k.how ? `\n  como testar (do agente): ${k.how.replace(/\s+/g, ' ').slice(0, 300)}` : ''}`).join('\n')}

O Gustavo NÃO revisa as partes: ele só vai usar o produto como usuário final, seguindo o roteiro que você deixar. É você quem
garante que funciona. Não peça para ele olhar código, PR, log ou console.
1. Confira se tudo chegou no ambiente de dev (o deploy de develop terminou). Sem ambiente de dev publicado, suba local apontando
   para dev e deixe rodando para ele (diga a porta).
2. Use o produto como o usuário final faria, de ponta a ponta: o caminho principal e os 2 ou 3 desvios mais prováveis.
3. Achou algo quebrado, confuso ou faltando para a história fazer sentido para quem usa? Não conserte aqui: crie uma subtarefa
   por problema (create_task com parent_id ${s.id}, column todo; no body, o que fez, o que viu e o que esperava) e termine
   sem report_delivery. A Central faz as subtarefas e te chama de novo.
4. Tudo funcionando: report_delivery com
   - title: o que o usuário consegue fazer agora, em frase de usuário
   - what: o que mudou para quem usa, em 2 a 4 linhas (sem arquivos, PRs, componentes nem subtarefas)
   - how_to_test: roteiro de usuário em até 7 passos numerados: onde abrir (link completo), com qual conta ou perfil, o que
     fazer e o que deve ver em cada passo
   - risks: o que ainda não funciona ou ficou de fora, em linguagem de usuário
Precisa de algo que só o Gustavo tem (conta de teste, acesso)? need_gustavo.`;
}
