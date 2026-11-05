/**
 * Atividade ao vivo de uma sessão do Claude (conversa ou execução), lida do stream-json: desde quando está trabalhando,
 * o passo atual e os subagentes (ferramenta Agent/Task) com o que cada um faz e há quanto tempo.
 * Formato confirmado: o subagente é um tool_use "Agent"; as mensagens dele trazem parent_tool_use_id = id dessa chamada;
 * ele termina quando chega o tool_result com esse id (sem pai).
 */
import type { ActivityDto, Phase, SubagentDto } from '../src/app/shared/contract';

const SUBAGENT = new Set(['Agent', 'Task']);
const INTERNAL = new Set(['ToolSearch']);
/** ferramentas do plano: viram a lista "para onde está indo", não passos */
const PLAN = new Set(['TaskCreate', 'TaskUpdate', 'TodoWrite', 'TaskList', 'TaskGet']);

/** Fase pela ferramenta usada (quando o agente não declarou): editar = construindo, ler = investigando, testes = testando… */
export function phaseOf(name: string, input: any): Phase | null {
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) return 'construindo';
  if (/^(Read|Grep|Glob|LS|WebFetch|WebSearch)$/.test(name) || /^mcp__central__(code_|memory_|get_|list_)/.test(name)) return 'investigando';
  if (PLAN.has(name) || /^mcp__central__(create_task|update_task|plan_backlog|create_milestone|update_milestone|create_idea)/.test(name)) return 'planejando';
  if (SUBAGENT.has(name)) return 'delegando';
  if (name === 'Bash') {
    const cmd = String(input?.command ?? '');
    if (/\b(git (commit|push)|gh pr (create|merge))\b/.test(cmd)) return 'entregando';
    if (/\b(test|vitest|jest|pytest|tsc|lint|eslint|\.check\.mjs|npm run (check|build)|ng build|dotnet test)\b/.test(cmd)) return 'testando';
    if (/\bgit (diff|log|status|show)\b/.test(cmd)) return 'revisando';
    return 'construindo';
  }
  return null;
}

const secs = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}min${Math.round((ms % 60_000) / 1000)}s`);

export class ActivityTracker {
  readonly activity: ActivityDto = { started_at: new Date().toISOString(), step: null, subagents: [], plan: [], phase: null, status: null };
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * describe: rótulo amigável de uma ferramenta; onChange: avisa a tela (no máximo a cada 300 ms);
   * onSubagentDone: guarda no histórico ("Subagente X terminou em 1min20s").
   */
  constructor(
    private readonly describe: (name: string, input: unknown) => string,
    private readonly onChange: (a: ActivityDto) => void,
    private readonly onSubagentDone: (text: string) => void,
  ) {
    onChange(this.activity);
  }

  /** É passo de subagente? (o histórico mostra recuado) */
  isSubagentStep(msg: any): boolean { return !!msg.parent_tool_use_id; }

  /**
   * Subagente em segundo plano (run_in_background): a chamada volta na hora ("lançado, agentId X"), mas ele segue
   * trabalhando. Só termina quando chega o aviso de conclusão dele (task-notification com o id) ou se ficar 3 min sem
   * dar passo nenhum.
   */
  private readonly background = new Map<string, { agentId: string | null; lastStep: number }>();

  private finish(sub: ActivityDto['subagents'][number]): void {
    sub.finished_at = new Date().toISOString();
    sub.step = null;
    this.background.delete(sub.id);
    const ms = Date.parse(sub.finished_at) - Date.parse(sub.started_at);
    this.onSubagentDone(`Subagente "${sub.description}" (${sub.type}) terminou em ${secs(ms)}, ${sub.steps} passo${sub.steps === 1 ? '' : 's'}`);
  }

  handle(msg: any): void {
    const parent: string | null = msg.parent_tool_use_id ?? null;
    let changed = false;
    // aviso de conclusão de um subagente em segundo plano (vem como texto com o id dele)
    if (this.background.size) {
      const raw = JSON.stringify(msg);
      if (raw.includes('task-notification') || raw.includes('task_notification')) {
        for (const [id, bg] of this.background) {
          if (!bg.agentId || !raw.includes(bg.agentId)) continue;
          const sub = this.activity.subagents.find(s => s.id === id && !s.finished_at);
          if (sub) { this.finish(sub); changed = true; }
        }
      }
      // ficou 3 min sem passo: conta como terminado (não fica "trabalhando" para sempre)
      for (const [id, bg] of this.background) {
        if (Date.now() - bg.lastStep < 180_000) continue;
        const sub = this.activity.subagents.find(s => s.id === id && !s.finished_at);
        if (sub) { this.finish(sub); changed = true; } else this.background.delete(id);
      }
    }
    if (msg.type === 'assistant') {
      for (const b of msg.message?.content ?? []) {
        if (b.type !== 'tool_use' || INTERNAL.has(b.name)) continue;
        if (!parent) { const ph = phaseOf(b.name, b.input); if (ph && ph !== this.activity.phase) { this.activity.phase = ph; changed = true; } }
        if (PLAN.has(b.name)) { if (!parent && this.plan(b.name, b.input)) changed = true; continue; }
        const sub = parent ? this.activity.subagents.find(s => s.id === parent) : null;
        if (sub) {
          // passo de quem já tinha sido dado como terminado: está trabalhando (segundo plano)
          if (sub.finished_at) { sub.finished_at = null; if (!this.background.has(sub.id)) this.background.set(sub.id, { agentId: null, lastStep: Date.now() }); }
          const bg = this.background.get(sub.id);
          if (bg) bg.lastStep = Date.now();
          sub.step = this.describe(b.name, b.input); sub.steps++; changed = true;
        }
        else if (!parent && SUBAGENT.has(b.name)) {
          this.activity.subagents.push({
            id: b.id, type: b.input?.subagent_type ?? 'subagente', description: b.input?.description ?? 'Subagente',
            started_at: new Date().toISOString(), finished_at: null, step: null, steps: 0,
          });
          if (b.input?.run_in_background) this.background.set(b.id, { agentId: null, lastStep: Date.now() });
          changed = true;
        } else if (!parent) { this.activity.step = this.describe(b.name, b.input); changed = true; }
      }
      if (!parent && (msg.message?.content ?? []).some((b: any) => b.type === 'text')) { this.activity.step = 'Escrevendo a resposta'; this.activity.phase = 'escrevendo'; changed = true; }
    } else if (msg.type === 'user' && !parent) {
      for (const b of msg.message?.content ?? []) {
        if (b.type !== 'tool_result') continue;
        const sub = this.activity.subagents.find(s => s.id === b.tool_use_id && !s.finished_at);
        if (!sub) continue;
        // segundo plano: a resposta é só "lançado"; guarda o id dele para reconhecer o aviso de conclusão
        const bg = this.background.get(sub.id);
        const text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '');
        if (bg || /async agent launched|running in the background|agentId:/i.test(text)) {
          this.background.set(sub.id, { agentId: /agentId:\s*([\w-]+)/.exec(text)?.[1] ?? bg?.agentId ?? null, lastStep: Date.now() });
          continue;
        }
        this.finish(sub);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  /**
   * Plano da sessão principal. TaskCreate não traz o id (vem no resultado): o Claude Code numera 1, 2, 3… na ordem.
   * TodoWrite (versões antigas) manda a lista inteira de uma vez.
   */
  private plan(name: string, input: any): boolean {
    const plan = this.activity.plan;
    if (name === 'TaskCreate') {
      plan.push({ id: String(plan.length + 1), title: String(input?.subject ?? input?.description ?? 'Tarefa'), active: input?.activeForm ?? null, status: 'pending' });
      return true;
    }
    if (name === 'TaskUpdate') {
      const item = plan.find(p => p.id === String(input?.taskId));
      if (!item) return false;
      if (['pending', 'in_progress', 'completed'].includes(input?.status)) item.status = input.status;
      if (input?.status === 'deleted') plan.splice(plan.indexOf(item), 1);
      if (input?.subject) item.title = String(input.subject);
      if (input?.activeForm) item.active = String(input.activeForm);
      return true;
    }
    if (name === 'TodoWrite' && Array.isArray(input?.todos)) {
      this.activity.plan = input.todos.map((t: any, i: number) => ({ id: String(i + 1), title: String(t.content ?? ''), active: t.activeForm ?? null,
        status: ['pending', 'in_progress', 'completed'].includes(t.status) ? t.status : 'pending' }));
      return true;
    }
    return false;
  }

  /** O agente disse o que está fazendo (set_status). */
  declare(phase: Phase, doing: string, task: { id: number; title: string } | null): void {
    this.activity.status = { phase, doing: doing.trim().slice(0, 140), task_id: task?.id ?? null, task_title: task?.title ?? null, at: new Date().toISOString() };
    this.activity.phase = phase;
    this.emit();
  }

  private emit(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.onChange(this.activity); }, 300);
  }

  /** Fim da sessão: para o aviso pendente. */
  stop(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }
}

export type { SubagentDto };

type Scope = 'chat' | 'run';
const live = new Map<string, ActivityDto & { scope: Scope; ref: number }>();
const trackers = new Map<string, ActivityTracker>();
let notify: (scope: Scope, ref: number, a: ActivityDto | null) => void = () => {};

/** O main liga o aviso para a tela. */
export function onActivity(fn: typeof notify): void { notify = fn; }

/** Tudo que está rodando agora (para a tela montar o estado ao abrir). */
export const listActivity = () => [...live.values()];

/** Começa a acompanhar uma conversa ou execução. */
export function track(scope: Scope, ref: number, describe: (name: string, input: unknown) => string, onSubagentDone: (text: string) => void): ActivityTracker {
  const t = new ActivityTracker(describe, a => {
    live.set(`${scope}:${ref}`, { ...a, scope, ref, subagents: a.subagents.map(s => ({ ...s })), plan: a.plan.map(p => ({ ...p })), status: a.status ? { ...a.status } : null });
    notify(scope, ref, live.get(`${scope}:${ref}`)!);
  }, onSubagentDone);
  trackers.set(`${scope}:${ref}`, t);
  return t;
}

/** O plano e a etapa atual de uma sessão (vai para o registro de construção da execução). */
export const snapshot = (scope: Scope, ref: number) => live.get(`${scope}:${ref}`) ?? null;

/** set_status do MCP: false se a sessão não está rodando. */
export function setStatus(scope: Scope, ref: number, phase: Phase, doing: string, task: { id: number; title: string } | null): boolean {
  const t = trackers.get(`${scope}:${ref}`);
  if (!t) return false;
  t.declare(phase, doing, task);
  return true;
}

export function untrack(scope: Scope, ref: number, t: ActivityTracker | null): void {
  t?.stop();
  trackers.delete(`${scope}:${ref}`);
  live.delete(`${scope}:${ref}`);
  notify(scope, ref, null);
}
