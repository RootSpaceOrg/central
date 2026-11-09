# Central

App desktop para tocar todos os projetos de um lugar: visão geral, decisões, agentes e uma IDE
(arquivos, editor, terminais, Claude Code). A Central trabalha, você julga. Plano em [PLANO.md](PLANO.md).

## Instalar

Baixe a última versão em **[Releases](https://github.com/RootSpaceOrg/central/releases/latest)** (não precisa de conta
no GitHub). Depois de instalada, a Central se atualiza pelo botão de atualização dela.

### Requisitos (Windows e Mac)

- **Claude Code** (`claude`) logado na sua conta: os agentes usam o seu plano do Claude.
- **git** e **GitHub CLI** (`gh`) logado: `gh auth login`.
- Os projetos ficam em `~/Development` (Windows: `C:\Users\<você>\Development`).

### Windows

1. Instale os requisitos: [Git](https://git-scm.com/download/win) (traz o Git Bash), `winget install GitHub.cli`,
   [Node](https://nodejs.org) e `npm install -g @anthropic-ai/claude-code`. Depois: `gh auth login` e `claude` (entra e sai com `/exit`).
2. Baixe **`Central.Setup.<versão>.exe`** do release e rode. Ele cria atalhos no menu Iniciar e na área de trabalho.
3. Dados em `%APPDATA%\Central\central.db` (SQLite).

### Mac

1. Instale os requisitos no Terminal:
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"   # Homebrew, se não tiver
   brew install git gh node
   npm install -g @anthropic-ai/claude-code
   gh auth login
   claude            # entra com a sua conta e sai com /exit
   ```
2. Baixe o `.dmg` do seu Mac ( → Sobre este Mac):
   - Apple Silicon (M1, M2, M3, M4…): **`Central-<versão>-arm64.dmg`**
   - Intel: **`Central-<versão>-x64.dmg`**

   Pelo terminal: `curl -LO https://github.com/RootSpaceOrg/central/releases/latest/download/Central-<versão>-arm64.dmg`
3. Abra o `.dmg` e arraste a **Central** para **Aplicativos**.
4. Primeira abertura: o pacote não tem assinatura da Apple, então clique com o **botão direito** na Central → **Abrir** →
   **Abrir**. Se o macOS disser que o app está danificado: `xattr -dr com.apple.quarantine /Applications/Central.app`.
5. Dados em `~/Library/Application Support/Central/central.db`.

No Mac, a Transcrição local (Whisper) usa o `whisper-cpp` e o `ffmpeg` do Homebrew (a Central instala na hora de preparar).
Atalhos: Cmd+J (conversa), Cmd+K (busca), Cmd+Enter (enviar).

### Primeira abertura e outro computador

- Instalação nova começa limpa: a tela inicial acha as pastas com repositório em `Development` para virar projeto.
- Para levar tudo de um computador para outro (Windows ↔ Mac): **Preferências → Sobre → Exportar…** num, e
  **Importar…** (ou "Trazer de outro computador" nas boas-vindas) no outro. Clone antes os repositórios na mesma
  estrutura de `Development`: a importação ajusta as pastas para o disco novo. O WhatsApp precisa conectar o número de novo.

### Gerar o instalador a partir do código

```bash
cd app
npm i
npm run dist          # Windows: app/release/Central Setup <versão>.exe
npm run dist:mac      # Mac (num Mac): app/release/Central-<versão>-<arm64|x64>.dmg
```

Cada release publicado no GitHub gera os `.dmg` sozinho (workflow **Build Mac**, num Mac do GitHub Actions) e anexa ao release.

## Desenvolver

A `main` é protegida: mudanças entram por pull request (sem push direto nem reescrita do histórico).

```bash
cd app
npm run dev           # interface com hot reload (porta 4300) + Electron
npm start             # build completo e abre o app
```

- `electron/`: processo principal (banco, git, terminais, agentes). Typecheck: `npx tsc -p electron/tsconfig.json`.
- `src/app/shared/contract.ts`: tudo o que a interface pode pedir ao processo principal.
- `src/app/`: interface Angular (convenções de `modules/`, `shared/`, services em duas camadas).
- Self-checks: `node electron/backlog.check.mjs`, `electron/updater.check.mjs`, `electron/routines.check.mjs`,
  `scripts/file-icons.check.mjs`, `scripts/markdown.check.mjs`, `scripts/grid-tree.check.mjs`, `scripts/context.check.mjs`, `scripts/activity.check.mjs`, `scripts/office.check.mjs`, `scripts/memories.check.mjs`, `scripts/health.check.mjs`, `scripts/deliveries.check.mjs`, `scripts/dispatch.check.mjs`. Todos de uma vez: `npm run check` (o release só sai depois dele).

Depuração: `--data=<pasta>` usa outro banco; `--route=/projetos/x?aba=backlog` (ou `?nova=chat`) abre numa tela;
`--capture=arquivo.png` salva um print e fecha (`--exec64=<js em base64>` roda um script antes).
