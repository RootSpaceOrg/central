import { Injectable, inject } from '@angular/core';

import { ChatMessageDto } from '../../contract';
import { IpcService } from '../ipc/ipc.service';

@Injectable({ providedIn: 'root' })
export class ChatApiService {
  private readonly ipc = inject(IpcService);

  list() { return this.ipc.invoke('chat:list'); }
  messages(chatId: number) { return this.ipc.invoke('chat:messages', chatId); }
  send(chatId: number | null, text: string) { return this.ipc.invoke('chat:send', chatId, text); }
  stop(chatId: number) { return this.ipc.invoke('chat:stop', chatId); }
  remove(chatId: number) { return this.ipc.invoke('chat:delete', chatId); }
  onEvent(cb: (e: { chat_id: number; message: ChatMessageDto | null; busy: boolean }) => void) { return this.ipc.on('chat:event', cb); }
}
