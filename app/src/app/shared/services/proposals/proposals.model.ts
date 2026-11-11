import { ProposalStatus, Verdict } from '../../contract';

export type { ProposalStatus, Verdict };
export type RiskTier = 0 | 1 | 2;

export interface Proposal {
  id: number;
  projectSlug: string | null;
  title: string;
  body: string | null;
  tier: RiskTier | null;
  attentionMin: number | null;
  nextAction: string | null;
  status: ProposalStatus;
  source: string;
  createdAt: Date;
  /** a tarefa sobre a qual é a escolha */
  taskId: number | null;
  summary: string | null;
  /** respostas prontas sugeridas pelo agente */
  options: string[];
  /** agente que criou (quem recebe o direcionamento) */
  agentId: number | null;
}

export const RISK_LABEL: Record<RiskTier, string> = { 0: 'risco baixo', 1: 'risco médio', 2: 'risco alto' };
export const SOURCE_LABEL: Record<string, string> = { manual: 'anotado por você', memory: 'das suas notas', pr: 'PR aberto', rumo: 'rumo proposto pelo dono', insight: 'insight' };

/** Texto pronto para mandar a proposta a um agente. */
export function proposalPrompt(p: Proposal): string {
  return [p.title, p.body, p.nextAction && `Próximo passo esperado: ${p.nextAction}`].filter(Boolean).join('\n\n');
}
