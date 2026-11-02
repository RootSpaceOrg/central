import { Component, ElementRef, afterRenderEffect, computed, inject, input, output } from '@angular/core';

import { Placement, Prop, RoomId, VIEW_H, VIEW_W, iso, place, roomSigns, route, skinOf, staticScene } from '../../../../office-map';

/** Uma pessoa no andar: quem trabalha senta numa mesa da sala; quem está parado fica na copa. */
export interface Person {
  key: string;
  room: RoomId;
  name: string;
  /** cabelo = cor do agente; camisa = cor do projeto */
  hair: string;
  shirt: string;
  working: boolean;
  /** o que está fazendo (balão) */
  doing: string | null;
  /** projeto, para o balão */
  tag: string | null;
  /** passos do plano feitos/total */
  plan: [number, number] | null;
  /** subagentes rodando (estagiários ao lado da mesa) */
  subs: number;
}

type Item = { kind: 'prop'; depth: number; prop: Prop } | { kind: 'person'; depth: number; p: Person; at: Placement; tf: string };

const STATIC = staticScene();
const SIGNS = roomSigns();
const tf = (x: number, y: number) => { const [sx, sy] = iso(x, y); return `translate(${sx}px, ${sy}px)`; };
/** estagiários: ao lado da mesa, em relação a quem está sentado (ladrilhos) */
const SUB_SPOTS: [number, number][] = [[1.45, -0.9], [1.55, -0.1], [-1.25, -0.3]];
/** (dentro do grupo da pessoa, que já está em escala 1.35) */
const subTf = ([dx, dy]: [number, number]) => `translate(${((dx - dy) * 32) / 1.35} ${((dx + dy) * 16) / 1.35}) scale(.72)`;
const SUB_HAIR = ['#3b2a20', '#e2c072', '#7a3b2e'];

/**
 * O andar em isométrico, desenhado em SVG puro: piso, paredes e móveis são polígonos fixos; as pessoas são grupos que
 * andam (Web Animations) pelo corredor quando mudam de sala. Sem engine nem loop de animação: só CSS e transições.
 */
@Component({
  selector: 'app-office-scene',
  host: { class: 'block' },
  styles: `
    .ch { cursor: pointer; }
    .ch .walk { display: none; }
    .ch.walking .walk { display: inline; }
    .ch.walking .rest, .ch.walking .say { display: none; }
    .ch.walking .leg-l { animation: step .36s ease-in-out infinite alternate; }
    .ch.walking .leg-r { animation: step .36s ease-in-out infinite alternate-reverse; }
    .ch.walking .bob { animation: bob .18s ease-in-out infinite alternate; }
    .ch.work .arm-l { animation: type .42s ease-in-out infinite alternate; }
    .ch.work .arm-r { animation: type .42s ease-in-out infinite alternate-reverse; }
    .ch.idle .zz { animation: zz 3.2s ease-in-out infinite; }
    .ch:hover .body, .ch.sel .body { filter: brightness(1.18); }
    .screen.on { animation: flick 2.6s ease-in-out infinite; }
    @keyframes step { from { transform: translateY(0); } to { transform: translateY(-3px); } }
    @keyframes bob { from { transform: translateY(0); } to { transform: translateY(-1.5px); } }
    @keyframes type { from { transform: translateY(0); } to { transform: translateY(-2.5px); } }
    @keyframes zz { 0% { opacity: 0; transform: translate(0, 0); } 30% { opacity: .9; } 100% { opacity: 0; transform: translate(8px, -14px); } }
    @keyframes flick { 50% { opacity: .78; } }
    @media (prefers-reduced-motion: reduce) { .ch *, .screen { animation: none !important; } }
  `,
  template: `
    <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" class="block h-auto w-full select-none" role="img"
         [attr.aria-label]="'Escritório: ' + working() + ' trabalhando, ' + (people().length - working()) + ' na copa'">
      <defs>
        <radialGradient id="glow"><stop offset="0" stop-color="#9fc3ff" stop-opacity=".55" /><stop offset="1" stop-color="#9fc3ff" stop-opacity="0" /></radialGradient>
      </defs>
      @for (f of floor; track $index) { <polygon [attr.points]="f.points" [attr.fill]="f.fill" shape-rendering="crispEdges" /> }
      @for (w of walls; track $index) { <polygon [attr.points]="w.points" [attr.fill]="w.fill" [attr.stroke]="w.stroke ?? null" [attr.opacity]="w.opacity ?? null" /> }
      <!-- quadro da gestão: um post-it por marco em Agora (cor do projeto) -->
      @for (s of stickies(); track $index) { <polygon [attr.points]="s.points" [attr.fill]="s.fill" /> }
      <!-- telões da monitoração -->
      @for (g of graphs; track $index) { <polyline [attr.points]="g" fill="none" stroke="#5FD3B5" stroke-width="1.6" opacity=".85" /> }
      @for (s of signs; track s.id) {
        <g [attr.transform]="s.transform">
          <rect x="-4" y="-13" [attr.width]="s.label.length * 9 + 22" height="21" rx="4" fill="#0b0e14" opacity=".72" />
          <circle cx="4" cy="-2.5" r="3" [attr.fill]="s.accent" />
          <text x="12" y="4" font-size="14" font-weight="700" fill="#e9edf5" letter-spacing=".3">{{ s.label }}</text>
        </g>
      }
      @for (g of glass; track $index) { <polygon [attr.points]="g.points" [attr.fill]="g.fill" [attr.opacity]="g.opacity" stroke="#cfe3ff" stroke-opacity=".25" /> }

      @for (it of items(); track it.kind === 'prop' ? 'p' + $index : it.p.key) {
        @if (it.kind === 'prop') {
          <g>
            @for (q of it.prop.polys; track $index) { <polygon [attr.points]="q.points" [attr.fill]="q.fill" /> }
            @if (it.prop.screen) {
              <polygon class="screen" [class.on]="lit().has(it.prop.desk!)" [attr.points]="it.prop.screen" [attr.fill]="lit().has(it.prop.desk!) ? '#8fb4ff' : '#1a2230'" />
            }
          </g>
        } @else {
          <g class="ch" [attr.data-key]="it.p.key" [style.transform]="it.tf" [class.work]="it.p.working && it.at.seated" [class.idle]="!it.p.working"
             [class.sel]="selected() === it.p.key" (click)="pick.emit(it.p.key)" (dblclick)="open.emit(it.p.key)">
            <title>{{ it.p.name }}{{ it.p.doing ? ': ' + it.p.doing : it.p.working ? '' : ' (na copa)' }}</title>
            @if (selected() === it.p.key) { <ellipse rx="22" ry="10" fill="none" [attr.stroke]="it.p.hair" stroke-width="2.4" /> }
            <g transform="scale(1.35)">
            <ellipse rx="11" ry="4.5" fill="#000" opacity=".32" />
            <!-- em pé, de frente (parado ou andando) -->
            <g class="body" [class.walk]="it.at.seated">
              <g class="bob">
                <rect class="leg-l" x="-6" y="-15" width="5" height="15" rx="1.5" fill="#2b3242" />
                <rect class="leg-r" x="1" y="-15" width="5" height="15" rx="1.5" fill="#2b3242" />
                <rect x="-9" y="-32" width="18" height="19" rx="4" [attr.fill]="it.p.shirt" />
                <rect x="-12" y="-31" width="4" height="14" rx="2" [attr.fill]="it.p.shirt" style="filter:brightness(.8)" />
                <rect x="8" y="-31" width="4" height="14" rx="2" [attr.fill]="it.p.shirt" style="filter:brightness(.8)" />
                <rect x="-8" y="-48" width="16" height="16" rx="5" [attr.fill]="skin(it.p.key)" />
                <rect x="-8.5" y="-50" width="17" height="7" rx="3.5" [attr.fill]="it.p.hair" />
                <rect x="-4.5" y="-41" width="2.2" height="2.8" rx=".6" fill="#1b1f2a" />
                <rect x="2.3" y="-41" width="2.2" height="2.8" rx=".6" fill="#1b1f2a" />
              </g>
            </g>
            <!-- sentado, de costas, digitando -->
            @if (it.at.seated) {
              <g class="body rest">
                <rect x="-1.5" y="-10" width="3" height="10" fill="#22262e" />
                <rect x="-9" y="-31" width="18" height="20" rx="4" [attr.fill]="it.p.shirt" />
                <rect class="arm-l" x="-12" y="-29" width="4" height="11" rx="2" [attr.fill]="it.p.shirt" style="filter:brightness(.8)" />
                <rect class="arm-r" x="8" y="-29" width="4" height="11" rx="2" [attr.fill]="it.p.shirt" style="filter:brightness(.8)" />
                <rect x="-8" y="-47" width="16" height="16" rx="5" [attr.fill]="skin(it.p.key)" />
                <rect x="-8.5" y="-49" width="17" height="14.5" rx="5" [attr.fill]="it.p.hair" />
                <rect x="-10" y="-22" width="20" height="13" rx="3" fill="#3a3f4b" />
              </g>
            }
            @if (!it.p.working) { <text class="zz" x="9" y="-50" font-size="10" font-weight="700" fill="#9aa3b5">z</text> }
            <!-- estagiários -->
            @for (s of subSlots(it.p.subs); track $index) {
              <g [attr.transform]="s.tf">
                <ellipse rx="11" ry="4.5" fill="#000" opacity=".3" />
                <rect x="-6" y="-15" width="5" height="15" rx="1.5" fill="#2b3242" /><rect x="1" y="-15" width="5" height="15" rx="1.5" fill="#2b3242" />
                <rect x="-9" y="-32" width="18" height="19" rx="4" fill="#9b7bff" />
                <rect x="-8" y="-48" width="16" height="16" rx="5" [attr.fill]="s.skin" />
                <rect x="-8.5" y="-50" width="17" height="7" rx="3.5" [attr.fill]="s.hair" />
                <rect x="-4.5" y="-41" width="2.2" height="2.8" fill="#1b1f2a" /><rect x="2.3" y="-41" width="2.2" height="2.8" fill="#1b1f2a" />
              </g>
            }
            </g>
            @if (it.p.subs > 3) {
              <text x="74" y="-40" font-size="11" font-weight="700" fill="#C6A6FF">+{{ it.p.subs - 3 }}</text>
            }
            <!-- balão: o que está fazendo -->
            @if (it.p.working) {
              <foreignObject class="say" x="-125" y="-158" width="250" height="86" style="overflow:visible">
                <div class="flex h-full flex-col items-center justify-end">
                  <div class="max-w-[246px] rounded-[10px] border-2 border-[#11151c] bg-[#f6f3ea] px-2 py-1 text-center leading-tight text-[#11151c] shadow-[0_2px_0_#11151c]">
                    <div class="truncate text-[13.5px] font-bold">{{ it.p.name }}@if (it.p.tag) { <span class="font-normal opacity-60"> · {{ it.p.tag }}</span> }</div>
                    <div class="truncate text-[13px]">{{ it.p.doing ?? 'pensando…' }}@if (it.p.plan) { <b class="ml-1 tabular-nums">{{ it.p.plan[0] }}/{{ it.p.plan[1] }}</b> }</div>
                  </div>
                  <div class="-mt-[2px] h-0 w-0 border-x-[6px] border-t-[7px] border-x-transparent border-t-[#11151c]"></div>
                </div>
              </foreignObject>
            }
          </g>
        }
      }
    </svg>
  `,
})
export class OfficeScene {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly people = input.required<Person[]>();
  readonly selected = input<string | null>(null);
  /** cores dos marcos em Agora (post-its no quadro da gestão) */
  readonly milestones = input<string[]>([]);
  readonly pick = output<string>();
  readonly open = output<string>();

  protected readonly W = VIEW_W;
  protected readonly H = VIEW_H;
  protected readonly floor = STATIC.floor;
  protected readonly walls = STATIC.walls;
  protected readonly glass = STATIC.glass;
  protected readonly signs = SIGNS;
  protected readonly graphs = [[17.7, 19.7], [20.3, 22.3]].map(([a, b]) =>
    Array.from({ length: 12 }, (_, i) => iso(a + ((b - a) * i) / 11, 0, 50 + Math.round(Math.abs(Math.sin(i * 1.7 + a)) * 24)).join(',')).join(' '));

  // ponytail: o lugar de cada um fica guardado aqui (mutável) para ninguém trocar de mesa quando chega gente nova
  private readonly seats = new Map<string, string>();
  private last = new Map<string, Placement>();
  private first = true;

  protected readonly placed = computed(() => place(this.people().map(p => ({ key: p.key, room: p.room })), this.seats));
  protected readonly working = computed(() => this.people().filter(p => p.working).length);
  /** mesas com alguém trabalhando: monitor aceso */
  protected readonly lit = computed(() => {
    const on = new Set<string>();
    for (const p of this.people()) { const at = this.placed().get(p.key); if (p.working && at?.seated) on.add(at.seat); }
    return on;
  });

  protected readonly items = computed<Item[]>(() => {
    const placed = this.placed();
    const out: Item[] = STATIC.props.map(prop => ({ kind: 'prop' as const, depth: prop.depth, prop }));
    for (const p of this.people()) {
      const at = placed.get(p.key)!;
      out.push({ kind: 'person', depth: at.x + at.y, p, at, tf: tf(at.x, at.y) });
    }
    return out.sort((a, b) => a.depth - b.depth);
  });

  protected readonly stickies = computed(() => this.milestones().slice(0, 10).map((fill, i) => {
    const x = 1.45 + (i % 5) * 0.82, z = i < 5 ? 78 : 58;
    return { fill, points: [iso(x, 0, z), iso(x + 0.55, 0, z), iso(x + 0.55, 0, z - 15), iso(x, 0, z - 15)].map(p => p.join(',')).join(' ') };
  }));

  constructor() {
    // quem mudou de lugar (ou chegou) anda até lá pelo corredor
    afterRenderEffect(() => {
      const placed = this.placed();
      const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!this.first && !calm) {
        for (const [key, to] of placed) {
          const from = this.last.get(key) ?? null;
          if (from?.seat === to.seat) continue;
          const g = this.el.nativeElement.querySelector<SVGGElement>(`g[data-key="${CSS.escape(key)}"]`);
          if (g) walk(g, route(from, to));
        }
      }
      this.last = new Map(placed);
      this.first = false;
    });
  }

  protected skin(key: string): string { return skinOf(key); }

  protected subSlots(n: number) {
    return SUB_SPOTS.slice(0, Math.min(n, 3)).map((d, i) => ({ tf: subTf(d), hair: SUB_HAIR[i], skin: skinOf(`sub${i}`) }));
  }
}

/** anda pelos pontos (ladrilhos) a velocidade constante */
function walk(g: SVGGElement, path: [number, number][]): void {
  const pts = path.map(([x, y]) => iso(x, y));
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  const total = seg.reduce((a, b) => a + b, 0);
  if (total < 1) return;
  let acc = 0;
  const frames = pts.map((p, i) => {
    if (i) acc += seg[i - 1];
    return { transform: `translate(${p[0]}px, ${p[1]}px)`, offset: acc / total };
  });
  g.getAnimations().forEach(a => a.cancel());
  g.classList.add('walking');
  const anim = g.animate(frames, { duration: Math.min(5200, Math.max(900, total * 7)), easing: 'linear' });
  anim.finished.then(() => g.classList.remove('walking'), () => g.classList.remove('walking'));
}
