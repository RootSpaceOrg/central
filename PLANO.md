# Central — plano (v3, app desktop)

Pesquisa de base: `reports/Central orquestradora para dev solo.md`.

## Princípio

**Você é o gestor: aponta o caminho e aprova. Os agentes fazem quando você pede.**

```
Você (gestor) ── aponta o rumo, faz a triagem, pede
├─ Agente Central ── braço direito: conversa, mantém rumos, triagem junto, delega
└─ Projeto
   ├─ Rumo ........ para onde vamos (objetivo, foco agora, não fazer); você escreve, agentes propõem ajuste; com histórico
   ├─ Ideias ...... insumo (suas ou de agentes) → triagem → aprovadas = issues
   ├─ Tarefas ..... pedaços executáveis, nascem das ideias aprovadas (o gestor do projeto quebra)
   ├─ Conhecimento  memória + índice de código: como as coisas são
   └─ Agentes ..... gestor do projeto (planeja a pedido), executores (tarefa → PR), suporte/Sentry (rotinas)
```

- **Com gás**: abre o projeto e cria sessões; ou a Grade com várias sessões de projetos diferentes.
- **Gestão**: Triagem (decisões + ideias novas, A/D/N) → rumo de cada projeto → "Planejar backlog" (gestor) → turno ou agentes.
- Nada roda sozinho sem pedido além das rotinas que você ligou (Sentry, radar…) e dos turnos que você marcou.

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

## Feito (v0.9)

- **Grade** (ícone na barra lateral): sessões de qualquer projeto lado a lado. Cada painel divide à direita ou para baixo,
  as divisórias redimensionam (duplo clique iguala) e o cabeçalho arrasta o painel: solte na borda de outro para encaixar
  ao lado, no centro para trocar. Um terminal é o mesmo processo na aba do projeto e na Grade.
- **Presets de janela**: cada grade tem nome e salva sozinha (modelos: um painel, duas colunas, principal + 2, 2 × 2,
  três colunas; duplicar, renomear, excluir). "Levar para a Grade" no botão direito de uma aba do projeto.
- **Modo foco** (F11 ou botão Foco): tela cheia só com a grade.
- Ícones originais das ferramentas (Claude, PowerShell, CMD, Git Bash) nas abas, menus, painéis e no Início.

## Feito (v0.10)

- **Contexto do projeto** (aba Contexto; pesquisa em `reports/contexto-de-codigo.md`):
  - **Índice de código local**: tree-sitter (WASM) lê TypeScript/Angular, Python e Terraform num processo à parte; símbolos,
    imports, chamadas, inject, e as ligações do stack (Angular `http.get` → rota → API Gateway → Lambda → handler Python).
    Incremental (tamanho/data/hash) e acompanha mudanças sozinho. KultivAi: 2 mil arquivos em ~14 s.
  - **Mapa do código** ranqueado (PageRank personalizado pela tarefa, estilo Aider) dentro de um orçamento de tokens, injetado no
    prompt de execuções, agentes de projeto e sessões; prévia exata na aba ("Prompt").
  - **Ferramentas MCP**: `code_map`, `code_search`, `code_symbol`, `code_neighbors`, `code_impact`, `memory_recall`,
    `memory_remember`, `memory_supersede`.
  - **Memória do projeto**: fatos (decisão, convenção, armadilha…) com autor, fonte e histórico (retirar ≠ apagar), ligados a
    arquivos/símbolos; importa a auto memory do Claude Code.
  - **Grafo** (sigma.js/WebGL): arquivos ou pastas, cor por repositório ou comunidade, camadas de memória e do que os agentes
    leram/editaram, busca, foco nos vizinhos, painel do nó (ligações, símbolos, código, memória, "Perguntar ao Claude").
- **Importar sessões do Claude Code** (Orca, terminal) para um projeto, com o histórico; sessões passam a conhecer a Central.
- **Grade**: várias sessões de uma vez, "+" no painel, minimapa com prévia ao arrastar, animação e fundo quadriculado.
- **Piloto automático com direção**: para onde levar o projeto + autonomia (só aprovadas, propor, planejar e fazer).
- Ícone novo; correção ao editar projeto com imagem.

## Feito (v0.11)

- **Rumo do projeto** (aba Rumo, no lugar do Resumo): texto curto com objetivo/foco/não fazer, histórico de quem mudou e por quê;
  vai em todo prompt de agente do projeto; aparece nos cartões do Início.
- **Gestor do projeto sob demanda** ("Planejar backlog", no Início, no projeto e na triagem; ou pelo chat via `plan_backlog`): lê rumo,
  ideias aprovadas, backlog, memória e código; quebra ideias em tarefas ligadas a elas e reordena pelo rumo. Não executa.
- **Ideias com ciclo de vida**: para triar → aprovadas → em andamento (com progresso das tarefas) → feitas; ou descartadas.
- **Triagem** (no lugar de Decisões): decisões e ideias novas numa fila só, uma de cada vez.
- **Piloto automático removido**: agentes agem quando você pede (botão, chat, turno, rotina).
- **Mapa do código** (aba Contexto) com Cytoscape e navegação por pastas: cada nível mostra só o conteúdo de uma pasta, áreas de fora
  só quando se ligam; grade de cartões nos níveis só de pastas.
- MCP: `get_direction`, `update_direction`, `plan_backlog`; ideias com status e `create_task` com `idea_id`.

## Feito (v0.12)

- **Subprojetos (frentes)**: um projeto vira grupo (ex.: MatrizTech › Livros e Plataforma; frontend/backend). Cada frente tem pasta,
  repositórios, rumo, backlog e sessões próprios e recebe também o rumo do grupo; repositório numa subpasta fica com a frente.
  "Criar subprojeto" no botão direito, "+ frente" no cabeçalho, "Faz parte de" ao editar.
- **Barra lateral reordenável** (arrastar), grupos recolhíveis com as frentes aninhadas.
- **Conversas leves**: só as últimas 60 mensagens são desenhadas (mais ao rolar para cima, sem pular), itens fora da tela não são
  pintados, mensagens ficam em cache por conversa (trocar de aba não recarrega), rascunho por conversa.
- **Preferências → Chat das sessões**: tamanho do texto (11–18 px, Ctrl +/−/0) e largura (estreita → toda a área).

## Próximos marcos

| # | Marco | Pronto quando |
|---|---|---|
| M3+ | **Planejador do turno**: "objetivo + prazo + teto" vira as tarefas sozinho (hoje você escolhe as tarefas) | turno criado só com o objetivo |
| M8 | **Contexto, medição** | A/B de tokens por projeto (com e sem mapa); embeddings locais só se a medição pedir | ≥ 25% menos tokens sem piorar |
| M4 | **Celular**: Central como servidor MCP + Tailscale (ou bot) para decidir e disparar de fora | turno disparado do celular em < 2 min |
| M5 | **Ingestão**: CI falho, Gmail, transcrições de reunião, WhatsApp Coexistence → decisões | bug relatado no WhatsApp vira PR com um "sim" |
| M6 | **Scouts + portfólio**: tendências, métricas próprias, revisão semanal empurra/congela/mata | primeira decisão de portfólio com dados da Central |
| M7 | **Lançador de produtos**: molde de produto novo em dias, critério de morte desde o dia 1 | ideia aprovada → produto no ar |
