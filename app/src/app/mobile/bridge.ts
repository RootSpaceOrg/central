/**
 * Celular: a tela roda no navegador (fora do Electron) e fala com a Central do PC pelo servidor dela no Tailscale.
 * Esta ponte imita o window.central do desktop: invoke vira POST /api/invoke (o PC só aceita a lista fechada de ações) e
 * on() vira os eventos de /api/events. Pareado = cookie HttpOnly que o PC entregou (o token não fica na tela).
 */
type Listener = (payload: unknown) => void;

export const isRemote = () => typeof window !== 'undefined' && !(window as unknown as { central?: unknown }).central;

/** vídeos: o central-media:// do desktop vira /media/ no servidor do PC */
export const mediaUrl = (src: string) => (isRemote() ? src.replace(/^central-media:\/\//, '/media/') : src);

export function installBridge(onUnpaired: () => void): void {
  const listeners = new Map<string, Set<Listener>>();
  let es: EventSource | null = null;
  let opened = false;
  const connect = () => {
    es = new EventSource('/api/events');
    es.onmessage = e => {
      const { channel, payload } = JSON.parse(e.data) as { channel: string; payload: unknown };
      listeners.get(channel)?.forEach(f => f(payload));
    };
    // voltou depois de cair (celular dormiu, trocou de rede): as listas recarregam
    es.onopen = () => {
      if (opened) for (const ch of ['projects:changed', 'backlog:changed', 'agents:changed', 'guides:changed']) listeners.get(ch)?.forEach(f => f(null));
      opened = true;
    };
  };
  (window as unknown as { central: unknown; __centralRemote: boolean }).__centralRemote = true;
  (window as unknown as { central: unknown }).central = {
    platform: 'web',
    async invoke(channel: string, ...args: unknown[]) {
      const r = await fetch('/api/invoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel, args }), credentials: 'same-origin' });
      if (r.status === 401) { onUnpaired(); throw new Error('Este celular não está pareado com a Central.'); }
      const j = await r.json().catch(() => ({ ok: false, error: r.statusText }));
      if (!r.ok || !j.ok) throw new Error(j.error ?? `Erro ${r.status}`);
      return j.value;
    },
    on(channel: string, cb: Listener) {
      if (!es) connect();
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(cb);
      return () => listeners.get(channel)?.delete(cb);
    },
  };
}

/** está pareado? (o cookie é HttpOnly: pergunta ao PC) */
export async function paired(): Promise<boolean> {
  try { return (await fetch('/api/me', { credentials: 'same-origin' })).ok; } catch { return false; }
}

export async function pair(code: string, name: string): Promise<string | null> {
  const r = await fetch('/api/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, name }), credentials: 'same-origin' });
  if (r.ok) return null;
  return ((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Não deu para parear.';
}
