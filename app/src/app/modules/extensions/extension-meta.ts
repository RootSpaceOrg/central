import { IconName } from '../../shared/ui/icon';

/** Como cada extensão aparece na grade e no topo da página dela. */
export interface ExtensionMeta { icon: IconName; color: string; tagline: string; features: string[] }

export const EXTENSION_META: Record<string, ExtensionMeta> = {
  whatsapp: {
    icon: 'message', color: '#25D366', tagline: 'Agentes conversando pelo WhatsApp',
    features: ['Um agente por número conectado', 'Atendimento para quem não é da casa', 'Escuta de grupos vira ideias e decisões', 'Avisos quando um agente para esperando você'],
  },
  transcricao: {
    icon: 'mic', color: '#a78bfa', tagline: 'Áudio e vídeo viram texto',
    features: ['Ditado nos chats da Central', 'Áudios e vídeos do WhatsApp entendidos pelos agentes', 'Motor local (grátis) ou OpenAI'],
  },
};

export const metaOf = (id: string): ExtensionMeta => EXTENSION_META[id] ?? { icon: 'puzzle', color: '#7aa2f7', tagline: '', features: [] };

/** status curto de uma extensão instalada */
export const statusOf = (e: { installed: boolean; enabled: boolean; running: boolean }) =>
  !e.installed ? { label: 'Não instalada', cls: 'bg-raise text-mute' }
    : !e.enabled ? { label: 'Desabilitada', cls: 'bg-raise text-mute' }
      : e.running ? { label: 'Ligada', cls: 'bg-yes/15 text-yes' } : { label: 'Parada', cls: 'bg-later/15 text-later' };
