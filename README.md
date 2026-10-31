# Central

App desktop para tocar todos os projetos de um lugar: visão geral, decisões, agentes e uma IDE
(arquivos, editor, terminais, Claude Code). A Central trabalha, você julga. Plano em [PLANO.md](PLANO.md).

## Instalar

```bash
cd app
npm i
npm run dist          # gera app/release/Central Setup <versão>.exe
```

Rode o instalador: ele cria atalhos no menu Iniciar e na área de trabalho. Os dados ficam em
`%APPDATA%\Central\central.db` (SQLite). Os projetos ficam nas suas pastas em `Development`.

## Desenvolver

```bash
cd app
npm run dev           # interface com hot reload (porta 4300) + Electron
npm start             # build completo e abre o app
```

- `electron/`: processo principal (banco, git, terminais, agentes). Typecheck: `npx tsc -p electron/tsconfig.json`.
- `src/app/shared/contract.ts`: tudo o que a interface pode pedir ao processo principal.
- `src/app/`: interface Angular (convenções de `modules/`, `shared/`, services em duas camadas).
- `node electron/backlog.check.mjs`: self-check do filtro de arquivos do importador de pendências.

Depuração: `--data=<pasta>` usa outro banco; `--route=/projetos/x?aba=codigo` abre numa tela;
`--capture=arquivo.png` salva um print e fecha (`--exec64=<js em base64>` roda um script antes).

## Requisitos

`git`, `gh` autenticado e `claude` no PATH. Agentes usam o Claude Code do seu plano.
