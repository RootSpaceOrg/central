import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';

import { ChatView } from '../../../../shared/components/chat-view/chat-view';
import { AgentsService } from '../../../../shared/services/agents/agents.service';
import { AskService } from '../../../../shared/services/ask/ask.service';
import { ChatService } from '../../../../shared/services/chat/chat.service';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { RecorderService } from '../../../../shared/services/recorder/recorder.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { Check } from '../../../../shared/ui/check';
import { Icon } from '../../../../shared/ui/icon';
import { Select, SelectOption } from '../../../../shared/ui/select';
import { VideoPlayer } from '../../../../shared/ui/video-player';
import { Meeting, MeetingsService } from '../../services/meetings/meetings.service';

const STATUS: Record<Meeting['status'], { label: string; tone: string }> = {
  recording: { label: 'gravando', tone: 'bg-no/15 text-no' },
  transcribing: { label: 'transcrevendo…', tone: 'bg-later/15 text-later' },
  ready: { label: 'pronta', tone: 'bg-yes/15 text-yes' },
  recorded: { label: 'sem transcrição', tone: 'bg-raise text-mute' },
  failed: { label: 'falhou', tone: 'bg-no/15 text-no' },
};

/** atalhos: o que mais se pede de uma reunião */
const PRESETS: { label: string; text: string }[] = [
  { label: 'Resumo e pendências', text: 'Faça o resumo da reunião: o que foi decidido, as pendências (quem ficou de fazer o quê e até quando) e o que ficou em aberto.' },
  { label: 'Criar o projeto', text: 'Com base nesta reunião, monte o projeto na Central: nome, descrição, o rumo, os marcos e as primeiras histórias do backlog. Antes de criar qualquer coisa, me mostre o que vai criar e espere eu confirmar.' },
  { label: 'O que ficou em aberto', text: 'Liste o que ficou vago ou sem resposta na reunião e as perguntas que eu deveria fazer no próximo contato.' },
  { label: 'E-mail de follow-up', text: 'Escreva o e-mail de follow-up para os participantes: o que combinamos, os próximos passos e os prazos.' },
  { label: 'Ideias e decisões', text: 'Registre na Central as ideias e as decisões que saíram desta reunião (create_idea, create_decision), no projeto certo. Diga o que registrou.' },
];

/**
 * Reuniões: grava a call dentro da Central (áudio do sistema + microfone; tela opcional, com prints quando muda),
 * transcreve ao parar e deixa conversar com um agente sobre ela (resumo, criar o projeto, follow-up, o que quiser).
 */
@Component({
  selector: 'app-meetings-page',
  imports: [AgoPipe, ChatView, Check, DatePipe, Icon, Select, VideoPlayer],
  host: { class: 'grid h-full min-h-0 grid-cols-[360px_minmax(0,1fr)]' },
  template: `
    <!-- gravar + lista -->
    <section class="flex min-h-0 flex-col border-r border-edge bg-panel" aria-label="Reuniões">
      <div class="px-5 pt-6 pb-4">
        <h1 class="flex items-center gap-2.5 font-display text-2xl font-bold tracking-tight"><app-icon name="mic" [size]="22" class="text-frost" />Reuniões</h1>
        @if (rec.active(); as a) {
          <div class="mt-4 rounded-2xl border border-no/50 bg-no/[0.08] p-4" role="status">
            <p class="flex items-center gap-2 text-[13px] font-bold text-no"><span class="pulse size-2.5 rounded-full bg-no"></span>Gravando · <span class="tabular-nums">{{ rec.elapsed() }}</span></p>
            <p class="mt-1 truncate font-semibold">{{ a.title }}</p>
            <p class="mt-0.5 text-[12px] text-mute">Áudio do PC{{ a.mic ? ' + seu microfone' : ' (sem microfone: não deu acesso)' }}{{ a.screen ? ' + tela' : '' }}</p>
            <button type="button" class="btn mt-3 w-full !border-no !bg-no !text-night" (click)="rec.stop()"><app-icon name="stop" [size]="15" />Parar e transcrever</button>
          </div>
        } @else {
          <div class="mt-4 space-y-2.5 rounded-2xl border border-edge bg-night/40 p-4">
            <input class="field text-[13.5px]" placeholder="Nome da reunião (ex.: Kickoff com a escola X)" [value]="title()" (input)="title.set($any($event.target).value)" aria-label="Nome da reunião" />
            <app-select class="block" [options]="projectOptions()" [value]="slug()" (valueChange)="slug.set($event)" noneLabel="sem projeto (dá para ligar depois)" label="Projeto da reunião" />
            <label class="flex cursor-pointer items-center gap-2 text-[13px] text-mute">
              <app-check [checked]="screen()" (changed)="screen.set($event)" />Gravar a tela também <span class="text-faint">(os agentes veem o que foi mostrado)</span></label>
            <button type="button" class="btn w-full !border-no !bg-no !text-night" [disabled]="rec.starting()" (click)="start()">
              <span class="size-2.5 rounded-full bg-night"></span>{{ rec.starting() ? 'Começando…' : 'Gravar reunião' }}</button>
            <p class="text-[11.5px] leading-snug text-faint">Grava o som do PC (a call inteira, em qualquer app) e o seu microfone. Avise os participantes que a reunião está sendo gravada.</p>
            @if (rec.error(); as e) { <p role="alert" class="text-[12.5px] text-no">{{ e }}</p> }
          </div>
        }
      </div>
      <ul class="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        @for (m of svc.list(); track m.id) {
          <li>
            <button type="button" (click)="pick(m.id)" class="w-full rounded-xl px-3 py-2.5 text-left hover:bg-raise/60" [class.bg-raise]="current()?.id === m.id">
              <span class="block truncate font-semibold leading-snug">{{ m.title }}</span>
              <span class="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-mute">
                <span>{{ m.startedAt | date: 'dd/MM HH:mm' }}</span>
                @if (m.duration) { <span>· {{ minutes(m.duration) }}</span> }
                @if (projectName(m.projectSlug); as pn) { <span>· {{ pn }}</span> }
                <span class="rounded-full px-1.5 text-[11px] font-semibold {{ status(m).tone }}">{{ status(m).label }}</span>
              </span>
            </button>
          </li>
        } @empty { <li class="px-4 py-10 text-center text-[13px] text-mute">Nenhuma reunião gravada ainda.</li> }
      </ul>
    </section>

    <!-- a reunião escolhida -->
    @if (current(); as m) {
      <section class="flex min-h-0 min-w-0 flex-col" aria-label="Reunião">
        <div class="min-h-0 flex-1 overflow-y-auto px-8 pt-6 pb-6">
          <div class="flex flex-wrap items-center gap-3">
            <input class="min-w-0 flex-1 bg-transparent font-display text-[26px] font-bold tracking-tight outline-none" [value]="m.title" (change)="rename(m, $any($event.target).value)" aria-label="Nome da reunião" />
            <span class="rounded-full px-2.5 py-0.5 text-[12px] font-semibold {{ status(m).tone }}">{{ status(m).label }}</span>
            <button type="button" class="btn btn-sm btn-ghost" (click)="svc.openFolder(m.id)" title="Abrir a pasta com a gravação, a transcrição e os prints"><app-icon name="folder" [size]="14" />Pasta</button>
            <button type="button" class="btn btn-sm btn-ghost !text-no" (click)="remove(m)" [disabled]="m.status === 'recording'"><app-icon name="delete" [size]="14" /></button>
          </div>
          <p class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-mute">
            <span>{{ m.startedAt | date: "EEEE, dd/MM 'às' HH:mm" }}</span>
            @if (m.duration) { <span>· {{ minutes(m.duration) }}</span> }
            @if (m.screen) { <span>· com tela{{ m.frames ? ', ' + m.frames + ' prints' : '' }}</span> }
            <app-select class="inline-block w-[240px]" [compact]="true" [options]="projectOptions()" [value]="m.projectSlug ?? ''" (valueChange)="link(m, $event)" noneLabel="sem projeto" label="Projeto" />
          </p>
          @if (m.error) { <p class="mt-3 rounded-xl border border-later/40 bg-later/5 px-4 py-2.5 text-[13px] text-later">{{ m.error }}</p> }

          @if (m.status !== 'recording') {
            <app-video-player class="mt-5" [src]="m.media" [label]="m.title" />
          }
          @if (m.status === 'recorded' || m.status === 'failed') {
            <button type="button" class="btn btn-sm mt-3" (click)="svc.transcribe(m.id)"><app-icon name="sync" [size]="14" />Transcrever</button>
          }

          @if (m.transcript) {
            <details class="mt-5 rounded-2xl border border-edge bg-panel px-5 py-3">
              <summary class="cursor-pointer text-[13.5px] font-semibold">Transcrição <span class="font-normal text-faint">· {{ words(m.transcript) }} palavras</span></summary>
              <p class="mt-3 max-h-[40vh] overflow-y-auto whitespace-pre-wrap text-[13.5px] leading-relaxed text-mute selectable">{{ m.transcript }}</p>
            </details>

            <!-- pedir algo sobre a reunião -->
            <div class="mt-6">
              <h2 class="font-display text-[18px] font-semibold">Pedir algo sobre a reunião</h2>
              <div class="mt-2 flex flex-wrap gap-1.5">
                @for (p of presets; track p.label) {
                  <button type="button" class="rounded-full border border-edge px-3 py-1 text-[12.5px] text-mute hover:border-faint hover:text-text" (click)="prompt.set(p.text)">{{ p.label }}</button>
                }
              </div>
              <textarea class="field mt-2 h-24 resize-y text-[14px] leading-relaxed" placeholder="Ex.: monte o rumo e os marcos do projeto a partir desta call" [value]="prompt()"
                        (input)="prompt.set($any($event.target).value)" (keydown.control.enter)="ask(m)" aria-label="Pedido sobre a reunião"></textarea>
              <div class="mt-2 flex items-center gap-3">
                <span class="flex-1 text-[12px] text-faint">A Central lê a transcrição{{ m.frames ? ' e os prints da tela' : '' }} e responde aqui embaixo; depois é só continuar a conversa.</span>
                @if (svc.error(); as e) { <span class="text-[12.5px] text-no">{{ e }}</span> }
                <button type="button" class="btn btn-primary" [disabled]="!prompt().trim() || asking()" (click)="ask(m)"><app-icon name="send" [size]="14" />{{ asking() ? 'Enviando…' : 'Pedir' }}</button>
              </div>
            </div>
          } @else if (m.status === 'transcribing') {
            <p class="mt-6 flex items-center gap-2 text-[13.5px] text-mute"><span class="pulse size-2 rounded-full bg-later"></span>Transcrevendo: quando terminar, dá para pedir resumo, criar o projeto e o que mais quiser.</p>
          }
        </div>
        @if (m.chatId) {
          <div class="flex h-[52vh] min-h-[320px] shrink-0 flex-col border-t border-edge bg-panel/60">
            <p class="px-5 pt-3 text-[11px] font-bold uppercase tracking-wider text-faint">Conversa sobre a reunião</p>
            <app-chat-view class="min-h-0 flex-1" [compact]="true" [session]="session" />
          </div>
        }
      </section>
    } @else {
      <div class="grid place-items-center text-[14px] text-mute">Grave uma reunião ou escolha uma na lista.</div>
    }`,
})
export class MeetingsPage {
  protected readonly svc = inject(MeetingsService);
  protected readonly rec = inject(RecorderService);
  private readonly projects = inject(ProjectsService);
  private readonly chat = inject(ChatService);
  private readonly agents = inject(AgentsService);
  private readonly askDlg = inject(AskService);
  protected readonly presets = PRESETS;

  protected readonly title = signal('');
  protected readonly slug = signal('');
  protected readonly screen = signal(false);
  protected readonly prompt = signal('');
  protected readonly asking = signal(false);
  private readonly picked = signal<number | null>(null);
  /** a escolhida; sem escolha, a que está gravando ou a mais recente */
  protected readonly current = computed(() => {
    const list = this.svc.list();
    return list.find(m => m.id === this.picked()) ?? list.find(m => m.id === this.rec.active()?.id) ?? list[0] ?? null;
  });

  protected readonly projectOptions = computed<SelectOption[]>(() => this.projects.living().map(p => ({ value: p.slug, label: p.name, avatar: p })));

  /** a conversa sobre a reunião escolhida */
  protected readonly session = this.chat.spawn(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.chat.release(this.session));
    effect(() => {
      const m = this.current(), central = this.agents.central();
      untracked(() => {
        if (central) this.session.agentId.set(central.id);
        if (this.session.current() !== (m?.chatId ?? null)) this.session.select(m?.chatId ?? null);
      });
    });
  }

  protected status(m: Meeting) { return STATUS[m.status] ?? STATUS.recorded; }
  protected minutes(s: number): string { return s < 60 ? `${s} s` : `${Math.round(s / 60)} min`; }
  protected words(t: string): number { return t.split(/\s+/).filter(Boolean).length; }
  protected projectName(slug: string | null): string | null { return slug ? this.projects.bySlug().get(slug)?.name ?? null : null; }
  protected pick(id: number): void { this.picked.set(id); this.prompt.set(''); }

  protected async start(): Promise<void> {
    const id = await this.rec.start(this.title().trim() || `Reunião de ${new Date().toLocaleDateString('pt-BR')}`, this.slug() || null, this.screen());
    if (id) { this.picked.set(id); this.title.set(''); this.svc.load(); }
  }
  protected rename(m: Meeting, t: string): void { if (t.trim() && t.trim() !== m.title) this.svc.update(m.id, { title: t.trim() }); }
  protected link(m: Meeting, slug: string): void { this.svc.update(m.id, { project_slug: slug || null }); }
  protected async remove(m: Meeting): Promise<void> {
    if (!(await this.askDlg.confirm(`Apagar "${m.title}"? A gravação, a transcrição e os prints saem do disco.`, { confirmLabel: 'Apagar' }))) return;
    await this.svc.remove(m.id);
    this.picked.set(null);
  }
  protected async ask(m: Meeting): Promise<void> {
    const text = this.prompt().trim();
    if (!text) return;
    this.asking.set(true);
    try {
      const chatId = await this.svc.ask(m.id, text);
      if (chatId) { this.prompt.set(''); await this.chat.loadChats(); this.session.select(chatId); }
    } finally { this.asking.set(false); }
  }
}
