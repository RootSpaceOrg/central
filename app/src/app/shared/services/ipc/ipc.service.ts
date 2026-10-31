import { Injectable } from '@angular/core';

import { Api, Events } from '../../contract';

interface Bridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, cb: (payload: unknown) => void): () => void;
}

declare global {
  interface Window { central: Bridge }
}

/** Wrapper base: toda conversa com o processo principal passa por aqui. */
@Injectable({ providedIn: 'root' })
export class IpcService {
  invoke<K extends keyof Api>(channel: K, ...args: Parameters<Api[K]>): Promise<Awaited<ReturnType<Api[K]>>> {
    return window.central.invoke(channel, ...args) as Promise<Awaited<ReturnType<Api[K]>>>;
  }

  on<K extends keyof Events>(channel: K, cb: (payload: Events[K]) => void): () => void {
    return window.central.on(channel, cb as (payload: unknown) => void);
  }
}

/** O Electron embrulha o erro ("Error invoking remote method 'x': Error: msg"); fica só a mensagem. */
export function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
