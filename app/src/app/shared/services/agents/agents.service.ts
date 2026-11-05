import { Injectable, computed, inject, signal } from '@angular/core';

import { AgentDto, ProjectIconKind, RunPermission, AgentPriority } from '../../contract';
import { errorMessage } from '../ipc/ipc.service';
import { AvatarLook, parseLook } from '../../ui/avatar-look';
import { AgentsApiService } from './agents-api.service';

export interface Agent {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  color: string;
  iconKind: ProjectIconKind;
  iconValue: string | null;
  projectSlug: string | null;
  instructions: string;
  tools: string[];
  permission: RunPermission;
  /** fila e freio da cota */
  priority: AgentPriority;
  /** atuação restrita: atende gente de fora, sem comandos nem arquivos */
  restricted: boolean;
  model: string;
  /** sala no Escritório ('' = automática) */
  room: string;
  /** aparência do boneco 3D */
  look: AvatarLook;
  builtin: boolean;
  chats: number;
  routines: number;
  runs: number;
}

export type AgentDraft = Pick<Agent, 'name' | 'description' | 'color' | 'iconKind' | 'iconValue' | 'projectSlug' | 'instructions' | 'tools' | 'permission' | 'model' | 'room' | 'look' | 'priority' | 'restricted'>;

/** Ferramentas extras conhecidas, para sugerir no editor (o MCP precisa estar configurado no Claude Code). */
export const TOOL_SUGGESTIONS: { value: string; label: string }[] = [
  { value: 'mcp__central__whatsapp_send', label: 'Mandar WhatsApp (para agente restrito)' },
  { value: 'mcp__sentry', label: 'Sentry (erros de produção)' },
  { value: 'mcp__supabase', label: 'Supabase (banco)' },
  { value: 'mcp__stripe', label: 'Stripe (pagamentos)' },
  { value: 'mcp__claude_ai_linear-server', label: 'Linear' },
  { value: 'Bash(aws:*)', label: 'AWS CLI' },
  { value: 'Bash(npm:*)', label: 'npm' },
];

export const MODELS = [
  { value: '', label: 'Padrão' }, { value: 'opus', label: 'Opus' }, { value: 'sonnet', label: 'Sonnet' }, { value: 'haiku', label: 'Haiku' },
  { value: 'fable', label: 'Fable' },
];

/** Salas do Escritório (editor do agente); '' = deduzida pelo papel */
export const ROOM_CHOICES = [
  { id: '', label: 'Automática (pelo papel)' }, { id: 'gestao', label: 'Gestão' }, { id: 'eng', label: 'Engenharia' },
  { id: 'monitor', label: 'Monitoração' }, { id: 'creative', label: 'Estúdio criativo' }, { id: 'business', label: 'Negócios' },
];

/** Na conversa: apelido → nome com versão (o apelido pega sempre o modelo mais recente da família). */
export const CHAT_MODELS = [
  { value: '', label: 'Padrão', hint: 'do agente ou do plano' },
  { value: 'opus', label: 'Opus 5.5', hint: 'o mais capaz' },
  { value: 'sonnet', label: 'Sonnet 5.5', hint: 'equilíbrio' },
  { value: 'haiku', label: 'Haiku 5.5', hint: 'rápido e barato' },
  { value: 'fable', label: 'Fable 5.1', hint: '' },
];
export const EFFORTS = [
  { value: '', label: 'Padrão' }, { value: 'low', label: 'Baixo' }, { value: 'medium', label: 'Médio' },
  { value: 'high', label: 'Alto' }, { value: 'xhigh', label: 'Muito alto' }, { value: 'max', label: 'Máximo' },
];

const toModel = (d: AgentDto): Agent => ({
  id: d.id, slug: d.slug, name: d.name, description: d.description, color: d.color, iconKind: d.icon_kind, iconValue: d.icon_value,
  projectSlug: d.project_slug, instructions: d.instructions, tools: d.tools ? d.tools.split(',').filter(Boolean) : [],
  permission: d.permission, priority: d.priority ?? 'normal', restricted: !!d.restricted, model: d.model, room: d.room ?? '', look: parseLook(d.look), builtin: d.builtin, chats: d.chats, routines: d.routines, runs: d.runs,
});

/** Agentes definidos (Central, Suporte KultivAi, Marketing…). */
@Injectable({ providedIn: 'root' })
export class AgentsService {
  private readonly api = inject(AgentsApiService);

  readonly agents = signal<Agent[]>([]);
  readonly loaded = signal(false);
  readonly central = computed(() => this.agents().find(a => a.builtin) ?? null);
  readonly byId = computed(() => new Map(this.agents().map(a => [a.id, a])));

  constructor() {
    this.api.onChanged(() => this.load());
    this.load();
  }

  load(): void {
    this.api.list().then(list => { this.agents.set(list.map(toModel)); this.loaded.set(true); });
  }

  async save(id: number | null, d: AgentDraft): Promise<Agent> {
    const input = {
      name: d.name, description: d.description || null, color: d.color, icon_kind: d.iconKind, icon_value: d.iconValue,
      project_slug: d.projectSlug, instructions: d.instructions, tools: d.tools, permission: d.permission, priority: d.priority, restricted: d.restricted, model: d.model, room: d.room, look: JSON.stringify(d.look),
    };
    try {
      if (id) { await this.api.update(id, input); this.load(); return { ...this.byId().get(id)!, ...d }; }
      const created = toModel(await this.api.create(input));
      this.load();
      return created;
    } catch (e) {
      throw new Error(errorMessage(e));
    }
  }

  async remove(id: number): Promise<void> {
    try {
      await this.api.remove(id);
    } catch (e) {
      throw new Error(errorMessage(e));
    }
    this.load();
  }
}
