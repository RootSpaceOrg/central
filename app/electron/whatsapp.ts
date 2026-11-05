/**
 * WhatsApp na Central (usa a extensão "whatsapp"):
 * - Donos (os números que você cadastrou, e a conversa "você mesmo" do número vinculado) falam com a Central: cada um é
 *   uma conversa persistente com o agente principal, e a resposta volta pelo WhatsApp.
 * - Qualquer outro número fica registrado como contato e não aciona agente nenhum (texto de estranho é entrada não
 *   confiável; o atendimento a clientes, com ferramentas restritas, vem depois).
 * - Agentes mandam mensagem com whatsapp_send. Contato novo (nunca escreveu) pede aprovação, a não ser que você libere
 *   "qualquer número" em Extensões.
 */
import { getSetting, onDecided } from './backlog';
import { sendChat } from './central-agent';
import { all, get, now, run } from './db';
import { callExtension, onExtensionEvent, running } from './extensions';
import { digits, toWhatsApp } from './wa-format';

export { digits };
import type { ChatMessageDto } from '../src/app/shared/contract';

const EXT = 'whatsapp';
/** quem envia de fato (a extensão); o teste troca por um gravador */
let sendOut = (to: string, text: string): Promise<unknown> => callExtension(EXT, 'send', { to, text });
export const setSender = (fn: typeof sendOut) => { sendOut = fn; };
type Notify = (chatId: number, msg: ChatMessageDto | null, live: boolean) => void;
export interface WaStatus { state: 'disconnected' | 'pairing' | 'connecting' | 'open'; me: { id: string; lid: string | null; phone: string; name: string | null } | null; code: string | null }
interface WaMessage { id: string; chat: string; phone: string | null; name: string | null; fromMe: boolean; self: boolean; text: string; at: number }

let status: WaStatus = { state: 'disconnected', me: null, code: null };
export const waStatus = () => ({ ...status, installed: running(EXT) || !!getSetting(`ext:${EXT}:enabled`) });

export const owners = (): string[] => { try { return (JSON.parse(getSetting('wa:owners') ?? '[]') as string[]).map(digits).filter(Boolean); } catch { return []; } };
const anyNumber = () => getSetting('wa:any') === '1';

const INTRO = `(Mensagem do Gustavo pelo WhatsApp. Responda curto, em texto simples do WhatsApp: *negrito* com um asterisco, listas com •,
sem tabelas nem blocos de código. O que precisar de tela, diga onde está na Central.)`;

let deps: { notify: Notify; changed: () => void; onStatus: () => void; centralId: () => number };
const waiting = new Map<string, string[]>();

export function initWhatsApp(d: typeof deps): void {
  deps = d;
  onExtensionEvent(EXT, (event, data) => {
    if (event === 'status') { status = { state: data.state, me: data.me ?? null, code: data.code ?? null }; deps.onStatus(); }
    if (event === 'message') inbound(data as WaMessage);
  });
  // aprovou a decisão de mandar para um contato novo: manda; recusou: descarta
  onDecided((p, verdict) => {
    if (p.source !== 'whatsapp') return false;
    const out = get<{ id: number; to_number: string; text: string }>(`select id, to_number, text from wa_outbox where proposal_id = ? and status = 'pending'`, p.id);
    if (!out) return true;
    if (verdict === 'approve') {
      callExtension(EXT, 'send', { to: out.to_number, text: out.text })
        .then(() => { run(`update wa_outbox set status = 'sent', sent_at = ? where id = ?`, now(), out.id); touch(out.to_number, null, 'out'); })
        .catch(e => run(`update wa_outbox set status = 'failed', error = ? where id = ?`, String(e.message), out.id));
    } else if (verdict === 'reject') run(`update wa_outbox set status = 'rejected' where id = ?`, out.id);
    return true;
  });
}

function touch(phone: string, m: WaMessage | null, dir: 'in' | 'out'): void {
  run(`insert into wa_contacts (phone, chat, name, last_in_at, last_out_at, last_text) values (?,?,?,?,?,?)
       on conflict(phone) do update set chat = coalesce(excluded.chat, chat), name = coalesce(excluded.name, name),
         last_in_at = coalesce(excluded.last_in_at, last_in_at), last_out_at = coalesce(excluded.last_out_at, last_out_at),
         last_text = coalesce(excluded.last_text, last_text)`,
    phone, m?.chat ?? null, m?.name ?? null, dir === 'in' ? now() : null, dir === 'out' ? now() : null, m?.text.slice(0, 500) ?? null);
}

export function inbound(m: WaMessage): void {
  // o que você mandou do celular para outras pessoas não é conversa com a Central
  if (m.fromMe && !m.self) return;
  const owner = m.self || (!!m.phone && owners().includes(m.phone));
  if (!owner) { if (m.phone) touch(m.phone, m, 'in'); deps.changed(); return; }
  talk(m.self ? 'self' : m.phone!, m.chat, m.text);
}

/** Dono escreveu: segue a conversa dele com a Central; mensagens que chegam enquanto ela responde vão juntas depois. */
function talk(key: string, chat: string, text: string): void {
  const saved = Number(getSetting(`wa:chat:${key}`)) || null;
  const chatId = saved && get('select 1 from chats where id = ?', saved) ? saved : null;
  if (waiting.has(key)) { waiting.get(key)!.push(text); return; }
  waiting.set(key, []);
  callExtension(EXT, 'typing', { to: chat }).catch(() => {});
  let last: string | null = null;
  const notify: Notify = (id, msg, live) => {
    deps.notify(id, msg, live);
    if (msg?.role === 'assistant') last = msg.text;
    if (msg?.role === 'error') last = `⚠️ ${msg.text}`;
    if (msg === null && !live) {
      const reply = last ?? 'Terminei, mas não tenho nada para dizer aqui. Veja a conversa na Central.';
      sendOut(chat, toWhatsApp(reply)).catch(() => {});
      const queued = waiting.get(key) ?? [];
      waiting.delete(key);
      if (queued.length) talk(key, chat, queued.join('\n\n'));
    }
  };
  try {
    const id = sendChat(chatId, deps.centralId(), chatId ? text : `${INTRO}\n\n${text}`, notify, deps.changed);
    if (!chatId) {
      run('update chats set title = ? where id = ?', `WhatsApp · ${key === 'self' ? 'você' : `+${key}`}`, id);
      run(`insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value`, `wa:chat:${key}`, String(id));
    }
  } catch (e) {
    waiting.delete(key);
    sendOut(chat, `⚠️ ${(e as Error).message}`).catch(() => {});
  }
}

/** Ferramenta dos agentes: manda (ou pede aprovação para mandar) uma mensagem. */
export async function agentSend(to: string, text: string, from: string): Promise<string> {
  const n = digits(to);
  if (n.length < 10) throw new Error('Número inválido: use DDI + DDD + número, ex.: 5511999998888.');
  const known = owners().includes(n) || !!get('select 1 from wa_contacts where phone = ? and last_in_at is not null', n);
  if (!known && !anyNumber()) {
    const { lastInsertRowid } = run(`insert into proposals (project_slug, title, body, next_action, tier, source, source_ref) values (null, ?, ?, ?, 1, 'whatsapp', ?)`,
      `Mandar WhatsApp para +${n}?`, `${from} quer mandar esta mensagem para um número que nunca falou com vocês:\n\n${text}`, 'A Central envia a mensagem.', `wa-${Date.now()}`);
    run(`insert into wa_outbox (to_number, text, proposal_id, status, created_by) values (?,?,?, 'pending', ?)`, n, text, Number(lastInsertRowid), from);
    deps.changed();
    return `Contato novo: pedi aprovação ao Gustavo (decisão #${lastInsertRowid}). A mensagem sai quando ele aprovar.`;
  }
  if (status.state !== 'open') throw new Error('O WhatsApp não está conectado (Extensões → WhatsApp).');
  await sendOut(n, toWhatsApp(text));
  touch(n, null, 'out');
  return `Mensagem enviada para +${n}.`;
}

/** Aviso para os donos (ex.: execução esperando você, decisão de alto risco). */
export function notifyOwners(text: string): void {
  if (status.state !== 'open' || getSetting('wa:notify') === '0') return;
  const to = owners().length ? owners() : status.me ? [status.me.id] : [];
  for (const n of to) callExtension(EXT, 'send', { to: n, text: toWhatsApp(text) }).catch(() => {});
}

export const listContacts = () => all<{ phone: string; name: string | null; last_in_at: string | null; last_out_at: string | null; last_text: string | null }>(
  'select phone, name, last_in_at, last_out_at, last_text from wa_contacts order by coalesce(last_in_at, last_out_at) desc limit 100');
