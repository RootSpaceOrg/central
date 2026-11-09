import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('central', {
  /** win32, darwin, linux: a tela ajusta nomes de terminal e caminhos */
  platform: process.platform,
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, cb: (payload: unknown) => void) => {
    const listener = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
