/**
 * Central no celular: um servidor HTTP que só escuta no endereço do Tailscale (rede privada entre o PC e o celular; nada
 * aberto para a internet). Serve o app do celular (o mesmo build da tela, que sobe em "modo celular" fora do Electron) e
 * uma lista FECHADA de ações (ALLOW): o celular nunca chega nos ~200 canais da Central (agente com permissão total,
 * terminal, shell, merge ficam de fora). Pareamento por código de 6 dígitos (ou QR) mostrado no PC; o aparelho recebe um
 * token guardado num cookie HttpOnly (só o hash fica no banco). Texto que vem do celular chega aos agentes marcado.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { IncomingMessage, Server, ServerResponse, createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize } from 'node:path';
import QRCode from 'qrcode';

import { getSetting, setSetting } from './backlog';

export const REMOTE_PORT = 4790;

/** o que o celular pode chamar (o resto responde 403) */
export const ALLOW = new Set<string>([
  // ler
  'projects:list', 'agents:list', 'cockpit:get', 'proposals:list', 'deliveries:board', 'deliveries:list', 'guides:list',
  'chat:list', 'chat:messages', 'activity:list', 'owner:get', 'runs:list', 'tasks:list', 'settings:get', 'settings:set', 'stt:status',
  // decidir e revisar (aprovar sem merge)
  'proposals:decide', 'deliveries:review', 'deliveries:adjust',
  // 1:1 em rodadas
  'guides:answer', 'guides:submitRound', 'guides:moreRound', 'guides:plan', 'guides:item', 'guides:approve',
  // conversar com os agentes
  'chat:send', 'chat:stop', 'proposals:chat',
]);
/** chaves de configuração que o celular pode ler (nada de chave de API, token, etc.) */
const SETTINGS_ALLOW = new Set(['chief:chat', 'chat:last', 'stt:dictation']);
/** e as que pode gravar (só preferência de tela) */
const SETTINGS_WRITE = new Set(['chat:last']);
/** eventos que vão para o celular (atualizar a tela) */
export const EVENTS = new Set<string>(['projects:changed', 'backlog:changed', 'agents:changed', 'guides:changed', 'chat:event', 'chat:stream', 'run:update', 'activity']);

type Handler = (...args: any[]) => unknown;
interface Deps { handlers: Map<string, Handler>; webRoot: string; media: (kind: string, name: string) => string | null; changed: () => void }

let server: Server | null = null;
let boundIp: string | null = null;
let deps: Deps | null = null;
const clients = new Set<ServerResponse>();
let pairing: { code: string; until: number } | null = null;
const fails = { n: 0, until: 0 };

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
interface Device { hash: string; name: string; created: string; last: string | null }
const devices = (): Device[] => { try { return JSON.parse(getSetting('remote:devices') ?? '[]'); } catch { return []; } };
const saveDevices = (d: Device[]) => setSetting('remote:devices', JSON.stringify(d));

/** endereço do Tailscale (faixa 100.64.0.0/10) neste PC; null = Tailscale desligado ou sem login */
export function tailscaleIp(): string | null {
  for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) {
    if (a.family !== 'IPv4' || a.internal) continue;
    const [x, y] = a.address.split('.').map(Number);
    if (x === 100 && y >= 64 && y <= 127) return a.address;
  }
  return null;
}

export const remoteOn = () => getSetting('remote:on') === '1';

export async function remoteStatus() {
  const ip = tailscaleIp();
  const url = boundIp ? `http://${boundIp}:${REMOTE_PORT}` : null;
  return {
    on: remoteOn(), tailscale: !!ip, ip, running: !!server, url,
    pairing: pairing && pairing.until > Date.now() && url ? { code: pairing.code, until: new Date(pairing.until).toISOString(), qr: await QRCode.toDataURL(`${url}/#/parear/${pairing.code}`, { margin: 1, width: 240 }) } : null,
    devices: devices().map(d => ({ id: d.hash.slice(0, 12), name: d.name, created: d.created, last: d.last })),
  };
}

export function setRemote(on: boolean): void { setSetting('remote:on', on ? '1' : '0'); syncRemote(); }

/** novo código de pareamento (vale 10 min) */
export function newPairing(): void { pairing = { code: process.env.CENTRAL_REMOTE_TESTCODE || String(Math.floor(100000 + Math.random() * 900000)), until: Date.now() + 10 * 60_000 }; deps?.changed(); }

export function revokeDevice(id: string): void { saveDevices(devices().filter(d => !d.hash.startsWith(id))); deps?.changed(); }

/** liga/desliga conforme a configuração e o Tailscale (chamado ao abrir e de tempos em tempos: o Tailscale pode subir depois) */
export function syncRemote(): void {
  // teste: CENTRAL_REMOTE_HOST força outro endereço (127.0.0.1); no uso normal, só o do Tailscale
  const want = remoteOn() ? (process.env.CENTRAL_REMOTE_HOST || tailscaleIp()) : null;
  if (server && boundIp === want) return;
  if (server) { for (const c of clients) c.end(); clients.clear(); server.close(); server = null; boundIp = null; }
  if (!want || !deps) { deps?.changed(); return; }
  const s = createServer((req, res) => handle(req, res).catch(e => send(res, 500, { error: String((e as Error)?.message ?? e) })));
  s.on('error', e => { console.error('remoto', e); server = null; boundIp = null; deps?.changed(); });
  // só no endereço do Tailscale: nunca 0.0.0.0 (a rede de casa e a internet não chegam aqui)
  s.listen(REMOTE_PORT, want, () => { boundIp = want; deps?.changed(); });
  server = s;
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startRemote(d: Deps): void {
  deps = d;
  syncRemote();
  timer = setInterval(syncRemote, 30_000);
}

/** desliga tudo (fecha as conexões abertas e o vigia do Tailscale) */
export function stopRemote(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  for (const c of clients) c.end();
  clients.clear();
  const s = server;
  server = null; boundIp = null;
  if (!s) return Promise.resolve();
  s.closeAllConnections();
  return new Promise(res => s.close(() => res()));
}

/** evento da Central → celulares conectados (só os da lista) */
export function remoteBroadcast(channel: string, payload: unknown): void {
  if (!clients.size || !EVENTS.has(channel)) return;
  const data = `data: ${JSON.stringify({ channel, payload })}\n\n`;
  for (const c of clients) c.write(data);
}

// ---------- HTTP ----------

const send = (res: ServerResponse, status: number, body: unknown): void => {
  if (res.headersSent) { res.end(); return; }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body ?? null));
};
const cookieToken = (req: IncomingMessage) => /(?:^|;\s*)central_t=([a-f0-9]{64})/.exec(req.headers.cookie ?? '')?.[1] ?? null;

/** o aparelho pareado (pelo cookie); atualiza o "visto por último" */
function device(req: IncomingMessage): Device | null {
  const t = cookieToken(req);
  if (!t) return null;
  const h = Buffer.from(sha(t), 'hex');
  const list = devices();
  const d = list.find(x => { const b = Buffer.from(x.hash, 'hex'); return b.length === h.length && timingSafeEqual(b, h); });
  if (d && (!d.last || Date.now() - Date.parse(d.last) > 60_000)) { d.last = new Date().toISOString(); saveDevices(list); }
  return d ?? null;
}

async function body(req: IncomingMessage): Promise<any> {
  let size = 0; const parts: Buffer[] = [];
  for await (const c of req) { size += (c as Buffer).length; if (size > 1_000_000) throw new Error('Pedido grande demais.'); parts.push(c as Buffer); }
  return parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {};
}

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4', '.webm': 'video/webm', '.gif': 'image/gif' };

/** arquivo com suporte a pedido de trecho (vídeo no iPhone precisa de 206) */
function file(req: IncomingMessage, res: ServerResponse, path: string, cache = false): void {
  const size = statSync(path).size;
  const type = TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (!m) { res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes', 'cache-control': cache ? 'max-age=3600' : 'no-cache' }); createReadStream(path).pipe(res); return; }
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start >= size || start > end) { res.writeHead(416, { 'content-range': `bytes */${size}` }); res.end(); return; }
  res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes' });
  createReadStream(path, { start, end }).pipe(res);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://x');
  const d = deps!;

  // parear: o código de 6 dígitos que aparece no PC vira um token (cookie HttpOnly) deste aparelho
  if (url.pathname === '/api/pair' && req.method === 'POST') {
    if (Date.now() < fails.until) return send(res, 429, { error: 'Muitas tentativas. Espere alguns minutos.' });
    const { code, name } = await body(req);
    if (!pairing || pairing.until < Date.now() || String(code) !== pairing.code) {
      if (++fails.n >= 5) { fails.n = 0; fails.until = Date.now() + 10 * 60_000; pairing = null; }
      return send(res, 403, { error: 'Código errado ou vencido. Gere outro no PC (Utils > Celular).' });
    }
    fails.n = 0; pairing = null;
    const token = randomBytes(32).toString('hex');
    saveDevices([...devices(), { hash: sha(token), name: String(name || 'Celular').slice(0, 60), created: new Date().toISOString(), last: null }]);
    res.setHeader('set-cookie', `central_t=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24 * 365}`);
    d.changed();
    return send(res, 200, { ok: true });
  }

  // o app (arquivos do build): livre, não tem dado nenhum
  if (req.method === 'GET' && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/media/')) {
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/, '');
    const p = join(d.webRoot, rel);
    if (rel && p.startsWith(d.webRoot) && existsSync(p) && statSync(p).isFile()) return file(req, res, p, true);
    return file(req, res, join(d.webRoot, 'index.html'));
  }

  const dev = device(req);
  if (!dev) return send(res, 401, { error: 'Este aparelho não está pareado.' });

  if (url.pathname === '/api/me') return send(res, 200, { name: dev.name });

  // eventos da Central (Server-Sent Events)
  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(': ok\n\n');
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  // vídeos das entregas e gravações (o mesmo que o central-media:// do desktop)
  const media = /^\/media\/(v|m)\/(.+)$/.exec(url.pathname);
  if (media) {
    const p = d.media(media[1], decodeURIComponent(media[2]));
    return p && existsSync(p) ? file(req, res, p) : send(res, 404, { error: 'não encontrado' });
  }

  if (url.pathname === '/api/invoke' && req.method === 'POST') {
    const { channel, args } = await body(req);
    if (!ALLOW.has(channel)) return send(res, 403, { error: `"${channel}" não está liberado no celular.` });
    const fn = d.handlers.get(channel);
    if (!fn) return send(res, 404, { error: `canal ${channel} não existe` });
    let a: unknown[] = Array.isArray(args) ? args : [];
    if (channel === 'settings:get' && !SETTINGS_ALLOW.has(String(a[0]))) return send(res, 403, { error: 'configuração não liberada' });
    if (channel === 'settings:set' && !SETTINGS_WRITE.has(String(a[0]))) return send(res, 403, { error: 'configuração não liberada' });
    // o que você escreve pelo celular chega aos agentes marcado (eles sabem que veio de fora do PC)
    if (channel === 'chat:send' && typeof a[2] === 'string') a = [a[0], a[1], `📱 ${a[2]}`, ...a.slice(3)];
    try { return send(res, 200, { ok: true, value: await fn(...a) }); }
    catch (e) { return send(res, 200, { ok: false, error: (e as Error).message }); }
  }
  return send(res, 404, { error: 'não encontrado' });
}
