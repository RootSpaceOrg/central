/**
 * Insights: o que chega de fora (reunião, conversa de WhatsApp, feedback) e pode mexer nos projetos. Vai para o dono do
 * projeto (evento "insight"), que separa ruído, age no que é pequeno e no rumo, e leva o impactante ao Gustavo. Projeto sem
 * dono ligado: vira ideia na Triagem, como antes.
 */
import { createIdea } from './backlog';
import { get } from './db';
import { emitEvent } from './owner';

export const MEETING_HEAD = '[reunião]';

/** entrega um insight a quem cuida do projeto */
export function addInsight(slug: string, text: string, fromRun: number | null, author: string): string {
  if (!get('select 1 from projects where slug = ?', slug)) throw new Error(`Projeto ${slug} não existe (list_projects).`);
  if (get<{ o: number }>('select owner_on o from projects where slug = ?', slug)?.o) {
    emitEvent(slug, 'insight', `insight:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`, text, fromRun);
    return 'Insight entregue ao dono do projeto: ele decide se age, guarda ou leva ao Gustavo.';
  }
  const i = createIdea({ project_slug: slug, title: text.split(/[.\n]/)[0].slice(0, 120), body: text, source: 'insight', author });
  return `O projeto não tem dono ligado: virou a ideia #${i.id} na Triagem.`;
}

/** Lê a transcrição de uma reunião e tira dela o que importa para os projetos (insights), ignorando conversa solta. */
export function meetingPrompt(title: string, transcript: string, slug: string | null): string {
  const text = transcript.length > 60_000 ? `${transcript.slice(0, 60_000)}\n[… transcrição cortada]` : transcript;
  return `${MEETING_HEAD} ${title}
Transcrição de uma reunião do Gustavo${slug ? ` (projeto ${slug})` : ''}. Você está lendo, não participando.

${text}

Tire daqui só o que tem consequência para os projetos dele: pedido ou reclamação de cliente, decisão tomada, prazo, prioridade
que mudou, problema relatado, ideia levada a sério. Brincadeira, conversa solta, hipótese jogada no ar e opinião sem
consequência: ignore. Na dúvida se foi decidido, registre como insight dizendo que é dúvida (o dono pergunta).
- Para cada item: add_insight no projeto certo (list_projects), com quem disse, o que foi dito (trecho curto) e o que pede.
- Junte o que é a mesma coisa num insight só. Não crie tarefas nem decisões aqui: quem decide é o dono do projeto.
- Fato durável sobre uma pessoa ou cliente (quem é, o que prefere): remember (para: todos).
Termine com a lista curta do que registrou (projeto: insight) ou "nada relevante".`;
}
