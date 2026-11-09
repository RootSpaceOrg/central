/**
 * Estúdio → Piloto automático: Rumo + Time sem você no meio. Roda a sessão de Rumo e aceita as recomendações, monta o
 * Time a partir do rumo decidido e para: você vê só o final (ok ou feedback). Com o ok, a Central executa o rumo e,
 * quando ele fecha, o time. Feedback refaz a partir do Rumo, com o seu comentário.
 * Anda sozinho a cada vez que uma sessão termina de falar (onGuideIdle) ou fecha (onGuideFinish).
 */
import type { GuideCard, GuideDto, GuidePlanItem, PilotDto } from '../src/app/shared/contract';
import { all, get, now, run } from './db';
import { GuideDeps, answerCard, approvePlan, getGuide, onGuideFinish, onGuideIdle, requestPlan, setFocus, startGuide } from './guides';

let deps: GuideDeps | null = null;
const parse = <T>(v: string | null): T[] => { try { return v ? JSON.parse(v) : []; } catch { return []; } };

export const listPilots = () => all<PilotDto>(`select * from pilots where status != 'abandoned' order by id desc limit 100`);
const getPilot = (id: number) => get<PilotDto>('select * from pilots where id = ?', id) ?? null;
const live = (guideId: number) => get<PilotDto>(`select * from pilots where status in ('running','approved') and (rumo_guide = ? or time_guide = ?) order by id desc limit 1`, guideId, guideId) ?? null;

/** liga os ganchos (o main chama uma vez, com o mesmo deps das sessões) */
export function initPilot(d: GuideDeps): void {
  deps = d;
  onGuideIdle(id => { try { advance(id); } catch (e) { console.error('piloto', e); } });
  onGuideFinish(id => { try { finished(id); } catch (e) { console.error('piloto', e); } });
}

export async function startPilot(slug: string, direct: boolean, focus: string | null): Promise<PilotDto> {
  const d = deps!;
  const open = get<PilotDto>(`select * from pilots where project_slug = ? and direct = ? and status in ('running','ready','approved')`, slug, direct ? 1 : 0);
  if (open) return open;
  const existing = get<GuideDto>(`select * from guides where project_slug = ? and direct = ? and kind = 'rumo' and status = 'open'`, slug, direct ? 1 : 0);
  const note = `Piloto automático: o Gustavo não vai responder card por card; as recomendações viram as escolhas. Seja criterioso nas recomendações.${focus?.trim() ? ` Foco dele: ${focus.trim()}` : ''}`;
  const g = existing ?? await startGuide(slug, direct, note, d, 'rumo');
  const id = Number(run(`insert into pilots (project_slug, direct, status, stage, rumo_guide, focus) values (?,?, 'running', 'rumo', ?, ?)`,
    slug, direct ? 1 : 0, g.id, focus?.trim() || null).lastInsertRowid);
  // sessão de Rumo que já estava aberta: segue dela (com o foco, se veio) ou, parada, já avança
  if (existing) {
    if (focus?.trim() && existing.central_chat) setFocus(existing.id, `${note}`, d);
    else if (existing.phase === 'idle') advance(existing.id);
  }
  d.changed();
  return getPilot(id)!;
}

/** uma sessão do piloto terminou de falar: responde os cards pela recomendação, pede o plano, passa para o Time, ou para */
function advance(guideId: number): void {
  const d = deps;
  const p = live(guideId);
  if (!d || !p || p.status !== 'running') return;
  const g = getGuide(guideId)!;
  if (g.status !== 'open' || g.phase !== 'idle') return;
  const cards = parse<GuideCard>(g.cards), plan = parse<GuidePlanItem>(g.plan);
  if (!cards.length) return;
  if (!plan.length) {
    for (const c of cards) if (!c.answer) answerCard(g.id, c.id, { choice: c.recommended ?? 0, note: 'escolha automática (recomendada)' });
    requestPlan(g.id, d);
    return;
  }
  if (guideId === p.rumo_guide && p.stage === 'rumo') {
    const focus = `Piloto automático: monte a agência (time, quadros, rotinas, dono do A fazer) para executar o rumo que acabou de ser decidido (sessão #${g.id}).
Leitura: ${g.reading ?? ''}
Plano do rumo:
${plan.filter(i => i.include).map(i => `- (${i.when}) [${i.kind}] ${i.title}${i.agent ? ` — ${i.agent}` : ''}${i.detail ? `: ${i.detail.slice(0, 300)}` : ''}`).join('\n')}
Os itens "para a Agência" são obrigatórios aqui. As recomendações viram as escolhas: seja criterioso.${p.focus ? `\nFoco do Gustavo: ${p.focus}` : ''}`;
    run(`update pilots set stage = 'time', updated_at = ? where id = ?`, now(), p.id);
    const open = get<GuideDto>(`select * from guides where project_slug = ? and direct = ? and kind = 'agencia' and status = 'open'`, g.project_slug, g.direct);
    if (open) {
      run('update pilots set time_guide = ? where id = ?', open.id, p.id);
      run('update guides set plan = null, cards = ?, step = 2 where id = ?', JSON.stringify(parse<GuideCard>(open.cards).map(c => ({ ...c, answer: null }))), open.id);
      setFocus(open.id, focus, d);
    } else {
      startGuide(g.project_slug, !!g.direct, focus, d, 'agencia').then(t => {
        run('update pilots set time_guide = ? where id = ?', t.id, p.id);
        d.changed();
      }, e => { run(`update pilots set status = 'failed', error = ? where id = ?`, String(e?.message ?? e), p.id); d.changed(); });
    }
    d.changed();
    return;
  }
  if (guideId === p.time_guide && p.stage === 'time') {
    run(`update pilots set status = 'ready', stage = 'ready', updated_at = ? where id = ?`, now(), p.id);
    d.notifyReady?.(p.project_slug);
    d.changed();
  }
}

/** com o ok: executa o rumo; quando ele fechar (ata), executa o time */
export function approvePilot(id: number): void {
  const p = getPilot(id);
  if (!p || p.status !== 'ready') throw new Error('O piloto não está pronto para aprovar.');
  run(`update pilots set status = 'approved', approved_at = ?, updated_at = ? where id = ?`, now(), now(), id);
  approvePlan(p.rumo_guide, deps!);
}

function finished(guideId: number): void {
  const p = get<PilotDto>(`select * from pilots where status = 'approved' and (rumo_guide = ? or time_guide = ?) order by id desc limit 1`, guideId, guideId);
  if (!p || !deps) return;
  if (guideId === p.rumo_guide && p.time_guide && getGuide(p.time_guide)?.status === 'open') approvePlan(p.time_guide, deps);
  else if (guideId === p.time_guide) { run(`update pilots set status = 'done', finished_at = ? where id = ?`, now(), p.id); deps.changed(); }
}

/** mudar a rota: o Rumo refaz com o seu comentário e o piloto anda de novo até o fim */
export function feedbackPilot(id: number, text: string): void {
  const p = getPilot(id);
  const t = text.trim();
  if (!p || p.status !== 'ready') throw new Error('O piloto não está esperando você.');
  if (!t) throw new Error('Escreva o que mudar.');
  const rumo = getGuide(p.rumo_guide)!;
  const cards = parse<GuideCard>(rumo.cards).map(c => ({ ...c, answer: null }));
  run('update guides set plan = null, cards = ?, step = 2 where id = ?', JSON.stringify(cards), rumo.id);
  if (p.time_guide) run(`update guides set plan = null, step = 2 where id = ?`, p.time_guide);
  run(`update pilots set status = 'running', stage = 'rumo', feedback = coalesce(feedback || char(10), '') || ?, updated_at = ? where id = ?`, t, now(), id);
  setFocus(rumo.id, `Feedback do Gustavo no piloto automático (ele viu o resultado e quer mudar a rota): "${t}". Refaça os cards e as recomendações levando isso em conta.`, deps!);
}

export function abandonPilot(id: number): void {
  run(`update pilots set status = 'abandoned', finished_at = ? where id = ? and status in ('running','ready','failed')`, now(), id);
  deps?.changed();
}
