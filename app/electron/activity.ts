/**
 * Atividade ao vivo de uma sessão do Claude (conversa ou execução), lida do stream-json: desde quando está trabalhando,
 * o passo atual e os subagentes (ferramenta Agent/Task) com o que cada um faz e há quanto tempo.
 * Formato confirmado: o subagente é um tool_use "Agent"; as mensagens dele trazem parent_tool_use_id = id dessa chamada;
 * ele termina quando chega o tool_result com esse id (sem pai).
 */
import type { ActivityDto, SubagentDto } from '../src/app/shared/contract';

const SUBAGENT = new Set(['Agent', 'Task']);
const INTERNAL = new Set(['ToolSearch']);
/** ferramentas do plano: viram a lista "para onde está indo", não passos */
const PLAN = new Set(['TaskCreate', 'TaskUpdate', 'TodoWrite', 'TaskList', 'TaskGet']);

const secs = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}min${Math.round((ms % 60_000) / 1000)}s`);

export class ActivityTracker {
  readonly activity: ActivityDto = { started_at: new Date().toISOString(), step: null, subagents: [], plan: [] };
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

  handle(msg: any): void {
    const parent: string | null = msg.parent_tool_use_id ?? null;
    let changed = false;
    if (msg.type === 'assistant') {
      for (const b of msg.message?.content ?? []) {
        if (b.type !== 'tool_use' || INTERNAL.has(b.name)) continue;
        if (PLAN.has(b.name)) { if (!parent && this.plan(b.name, b.input)) changed = true; continue; }
        const sub = parent ? this.activity.subagents.find(s => s.id === parent) : null;
        if (sub) { sub.step = this.describe(b.name, b.input); sub.steps++; changed = true; }
        else if (!parent && SUBAGENT.has(b.name)) {
          this.activity.subagents.push({
            id: b.id, type: b.input?.subagent_type ?? 'subagente', description: b.input?.description ?? 'Subagente',
            started_at: new Date().toISOString(), finished_at: null, step: null, steps: 0,
          });
          changed = true;
        } else if (!parent) { this.activity.step = this.describe(b.name, b.input); changed = true; }
      }
      if (!parent && (msg.message?.content ?? []).some((b: any) => b.type === 'text')) { this.activity.step = 'Escrevendo a resposta'; changed = true; }
    } else if (msg.type === 'user' && !parent) {
      for (const b of msg.message?.content ?? []) {
        if (b.type !== 'tool_result') continue;
        const sub = this.activity.subagents.find(s => s.id === b.tool_use_id && !s.finished_at);
        if (!sub) continue;
        sub.finished_at = new Date().toISOString();
        sub.step = null;
        changed = true;
        const ms = Date.parse(sub.finished_at) - Date.parse(sub.started_at);
        this.onSubagentDone(`Subagente "${sub.description}" (${sub.type}) terminou em ${secs(ms)}, ${sub.steps} passo${sub.steps === 1 ? '' : 's'}`);
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
let notify: (scope: Scope, ref: number, a: ActivityDto | null) => void = () => {};

/** O main liga o aviso para a tela. */
export function onActivity(fn: typeof notify): void { notify = fn; }

/** Tudo que está rodando agora (para a tela montar o estado ao abrir). */
export const listActivity = () => [...live.values()];

/** Começa a acompanhar uma conversa ou execução. */
export function track(scope: Scope, ref: number, describe: (name: string, input: unknown) => string, onSubagentDone: (text: string) => void): ActivityTracker {
  return new ActivityTracker(describe, a => { live.set(`${scope}:${ref}`, { ...a, scope, ref, subagents: a.subagents.map(s => ({ ...s })), plan: a.plan.map(p => ({ ...p })) }); notify(scope, ref, live.get(`${scope}:${ref}`)!); },
    onSubagentDone);
}

export function untrack(scope: Scope, ref: number, t: ActivityTracker | null): void {
  t?.stop();
  live.delete(`${scope}:${ref}`);
  notify(scope, ref, null);
}
