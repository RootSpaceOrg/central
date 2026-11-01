# Central — plano (v3, app desktop)

Pesquisa de base: `reports/Central orquestradora para dev solo.md`.

## Princípio

**A Central trabalha, você julga.** Sem perguntar o humor do dia:
- **Com gás**: abre o projeto e cria sessões (conversa com o Claude, Claude Code, PowerShell, CMD, Git Bash), como no Orca.
- **Sem gás**: o Início já mostra o que espera você (PRs para revisar, decisões, falhas). Aprovar é o trabalho.
- **Inquietação = piloto automático**: de madrugada, cada projeto ligado pega a tarefa do topo de "A fazer" e um agente
  leva até um PR rascunho. Entrega trabalho pronto, não mais propostas.
  Travas: só tarefas que você escreveu ou aprovou; nada novo enquanto houver uma em revisão; pula com a cota alta.

Cada tipo de projeto tem seu gatilho: **evoluir** (Ativo + piloto) é proativo, **suporte** (Manutenção) só reage
a sinais (CI, Sentry, issues), **automações** (rotinas de agentes) aparecem no Início com a saúde de cada uma.

## Arquitetura

```
 Electron (app desktop, instalador Windows)
 ├─ main (TypeScript)   SQLite embutido · git · node-pty · agentes (claude -p em worktree) · gh
 └─ interface (Angular + Tailwind)
      Visão geral   pulso de commits 14 dias por projeto, o que foi feito, o que espera você
      Decisões      uma decisão por vez, anotar ideia, aprovadas → agente
      Agentes       fila, log ao vivo, custo, PR, interromper
      Projeto       Resumo (repos, atividade 30 dias, decisões) · Código (árvore, Monaco, terminais,
                    Claude Code) · Agentes
```

- **Projeto = pasta** em `Development` com todos os repos dentro. "Adicionar projeto" cria a pasta e
  clona repos de qualquer conta/org do GitHub.
- **Agente** = `claude -p` numa worktree em `Development\.central-worktrees\<projeto>`, branch
  `central/run-N-…`, teto de gasto, liberdade Segura (edita + git/gh/npm/python) ou Total.
  Termina commitando, fazendo push e abrindo PR draft. Até 4 em paralelo, o resto na fila.
- Nada sai da máquina além do que git/gh/claude já fazem.

## Feito (v0.2)

- App desktop instalável, banco local, 12 projetos mapeados das suas pastas (183 repos, 60 dias de commits).
- Visão geral, Decisões, Agentes, Projeto com IDE (Monaco + terminais + Claude Code interativo).
- Adicionar projeto com pasta no seu padrão e clone do GitHub; clonar em projeto existente.
- Agente de ponta a ponta testado: worktree isolada → commit → resultado e custo na tela.

## Feito (v0.3)

- **Início** (quickstart): "como está a energia hoje?" → modo leve (decidir, delegar, uma ideia) ou com gás
  (atalhos, retomar projetos, em andamento). Sempre: o que os agentes fizeram desde a última visita,
  cota do Claude com recomendação, agentes agora, anotar ideia.
- **Ideias**: base de ideias (anotar, filtrar, atribuir projeto, virar tarefa, arquivar).
- **Backlog/Kanban**: Backlog → A fazer → Fazendo → Revisão → Feito, arrastar entre colunas, por projeto ou geral.
  Aprovar decisão cria tarefa em A fazer; agente move a tarefa sozinho (Fazendo → Revisão, ou volta se falhar).
- **M2 (importar pendências)**: memórias de projeto do Claude, itens `- [ ]` de ROADMAP/PLAN/TODO e seus PRs
  abertos (viram tarefas em Revisão). Idempotente.
- **M3 (turno)**: escolhe tarefas + repo de cada uma, horário limite e teto total; agentes em paralelo,
  parados no horário, resumo no Início. Testado: 2 tarefas, 2 commits, US$ 0,40.
- Ícones Material Symbols; rodapé com uso do Claude (sessão, semana, por modelo) como no Orca.

## Feito (v0.5)

- **Agente Central** (Ctrl+J ou o primeiro ícone da barra): chat que conhece e altera tudo pela Central,
  com projetos, backlog, ideias, decisões, agentes, turnos, rotinas e cota. Cada conversa é uma sessão do Claude Code (`--resume`).
- **MCP da Central** (HTTP local, token por execução): 30 ferramentas. Ligado no agente Central, nos agentes,
  nas rotinas e no terminal "Claude Code": as sessões registram follow-ups, ideias e decisões no backlog.
- **Agentes sem repositório**: escopo "projeto inteiro" (pasta, sem worktree; seguro = só lê e organiza).
  Tamanho (Pequeno/Médio/Grande) no lugar de US$; consumo medido em % da sessão do plano.
- **Rotinas**: agentes com agenda (dias + horário ou a cada N h), pulam se a sessão passar do limite.
- **PR mergeado → Feito** automático (gh, a cada sincronização e a cada 15 min).
- **Projeto editável**: nome, ícone (letra, emoji, ícone, imagem), cor, status, descrição, pasta; excluir da Central.
- Ícones Lucide com hover e tooltip; atualização pela release no GitHub (RootSpaceOrg/central).

## Feito (v0.6)

- **Agentes como papéis** (tela Agentes): nome, ícone, instruções, projeto opcional, ferramentas extras (ex.: `mcp__sentry`),
  liberdade e modelo. Exemplos: Suporte KultivAi (conversa), Sentinela de erros KultivAi e Radar de tendências (rotinas),
  Marketing (sem projeto, pasta própria em `Development/.central-agents/`).
- **Conversas** com qualquer agente: sessões salvas, renomear, apagar, markdown completo, passos recolhíveis; painel Ctrl+J
  troca de agente. **Continuar conversa** retoma a sessão de uma execução terminada.
- Execuções e rotinas sem projeto (agente com pasta própria); rotinas e tarefas com agente.
- Seletor de projeto/agente com ícone; menu de botão direito em projetos, agentes e cards do Kanban.
- **M5 (ingestão)**: sentinela de CI abre decisão quando `main` ou `develop` de um repo ativo falha no GitHub Actions.
- **M6 (scouts)**: agente Radar de tendências com rotina semanal (desligada até você ligar).
- Uso do Claude com proteção contra limite de consultas (429) e último valor salvo.

## Feito (v0.7)

- **Bandeja do Windows**: fechar a janela esconde a Central; rotinas, turnos e agentes seguem rodando. Menu na bandeja.
- **Abrir com o Windows** (minimizada na bandeja) e **notificações** (agente/rotina terminou, CI quebrou) que levam à tela certa.
- **Paleta de comandos (Ctrl+K)**: ações, telas, projetos, agentes, tarefas e ideias; sem resultado, Enter pergunta à Central.
- **Conversar sobre esta tarefa** (menu do card e diálogo da tarefa): abre o agente do projeto com o contexto escrito.
- **Preferências** (engrenagem na barra lateral).

## Feito (v0.8)

- **Sessões no projeto** (como no Orca): aba fixa de código + abas de Claude (conversa na pasta do projeto, edita código),
  Claude Code, PowerShell, CMD e Git Bash. Ficam salvas: reabrir o app volta as abas; conversas antigas do projeto retomam pelo "+".
- **Piloto automático** por projeto (botão no cabeçalho ou no Início): passada de madrugada (01h–06h) com as travas acima.
  Sem tarefa em "A fazer", abre uma decisão só (e fecha sozinha quando houver tarefa).
- **Início novo**: sem a pergunta de energia. Esperando você (revisar → decidir → falhas), piloto automático (o que fez em cada
  projeto), projetos Evoluindo e Em suporte com atalho para abrir sessão, automações (rotinas e saúde).

## Próximos marcos

| # | Marco | Pronto quando |
|---|---|---|
| M3+ | **Planejador do turno**: "objetivo + prazo + teto" vira as tarefas sozinho (hoje você escolhe as tarefas) | turno criado só com o objetivo |
| M4 | **Celular**: Central como servidor MCP + Tailscale (ou bot) para decidir e disparar de fora | turno disparado do celular em < 2 min |
| M5 | **Ingestão**: CI falho, Gmail, transcrições de reunião, WhatsApp Coexistence → decisões | bug relatado no WhatsApp vira PR com um "sim" |
| M6 | **Scouts + portfólio**: tendências, métricas próprias, revisão semanal empurra/congela/mata | primeira decisão de portfólio com dados da Central |
| M7 | **Lançador de produtos**: molde de produto novo em dias, critério de morte desde o dia 1 | ideia aprovada → produto no ar |
