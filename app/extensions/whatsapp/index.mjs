/**
 * Extensão WhatsApp da Central: roda num processo próprio (utilityProcess do Electron) e segura a conexão de um ou mais
 * números vinculados (Baileys, o mesmo protocolo do WhatsApp Web). Cada número é uma "conta" com a sua sessão em
 * accounts/<id>/auth. Conversa com a Central por mensagens:
 *   Central → extensão: { id, call: 'status' | 'pair' | 'send' | 'typing' | 'logout', args: { account, ... } }
 *   extensão → Central: { id, result } | { id, error } | { event: 'status' | 'message' | 'log', data: { account, ... } }
 * Sem servidor e sem npm na máquina: é um arquivo só (empacotado com esbuild), baixado do release.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import makeWASocket, { DisconnectReason, jidNormalizedUser, useMultiFileAuthState } from '@whiskeysockets/baileys';
import pino from 'pino';

const port = process.parentPort;
const dataDir = process.argv[2] ?? process.env.CENTRAL_EXT_DATA;
const accountsDir = join(dataDir, 'accounts');
const emit = (event, data) => port.postMessage({ event, data });
const log = text => emit('log', String(text));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const digits = s => String(s ?? '').replace(/\D/g, '');

// v1.0 tinha um número só, em auth/: vira a conta "main" (a sessão continua, sem parear de novo)
if (existsSync(join(dataDir, 'auth'))) {
  mkdirSync(join(accountsDir, 'main'), { recursive: true });
  if (!existsSync(join(accountsDir, 'main', 'auth'))) renameSync(join(dataDir, 'auth'), join(accountsDir, 'main', 'auth'));
}

/**
 * Uma conta: socket, estado, número pedindo pareamento, ids que nós mandamos (o eco não volta como mensagem nova, evita
 * laço respondendo a si mesmo) e fila de envio (uma mensagem a cada ~1,2 s, com "digitando" antes: menos cara de robô).
 */
const accounts = new Map();
/**
 * Tudo que a Central mandou, por qualquer número (id → quando). Mensagem com um desses ids nunca vira entrada: nem o eco
 * no próprio número, nem a chegada em outro número conectado (senão dois agentes ficariam respondendo um ao outro).
 */
const sentIds = new Map();
const markSent = id => { sentIds.set(id, Date.now()); for (const [k, at] of sentIds) if (Date.now() - at > 30 * 60_000) sentIds.delete(k); };
const acc = id => {
  if (!accounts.has(id)) accounts.set(id, { id, sock: null, state: { state: 'disconnected', me: null, code: null }, pairing: null, queue: Promise.resolve() });
  return accounts.get(id);
};
const authOf = id => join(accountsDir, id, 'auth');
const setState = (a, patch) => { a.state = { ...a.state, ...patch }; emit('status', { account: a.id, ...a.state }); };

async function connect(a) {
  const { state: auth, saveCreds } = await useMultiFileAuthState(authOf(a.id));
  // navegador padrão do Baileys (Chrome no Mac): o vínculo por código de pareamento só aceita um navegador conhecido;
  // nome próprio ("Central") faz o celular dizer que o código está errado
  const s = makeWASocket({ auth, logger: pino({ level: 'silent' }), markOnlineOnConnect: false, syncFullHistory: false });
  a.sock = s;
  s.ev.on('creds.update', saveCreds);
  s.ev.on('connection.update', async u => {
    if (s !== a.sock) return;
    // conta nova: o WhatsApp pede o vínculo; com o número digitado, a Central mostra o código de 8 letras
    if (u.qr && !auth.creds.registered) {
      if (!a.pairing) return setState(a, { state: 'disconnected', code: null });
      if (a.state.code) return;
      try { setState(a, { state: 'pairing', code: await s.requestPairingCode(a.pairing) }); }
      catch (e) { log(`pareamento: ${e.message}`); setState(a, { state: 'disconnected', code: null }); }
    }
    if (u.connection === 'open') {
      a.pairing = null;
      setState(a, { state: 'open', code: null, me: { id: jidNormalizedUser(s.user.id), lid: s.user.lid ? jidNormalizedUser(s.user.lid) : null, phone: digits(s.user.id.split(':')[0]), name: s.user.name ?? null } });
    }
    if (u.connection === 'close') {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        rmSync(authOf(a.id), { recursive: true, force: true });
        a.sock = null;
        return setState(a, { state: 'disconnected', me: null, code: null });
      }
      // queda de rede ou reinício pedido pelo WhatsApp: volta sozinho
      setState(a, { state: auth.creds.registered ? 'connecting' : a.state.state });
      setTimeout(() => { if (s === a.sock) connect(a).catch(e => log(e.message)); }, code === DisconnectReason.restartRequired ? 200 : 3000);
    }
  });
  s.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      const jid = m.key.remoteJid ?? '';
      if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@newsletter')) continue; // grupos e status ficam de fora
      if (sentIds.has(m.key.id)) continue;
      const text = m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? m.message?.imageMessage?.caption ?? null;
      if (!text?.trim()) continue;
      const pn = jid.endsWith('@s.whatsapp.net') ? jid : m.key.remoteJidAlt ?? m.key.senderPn ?? null;
      const me = a.state.me;
      const self = !!me && (jidNormalizedUser(jid) === me.id || (me.lid && jidNormalizedUser(jid) === me.lid));
      emit('message', { account: a.id, id: m.key.id, chat: jid, phone: pn ? digits(pn.split('@')[0]) : null, name: m.pushName ?? null, fromMe: !!m.key.fromMe, self, text: text.trim(), at: Number(m.messageTimestamp ?? 0) * 1000 || Date.now() });
    }
  });
}

/** destino: um chat que já falou com a gente (jid) ou um número (só dígitos, com DDI) */
async function target(a, to) {
  if (String(to).includes('@')) return to;
  const n = digits(to);
  if (n.length < 10) throw new Error('Número inválido: use DDI + DDD + número (ex.: 5511999998888).');
  const [hit] = (await a.sock.onWhatsApp(n)) ?? [];
  if (!hit?.exists) throw new Error(`O número ${n} não tem WhatsApp.`);
  return hit.jid;
}

const open = account => {
  const a = accounts.get(account ?? 'main');
  if (!a || a.state.state !== 'open' || !a.sock) throw new Error('Esse número do WhatsApp não está conectado.');
  return a;
};

const calls = {
  status: async () => [...accounts.values()].map(a => ({ account: a.id, ...a.state })),
  async pair({ account, phone }) {
    const n = digits(phone);
    if (n.length < 10) throw new Error('Digite o número com DDI e DDD (ex.: 55 11 99999-8888).');
    if (!/^[\w-]{1,40}$/.test(account ?? '')) throw new Error('Conta inválida.');
    const a = acc(account);
    if (a.state.state === 'open') throw new Error('Esse número já está conectado. Desconecte antes de vincular outro.');
    a.pairing = n;
    a.sock?.end(undefined);
    a.sock = null;
    rmSync(authOf(a.id), { recursive: true, force: true });
    setState(a, { state: 'pairing', code: null });
    await connect(a);
    return { ok: true }; // o código chega pelo evento de status
  },
  async send({ account, to, text }) {
    const a = open(account);
    if (!String(text ?? '').trim()) throw new Error('Mensagem vazia.');
    const job = a.queue.then(async () => {
      const jid = await target(a, to);
      await a.sock.sendPresenceUpdate('composing', jid).catch(() => {});
      await sleep(Math.min(600 + text.length * 15, 2500));
      const r = await a.sock.sendMessage(jid, { text: String(text) });
      if (r?.key?.id) markSent(r.key.id);
      await a.sock.sendPresenceUpdate('paused', jid).catch(() => {});
      await sleep(1200);
      return { id: r?.key?.id ?? null, jid };
    });
    a.queue = job.catch(() => {});
    return job;
  },
  async typing({ account, to }) {
    const a = accounts.get(account ?? 'main');
    if (a?.sock && a.state.state === 'open') await a.sock.sendPresenceUpdate('composing', await target(a, to)).catch(() => {});
    return { ok: true };
  },
  async logout({ account }) {
    const a = acc(account ?? 'main');
    try { await a.sock?.logout(); } catch { /* já caiu */ }
    a.sock = null;
    a.pairing = null;
    rmSync(join(accountsDir, a.id), { recursive: true, force: true });
    accounts.delete(a.id);
    emit('status', { account: a.id, state: 'disconnected', me: null, code: null, removed: true });
    return { ok: true };
  },
};

port.on('message', async e => {
  const { id, call, args } = e.data ?? {};
  try { port.postMessage({ id, result: await calls[call](args ?? {}) }); }
  catch (err) { port.postMessage({ id, error: err?.message ?? String(err) }); }
});

// números já vinculados antes: reconectam sozinhos
mkdirSync(accountsDir, { recursive: true });
for (const id of readdirSync(accountsDir)) {
  if (!existsSync(join(authOf(id), 'creds.json'))) continue;
  const a = acc(id);
  setState(a, { state: 'connecting' });
  connect(a).catch(e => log(e.message));
}
emit('ready', null);
