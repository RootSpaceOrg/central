import { Injectable, inject } from '@angular/core';

import { ChatMessageDto, ChatOptions } from '../../contract';
import { IpcService } from '../ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class ChatApiService {
  private readonly ipc = inject(IpcService);

  list(agentId: number | null) { return this.ipc.invoke('chat:list', agentId); }
  messages(chatId: number) { return this.ipc.invoke('chat:messages', chatId); }
  send(chatId: number | null, agentId: number, text: string, projectSlug: string | null = null, options: ChatOptions | null = null) {
    return this.ipc.invoke('chat:send', chatId, agentId, text, projectSlug, options);
  }
  setChief(chatId: number | null) { return this.ipc.invoke('chief:set', chatId); }
  onChiefChanged(cb: (chatId: number) => void) { return this.ipc.on('chief:changed', cb); }
  fromRun(runId: number) { return this.ipc.invoke('chat:fromRun', runId); }
  rename(chatId: number, title: string) { return this.ipc.invoke('chat:rename', chatId, title); }
  stop(chatId: number) { return this.ipc.invoke('chat:stop', chatId); }
  remove(chatId: number) { return this.ipc.invoke('chat:delete', chatId); }
  grant(chatId: number, kind: 'dir' | 'tool', value: string) { return this.ipc.invoke('chat:grant', chatId, kind, value); }
  yolo(chatId: number, on: boolean) { return this.ipc.invoke('chat:yolo', chatId, on); }
  onStream(cb: (e: { chat_id: number; text: string }) => void) { return this.ipc.on('chat:stream', cb); }
  onEvent(cb: (e: { chat_id: number; message: ChatMessageDto | null; busy: boolean }) => void) { return this.ipc.on('chat:event', cb); }
}
