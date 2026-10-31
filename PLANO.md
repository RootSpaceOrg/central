# Central — plano (v3, app desktop)

Pesquisa de base: `reports/Central orquestradora para dev solo.md`.

## Princípio

**A Central trabalha, você julga.** Dois modos na mesma máquina:
- **Piloto** (motivado): abre o projeto, código + terminal + Claude Code na mesma tela, despacha agentes.
- **Sugestão** (sem energia): abre Decisões, uma por vez, A/D/N. O que aprova vira tarefa de agente.

Turno noturno é decisão pontual ("deixa X evoluindo esta noite, teto US$N"), não rotina.

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

## Próximos marcos

| # | Marco | Pronto quando |
|---|---|---|
| M3+ | **Planejador do turno**: "objetivo + prazo + teto" vira as tarefas sozinho (hoje você escolhe as tarefas) | turno criado só com o objetivo |
| M4 | **Celular**: Central como servidor MCP + Tailscale (ou bot) para decidir e disparar de fora | turno disparado do celular em < 2 min |
| M5 | **Ingestão**: CI falho, Gmail, transcrições de reunião, WhatsApp Coexistence → decisões | bug relatado no WhatsApp vira PR com um "sim" |
| M6 | **Scouts + portfólio**: tendências, métricas próprias, revisão semanal empurra/congela/mata | primeira decisão de portfólio com dados da Central |
| M7 | **Lançador de produtos**: molde de produto novo em dias, critério de morte desde o dia 1 | ideia aprovada → produto no ar |
