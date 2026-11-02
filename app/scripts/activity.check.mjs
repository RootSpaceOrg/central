// Self-check do rastreador de atividade (subagentes): `node scripts/activity.check.mjs`
// Formato real do stream-json do Claude Code (capturado): o subagente é um tool_use "Agent"; as mensagens dele trazem
// parent_tool_use_id; ele termina com um tool_result sem pai cujo tool_use_id é o da chamada.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(root, '.act-check-'));
await build({ entryPoints: [join(root, 'electron/activity.ts')], outfile: join(dir, 'a.js'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'error' });
const { ActivityTracker, phaseOf } = createRequire(import.meta.url)(join(dir, 'a.js'));
rmSync(dir, { recursive: true, force: true });

const ok = (c, m) => { if (!c) throw new Error(m); };
let last = null;
const done = [];
const t = new ActivityTracker((n, i) => `${n}:${i?.file_path ?? i?.command ?? ''}`, a => { last = a; }, txt => done.push(txt));
const as = (parent, content) => ({ type: 'assistant', parent_tool_use_id: parent, message: { content } });
const res = (parent, id) => ({ type: 'user', parent_tool_use_id: parent, message: { content: [{ type: 'tool_result', tool_use_id: id }] } });

t.handle(as(null, [{ type: 'tool_use', id: 'A', name: 'Agent', input: { description: 'Contar a.txt', subagent_type: 'general-purpose' } }]));
t.handle(as(null, [{ type: 'tool_use', id: 'B', name: 'Agent', input: { description: 'Contar b.txt', subagent_type: 'Explore' } }]));
t.handle(as('A', [{ type: 'tool_use', id: 'x1', name: 'Read', input: { file_path: 'a.txt' } }]));
t.handle(res('A', 'x1'));                       // resultado interno do subagente: não termina ele
t.handle(as('B', [{ type: 'tool_use', id: 'x2', name: 'Bash', input: { command: 'wc -l b.txt' } }]));
await new Promise(r => setTimeout(r, 350));
ok(last.subagents.length === 2, 'dois subagentes');
ok(last.subagents[0].step === 'Read:a.txt' && last.subagents[0].steps === 1 && !last.subagents[0].finished_at, `passo do A: ${JSON.stringify(last.subagents[0])}`);
ok(last.subagents[1].type === 'Explore' && last.subagents[1].step === 'Bash:wc -l b.txt', 'passo do B');
ok(last.step === null, 'passos dos subagentes não viram passo da sessão');
ok(t.isSubagentStep(as('A', [])) && !t.isSubagentStep(as(null, [])), 'reconhece passo de subagente');
t.handle(res(null, 'A'));
await new Promise(r => setTimeout(r, 350));
ok(last.subagents[0].finished_at && !last.subagents[1].finished_at, 'A terminou, B segue');
ok(done.length === 1 && done[0].includes('Contar a.txt') && done[0].includes('1 passo'), `resumo: ${done}`);
t.handle(as(null, [{ type: 'text', text: 'pronto' }]));
await new Promise(r => setTimeout(r, 350));
ok(last.step === 'Escrevendo a resposta', 'texto da sessão principal');
// plano declarado (formato real: TaskCreate numera 1, 2, 3…; TaskUpdate muda o status) e TodoWrite antigo
t.handle(as(null, [{ type: 'tool_use', id: 'p1', name: 'TaskCreate', input: { subject: 'Ler a.txt', activeForm: 'Lendo a.txt' } }]));
t.handle(as(null, [{ type: 'tool_use', id: 'p2', name: 'TaskCreate', input: { subject: 'Responder', activeForm: 'Respondendo' } }]));
t.handle(as(null, [{ type: 'tool_use', id: 'p3', name: 'TaskUpdate', input: { taskId: '1', status: 'completed' } }]));
t.handle(as(null, [{ type: 'tool_use', id: 'p4', name: 'TaskUpdate', input: { taskId: '2', status: 'in_progress' } }]));
t.handle(as('A', [{ type: 'tool_use', id: 'p5', name: 'TaskCreate', input: { subject: 'do subagente' } }]));
await new Promise(r => setTimeout(r, 350));
ok(last.plan.map(p => `${p.id}:${p.status}`).join() === '1:completed,2:in_progress', `plano: ${JSON.stringify(last.plan)}`);
ok(last.plan[1].active === 'Respondendo', 'o que está fazendo agora');
ok(last.step === 'Escrevendo a resposta', 'ferramentas de plano não viram passo');
t.handle(as(null, [{ type: 'tool_use', id: 'p6', name: 'TodoWrite', input: { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }] } }]));
await new Promise(r => setTimeout(r, 350));
ok(last.plan.length === 2 && last.plan[0].status === 'completed', 'TodoWrite antigo');
t.stop();
console.log('ok');

// fase deduzida da ferramenta e status declarado (set_status)
ok(phaseOf('Edit', {}) === 'construindo', 'Edit = construindo');
ok(phaseOf('Read', {}) === 'investigando', 'Read = investigando');
ok(phaseOf('Bash', { command: 'npx vitest run' }) === 'testando', 'vitest = testando');
ok(phaseOf('Bash', { command: 'git commit -m x' }) === 'entregando', 'commit = entregando');
ok(phaseOf('Bash', { command: 'git diff' }) === 'revisando', 'diff = revisando');
ok(phaseOf('TaskCreate', {}) === 'planejando', 'plano = planejando');
ok(phaseOf('Agent', {}) === 'delegando', 'subagente = delegando');
ok(phaseOf('mcp__central__code_search', {}) === 'investigando', 'busca no código = investigando');
ok(phaseOf('Whatever', {}) === null, 'desconhecida não muda a fase');
{
  let a = null;
  const t2 = new ActivityTracker(n => n, x => { a = x; }, () => {});
  t2.handle(as(null, [{ type: 'tool_use', id: 'e1', name: 'Edit', input: {} }]));
  ok(t2.activity.phase === 'construindo', 'tracker guarda a fase');
  t2.declare('testando', '  suíte do roadmap  ', { id: 12, title: 'Exportar roadmap' });
  ok(t2.activity.status.doing === 'suíte do roadmap' && t2.activity.status.task_id === 12 && t2.activity.status.task_title === 'Exportar roadmap', 'status declarado');
  ok(t2.activity.phase === 'testando', 'declarar muda a fase');
  t2.stop(); void a;
}
console.log('fases ok');
