/**
 * Mídia para os agentes (usa a extensão "transcricao"): áudio vira texto, vídeo vira quadros + fala.
 * Motor local (whisper.cpp) ou OpenAI; a chave da OpenAI fica criptografada pelo Windows (safeStorage, DPAPI) e só vai
 * para a extensão no pedido.
 */
import { safeStorage } from 'electron';

import { getSetting, setSetting } from './backlog';
import { callExtension, installed, onExtensionEvent, running } from './extensions';

const EXT = 'transcricao';
export type SttEngine = 'local' | 'openai';
export interface SttConfig { engine: SttEngine; model: 'small' | 'base'; openaiModel: string; hasKey: boolean }

let extStatus: { whisper: boolean; ffmpeg: boolean; models: { small: boolean; base: boolean }; progress: { name: string; done: number; total: number } | null; error: string | null } | null = null;
let onChange: () => void = () => {};

export function initMedia(changed: () => void): void {
  onChange = changed;
  onExtensionEvent(EXT, (event, data) => { if (event === 'status' && !data.stopped) { extStatus = data; onChange(); } });
}

export const sttConfig = (): SttConfig => ({
  engine: getSetting('stt:engine') === 'openai' ? 'openai' : 'local',
  model: getSetting('stt:model') === 'base' ? 'base' : 'small',
  openaiModel: getSetting('stt:openai_model') || 'gpt-4o-transcribe',
  hasKey: !!getSetting('stt:openai_key'),
});

export function setSttConfig(patch: { engine?: SttEngine; model?: 'small' | 'base'; openaiModel?: string; key?: string | null }): void {
  if (patch.engine) setSetting('stt:engine', patch.engine === 'openai' ? 'openai' : 'local');
  if (patch.model) setSetting('stt:model', patch.model === 'base' ? 'base' : 'small');
  if (patch.openaiModel !== undefined) setSetting('stt:openai_model', patch.openaiModel.trim());
  if (patch.key !== undefined) {
    if (!patch.key) setSetting('stt:openai_key', '');
    else {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('O Windows não ofereceu criptografia para guardar a chave.');
      setSetting('stt:openai_key', safeStorage.encryptString(patch.key.trim()).toString('base64'));
    }
  }
  onChange();
}

const apiKey = () => {
  const v = getSetting('stt:openai_key');
  return v ? safeStorage.decryptString(Buffer.from(v, 'base64')) : undefined;
};

export const sttStatus = () => ({ installed: installed(EXT), running: running(EXT), ...sttConfig(), ext: extStatus });
export const mediaReady = () => running(EXT) && (sttConfig().engine === 'openai' ? sttConfig().hasKey : !!extStatus?.whisper && !!extStatus.models[sttConfig().model]);

/** motor local: whisper + ffmpeg + modelo; com a OpenAI, só o ffmpeg (para vídeo) */
export const prepareLocal = () => callExtension(EXT, 'setup', sttConfig().engine === 'openai' ? { only: 'ffmpeg' } : { model: sttConfig().model }, 30 * 60_000);

const engineArgs = () => { const c = sttConfig(); return { engine: c.engine, model: c.model, openaiModel: c.openaiModel, apiKey: c.engine === 'openai' ? apiKey() : undefined }; };

/** áudio → texto (minutos de áudio podem levar alguns minutos no processador) */
export const transcribeFile = (path: string) =>
  callExtension<{ text: string; seconds: number | null; engine: string }>(EXT, 'transcribe', { path, ...engineArgs() }, 20 * 60_000);

/** vídeo → quadros (imagens) + fala; out = onde salvar os quadros */
export const analyzeVideo = (path: string, out?: string, frames = 8) =>
  callExtension<{ frames: string[]; transcript: string; seconds: number }>(EXT, 'video', { path, out, frames, ...engineArgs() }, 20 * 60_000);
