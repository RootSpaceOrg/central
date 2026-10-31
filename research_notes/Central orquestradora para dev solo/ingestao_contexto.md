# Ingestão de contexto de trabalho (reuniões, mensagens, voz, email, calendário) para uma central de IA de um dev solo — estado em out/2026

> Nota de método: 17 buscas web (sem fetch de páginas completas, por limite de tempo). Muitas fontes são blogs de fornecedores/afiliados; onde isso importa está sinalizado. Preços mudam rápido: confirmar na página oficial antes de calcular custo.

## 1. Captura de reuniões: quais ferramentas entregam transcrição automaticamente a um sistema próprio (API / webhook / MCP)?

### Takeaway
Para ingestão **automática e sem humano no loop**, o que importa é **webhook + REST API** (push quando a transcrição fica pronta). Servidores MCP oficiais (Granola, Fathom, Otter) são **pull, somente leitura e com OAuth interativo**: servem para um agente consultar, não para disparar um pipeline. Os caminhos mais limpos: **Google Meet REST API + Workspace Events** (nativo, sem bot, se ele usar Workspace), **Recall.ai** (bot universal, ~US$0,50/h), **Fireflies/Fathom/Granola pagos** (webhooks) e **Plaud** (webhooks) para reunião presencial. Limitless está morto como produto.

### Cited Findings
**Granola**
- MCP oficial lançado em 4/fev/2026 em `https://mcp.granola.ai/mcp` (Claude, ChatGPT, Cursor). No plano grátis lê só notas próprias dos últimos 30 dias, **sem transcrições**; acesso a transcrição depende do plano. — [Layer3Labs Granola MCP](https://www.layer3labs.io/guides/granola-mcp); [ContextBolt](https://contextbolt.com/blog/granola-mcp/)
- REST API cobre notas, transcrições e **webhooks** (CRUD de endpoints via API) apenas em workspaces pagos; contas Basic grátis não acessam a API. O signing secret do webhook só aparece na resposta de criação. — [Layer3Labs Granola API](https://www.layer3labs.io/guides/granola-api)
- O MCP oficial não aceita API key estática/service account → inadequado para jobs não assistidos; para isso, REST + webhooks. — [Layer3Labs Granola API](https://www.layer3labs.io/guides/granola-api)
- Endpoint de transcrição paginada e erro `TRANSCRIPT_TOO_LARGE` adicionados em ago/2026 (fonte de fornecedor, não verificado na doc oficial). — [Truto](https://truto.one/blog/connect-granola-to-chatgpt-search-meeting-notes-and-manage-webhooks.md)

**Fireflies**
- Webhook oficial "Transcription completed": POST com meetingId, eventType, clientReferenceId; header `x-hub-signature` (HMAC-SHA256). Depois busca o transcript pela GraphQL API. — [Fireflies docs: webhooks](https://docs.fireflies.ai/graphql-api/webhooks.md)
- Também dá para passar webhook por upload (`uploadAudio`), útil para mandar áudio de reunião presencial; webhooks podem exigir plano Business/Enterprise (não confirmado na doc oficial). — [claudeskills.info](https://claudeskills.info/skills/jeremylongshore/claude-code-plugins-plus-skills/fireflies-webhooks-events/)
- MCP comunitário (cassler/fireflies-mcp-server): list/get/search transcripts, sem webhook. — [mcpservers.org](https://mcpservers.org/ko/servers/cassler/fireflies-mcp-server)

**Fathom**
- REST API, SDKs e webhooks adicionados em out/2025; MCP server em abr/2026; webhooks ganharam campos (meeting URL, tipo, highlights, sharing, id) em jun/2026. — [Fathom developer changelog](https://developers.fathom.ai/changelog.md)
- MCP é read-only (busca, speaker lookup, resolução de link), não assina eventos nem baixa mídia; para agir quando a call termina precisa de webhook. — [Scalekit](https://www.scalekit.com/blog/fathom-mcp-vs-api)
- MCP disponível em todos os planos, inclusive grátis; **Fathom teria sido adquirida pela Superhuman em set/2026** (fonte única, concorrente — tratar com cautela). — [tl;dv blog](https://tldv.io/ko/blog/fathom-mcp/)

**Otter**
- MCP em todos os planos, Zapier a partir do Pro; **REST API e webhooks só no Enterprise** (fonte concorrente, não verificada). — [MeetGeek](https://meetgeek.ai/comparison/fr/fathom-vs-otter)

**Read.ai / tl;dv**
- Read AI permite empurrar action items para o Linear após revisão humana. — [Linear integrations: Read AI](https://linear.app/integrations/read-ai)

**Recall.ai (API de bot de reunião, Meet/Zoom/Teams)**
- Pay-as-you-go caiu de US$0,70 para **US$0,50 por hora gravada** (abr/2026), vale para Meeting Bot API e Desktop Recording SDK; sem taxa de plataforma. A página de pricing ainda mostrava US$0,70 (conflito). — [Recall.ai blog](https://recall.ai/blog/new-recall-ai-pricing-for-2026); [Recall.ai Pricing](https://www.recall.ai/pricing)
- Transcrição embutida +US$0,15/h; armazenamento grátis 7 dias, depois US$0,05/h a cada 30 dias; PAYG limitado a 500 h/mês e gravações de até 2 h. — [Recall.ai blog](https://recall.ai/blog/new-recall-ai-pricing-for-2026); [Recall docs PAYG](https://docs.recall.ai/page/self-serve-plan-pay-as-you-go)
- Tarifa startup de US$0,25/h. — [Recall.ai startups](https://recall.ai/startups)
- Uma fonte cita taxa de US$1.000/mês + ~US$1/h — conflita com o próprio vendor e parece desatualizada. — [DEV Community](https://dev.to/lirim_kon/3-best-alternatives-to-recallai-398n)
- Alternativas citadas: Meeting BaaS e Vexa (calculadora de custo). — [apicostcalc](https://apicostcalc.com/pt/recall-ai-vs-meetingbaas-vs-vexa-cost-calculator.html)

**Google Meet nativo**
- Meet REST API v2: `conferenceRecords/*/transcripts` (lista/get) e `transcripts/*/entries` (entradas estruturadas por falante/tempo). — [Meet API reference](https://developers.google.com/workspace/meet/api/reference/rest/v2?hl=hi)
- Workspace Events API publica `google.workspace.meet.transcript.v2.started/ended/fileGenerated`; assinatura por espaço ou **por todos os espaços de um usuário**. — [Workspace Events: Meet](https://developers.google.cn/workspace/events/guides/events-meet?hl=id)

**Wearables / gravadores**
- Meta comprou a Limitless (ex-Rewind) em dez/2025; Pendant deixou de ser vendido; suporte a clientes existentes por "pelo menos mais um ano" (≈ dez/2026, sem plano posterior); app Rewind teve captura desativada em 19/dez/2025; serviço encerrado na UE/Reino Unido. — [9to5Mac](https://9to5mac.com/2025/12/05/rewind-limitless-meta-acquisition/); [Sacra](https://sacra.com/research/why-meta-bought-limitless/); [Hedy](https://www.hedy.ai/post/meta-acquires-limitless-ai-privacy/)
- Plaud: Developer Portal com **webhooks** (POST HTTPS, assinatura HMAC-SHA256) quando o resultado fica pronto. — [Plaud docs: webhook events](https://docs.plaud.ai/documentation/developer_guides/webhook_events)
- Plaud no Zapier: trigger "novas transcrições e resumos prontos", além de conexão MCP e SDK via Zapier. — [Zapier: automate Plaud](https://zapier.com/blog/automate-plaud.md)

### Inferences
- Se os clientes usam Google Meet e ele tem Google Workspace com transcrição habilitada, o caminho mais barato é Meet API + Workspace Events (custo ≈ zero, sem bot visível além do aviso nativo de transcrição). Para Zoom/Teams de clientes ou contas gratuitas, Recall.ai (~US$0,65/h com transcrição) é o "conector universal"; a ~10 h/mês de calls, custa < US$10/mês.
- Alternativa "zero integração": Recall.ai só gravando áudio + STT próprio em pt-BR (ElevenLabs/AssemblyAI), o que dá controle total da qualidade em português.
- Para presencial: Plaud (webhook nativo) ou simplesmente gravar no celular e subir para o mesmo endpoint de STT. Evitar Limitless (fim de vida).
- MCPs de Granola/Fathom/Otter são úteis como **ferramenta de consulta** do agente ("o que o cliente X disse sobre Y?"), não como trigger de ingestão.

### Gaps
- tl;dv e Read.ai: não encontrei documentação de API/webhook pública nas buscas.
- Qualidade pt-BR específica de cada app de notas (Granola, Fathom, Fireflies) — sem benchmark independente encontrado.
- Plano mínimo de Google Workspace com transcrição do Meet em pt-BR e escopos OAuth exatos: não verificado.
- Confirmação oficial da aquisição Fathom/Superhuman e do status atual do Limitless Pendant em out/2026.

## 2. Mensageria: WhatsApp oficial vs bridges não oficiais, Telegram, Slack/Discord

### Takeaway
A API oficial **não lê conversas de um número pessoal**: só conversas do número cadastrado como WABA. A novidade que resolve o caso do dev é **Coexistence**: o mesmo número do **WhatsApp Business App** passa a ter Cloud API, com espelhamento bidirecional (webhooks inclusive para mensagens enviadas pelo app) e sync de até ~6 meses de histórico, exceto grupos. Para ingestão (receber mensagens), o custo da Meta é ~zero, já que a cobrança é por mensagem *enviada*. Bridges não oficiais (Baileys/Evolution/WAHA/Z-API) leem tudo, inclusive grupos, mas violam os ToS e arriscam ban irreversível do número principal do negócio.

### Cited Findings
**Cloud API oficial: preço e regras**
- Desde 1/jul/2025 a Meta cobra **por mensagem entregue** (template), não mais por conversa de 24 h; desde 1/jul/2026 contas brasileiras elegíveis podem ser cobradas em reais. — [Eazybe](https://eazybe.com/br/blog/preco-api-whatsapp-business); [ChatMaxima](https://chatmaxima.com/pt-br/whatsapp-api-pricing/brazil/)
- Tarifas BR (a partir de 1/out/2026, segundo fornecedores): marketing R$0,3217, utilidade R$0,0350, autenticação R$0,0350 por mensagem. Outras fontes dão marketing ≈ US$0,0625 e utilidade ≈ US$0,0068 (conflito; confirmar na tabela oficial). — [Dragapp](https://www.dragapp.com/pt-br/blog/api-oficial-do-whatsapp/); [ChatMaxima](https://chatmaxima.com/pt-br/whatsapp-api-pricing/brazil/); [Leadsales](https://leadsales.io/pt/blog/whatsapp-business-api-preco/)
- BSPs cobram markup sobre a tarifa Meta; o app gratuito WhatsApp Business não tem essa cobrança. — [Eazybe](https://eazybe.com/br/blog/preco-api-whatsapp-business); [Tribuna de Jundiaí](https://tribunadejundiai.com.br/economia/whatsapp-business-sera-pago-a-partir-de-outubro-mensagem-assusta-pequenos-negocios-mas-cobranca-nao-funciona-como-parece/)
- Um artigo afirma que as mensagens gratuitas dentro da janela de 24 h deixam de existir em 1/out/2026 (fonte que vende Cloud API; não confirmado). — [pasqualepillitteri.it](https://pasqualepillitteri.it/pt/news/12976/integrar-whatsapp-evolution-api-cloud-api-meta)
- Política de 15/jan/2026 baniu **chatbots de IA de propósito geral** da Business API (IA de suporte/vendas continua permitida); a aplicação foi reportadamente **suspensa para usuários no Brasil**; na Europa, permitida por 12 meses mediante taxa. Datas desses dois relatos não confirmadas. — [TechCrunch](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform/); [respond.io](https://respond.io/blog/whatsapp-general-purpose-chatbots-ban); [CXO Digital Pulse](https://www.cxodigitalpulse.com/?p=46574)

**Coexistence (Business App + Cloud API no mesmo número)**
- Número já registrado no WhatsApp Business App ganha Cloud API sem perder histórico; mensagens do app aparecem no histórico da API e vice-versa (webhook `smb_message_echoes`). — [360dialog](https://docs.360dialog.com/partner/waba-management/phone-number-and-hosting/whatsapp-coexistence); [Jelou](https://docs.jelou.ai/en/connect/prerequisites/coexistence)
- Sync de histórico de até 6 meses (180 dias), com janela de 24 h para importar e app aberto; até 2 semanas de mídia; **grupos não são importados**. — [Jelou](https://docs.jelou.ai/en/coexistence); [Eazybe help](https://help.eazybe.com/en/waba/connect-with-existing-whatsapp)
- Requisitos: Business App ≥ 2.24.17, empresa verificada no Meta Business Manager; não desinstalar o app; abrir o app pelo menos a cada ~13 dias; mensagens de companion devices não suportados não geram echo webhook; desconexão só pelo app. — [Jelou](https://docs.jelou.ai/en/connect/prerequisites/coexistence); [YCloud](https://www.ycloud.com/blog/whatsapp-business-app-coexistence-meta-update.md)

**Bridges não oficiais (Evolution API / Baileys / WAHA / Z-API)**
- Baileys (usado pela Evolution API) é cliente não oficial; os ToS do WhatsApp proíbem esse uso → risco **contratual** (ban), não penal. A Evolution API em si não é ilegal. — [Hora de Codar](https://horadecodar.com.br/evolution-api-e-segura-analise/); [pasqualepillitteri.it](https://pasqualepillitteri.it/pt/news/12976/integrar-whatsapp-evolution-api-cloud-api-meta)
- Afirma-se detecção em semanas/meses e ban sem recurso; estatística de "68% de 600 contas banidas em 12 meses" de um estudo indiano não verificável (fonte vende a API oficial). — [pasqualepillitteri.it](https://pasqualepillitteri.it/en/news/12969/integrate-whatsapp-evolution-api-vs-cloud-api)
- Mitigações: não usar o mesmo número em vários ambientes nem múltiplas instâncias no mesmo número; o risco nunca zera. — [Hora de Codar](https://horadecodar.com.br/evolution-api-e-segura-analise/)
- WAHA: self-hosted, open source, sem taxa por mensagem. — [IndieHackers](https://www.indiehackers.com/post/best-10-evolution-api-alternatives-in-2026-tested-9fc702d744)

### Inferences
- Arquitetura recomendada para o caso dele: mover o número de clientes para **WhatsApp Business App + Coexistence** via BSP barato ou direto na Cloud API. Ele continua respondendo no celular normalmente, e a central recebe cada mensagem (in/out) por webhook. Custo ≈ 0, porque ingestão não envia templates; o que ele mandar pelo app é cobrado como mensagem do app, não da API. Limite: grupos de WhatsApp ficam de fora, e muitos clientes B2B usam grupo.
- Para grupos ou número pessoal: o único caminho técnico são bridges não oficiais. Se usar, rodar num **número secundário/descartável** só como leitor (ex.: WAHA/Evolution conectado a um número adicionado aos grupos), nunca no número principal.
- Canal de comando (ele → central): um bot próprio no Telegram é o mais simples (Bot API gratuita, aceita voz/texto/arquivo, sem ToS de negócio). Os detalhes da Bot API vêm de conhecimento geral e não foram verificados nesta pesquisa. Alternativa: o próprio número WABA respondendo a ele dentro da janela de serviço.
- A proibição de "chatbot de propósito geral" não deveria afetar um uso interno de triagem, mas a redação dá discricionariedade à Meta. Mais um motivo para usar Telegram como canal de comando com o LLM.

### Gaps
- Página oficial de preços da Meta não acessada; valores em R$ divergem entre fontes.
- WAHA e Z-API: sem dado específico de 2026 sobre risco de ban nem sobre o modo de conexão (WAHA tem engines baseadas em WhatsApp Web).
- Slack/Discord: não pesquisado nesta rodada (Events API e Gateway são bem documentados, mas sem fonte coletada). Para clientes brasileiros devem ser marginais frente ao WhatsApp.
- Se o Coexistence funciona com números de pessoa física / sem CNPJ verificado.

## 3. Email + calendário

### Takeaway
Gmail não envia webhook HTTP: o fluxo é `users.watch` → tópico **Cloud Pub/Sub** (push para um endpoint HTTPS) → `users.history.list` a partir do último historyId salvo. O watch expira em 7 dias, então precisa de um cron diário de renovação, senão a falha é silenciosa.

### Cited Findings
- `watch` precisa ser re-chamado pelo menos a cada 7 dias; Google recomenda 1x/dia; a resposta traz `expiration`. — [Gmail API Push guide](https://developers.google.com/gmail/api/guides/push)
- Notificações vão para um tópico Pub/Sub com permissão de publish para `gmail-api-push@system.gserviceaccount.com`; no push, responder HTTP 200 = ack. — [Gmail API Push guide](https://developers.google.com/gmail/api/guides/push)
- A notificação traz só email + historyId; buscar mudanças com `users.history.list` usando o **último historyId armazenado**, não o da notificação. — [Gmail API Push guide](https://developers.google.com/gmail/api/guides/push); [Unipile](https://www.unipile.com/gmail-api-push-notifications/)
- Renovação esquecida = falha silenciosa sem erro; recomendam cron diário. — [Nylas CLI guide](https://cli.nylas.com/guides/gmail-push-notifications)

### Inferences
- Implementação mínima: Cloud Scheduler ou EventBridge (diário) → `watch`; Pub/Sub push → Lambda/Worker → `history.list` → filtrar remetentes que são clientes (lista de domínios por produto) → fila de extração.
- Calendar serve sobretudo para **enriquecer** reuniões (quem participou → qual cliente/produto) e disparar o bot do Recall na hora certa. Polling com `syncToken` a cada poucos minutos é suficiente para um usuário só (conhecimento geral, não verificado aqui).
- Os conectores MCP de Gmail/Calendar (ex.: do claude.ai) servem para consulta ad hoc do agente, não como pipeline.

### Gaps
- Google Calendar push (`events.watch`, expiração de canais) não foi pesquisado/citado.
- Custo de Pub/Sub para volume pessoal (deve ser desprezível, não verificado).

## 4. Captura de voz no celular e STT pt-BR (qualidade e preço)

### Takeaway
Para notas de voz curtas, o STT custa praticamente nada: ~US$0,003–0,006/min em qualquer um dos grandes. A diferença está na qualidade em pt-BR, e **não existe benchmark independente e recente** cobrindo Scribe, gpt-4o-transcribe, AssemblyAI e Deepgram em pt-BR. Os números disponíveis são de fornecedores. Recomendação: teste A/B com 20–30 áudios reais dele (sotaque, jargão, nomes de produtos).

### Cited Findings
- ElevenLabs (alegação própria): FLEURS português WER 2,3% Scribe v1 vs 10,5% Deepgram Nova 2, 3,3% Gemini Flash 2, 4,1% Whisper Large v3; não diz se é pt-BR ou pt-PT. — [ElevenLabs STT Portuguese](https://elevenlabs.io/speech-to-text/portuguese)
- Benchmark Soniox 2023 (também vendor; desatualizado): português, 10 h de YouTube: Soniox 5,35%, AssemblyAI 7,83%, Deepgram 11,70%, OpenAI 16,57%; mistura pt-BR/pt-PT entre vendors. — [Soniox PDF](https://soniox.com/media/SonioxPortugueseBenchmarks2023.pdf)
- Preços (agregadores, 2026): gpt-4o-transcribe ≈ US$0,006/min, gpt-4o-mini-transcribe ≈ US$0,003/min; Deepgram Nova-3 ≈ US$0,0043/min pré-gravado, US$0,0077 streaming; AssemblyAI Universal-2 ≈ US$0,0025/min, Universal-3.5 Pro ≈ US$0,21/h; ElevenLabs Scribe v2 ≈ US$0,22/h (US$0,00367/min), Realtime US$0,39/h. — [CometAPI](https://www.cometapi.com/best-speech-to-text-apis/); [Soniox pricing compare](https://soniox.com/compare/stt/pricing); [Activepieces Deepgram](https://www.activepieces.com/blog/deepgram-pricing-2026-per-minute-rates-and-add-ons.md)
- Recall.ai oferece transcrição embutida a US$0,15/h. — [Recall.ai blog](https://recall.ai/blog/new-recall-ai-pricing-for-2026)

### Inferences
- Exemplo de custo: 1 h de reunião/dia × 22 dias ≈ 1.320 min/mês ≈ US$5–8/mês em STT de batch. Irrelevante perto do custo do LLM de extração.
- Captura mais simples no celular: **mandar áudio para o bot do Telegram (ou para o próprio número WABA)** → webhook → STT. Evita app próprio. Atalho do iOS ou app Android gravando e fazendo POST é a alternativa sem mensageiro.
- Para reunião longa, priorizar STT com **diarização** e vocabulário customizado (keyterms) para nomes de produtos/clientes.

### Gaps
- Nenhum benchmark independente pt-BR de 2025–2026 encontrado; Soniox e Gemini são candidatos a incluir no teste.
- Preços oficiais (páginas dos vendors) não verificados; números vêm de agregadores e divergem.

## 5. Padrões de extração: transcrição → decisões/tarefas/bugs → backlog → PR

### Takeaway
O padrão consolidado é: **LLM com saída estruturada** (decisões, action items, bugs, ideias) → **entity linking** ao projeto/cliente → **busca de duplicatas no backlog** (atualizar/linkar em vez de criar) → **portão humano** → agente de código abre **PR draft** só para itens claros e de escopo pequeno. Augment Code descreve exatamente o fluxo "meeting notes → PR"; Stilla (beta no Linear) promete PRs a partir de contexto de reuniões. Produtos de notas (Tactiq, Read AI) param no ticket.

### Cited Findings
- Augment "Meeting notes to PR": extrai decisões e action items, **busca duplicatas no Linear**, atribui dono (não auto-atribui com baixa confiança), prefere atualizar/linkar issue existente; um agente "PR Author" cria branch + PR draft para bugfix claro/escopo pequeno e linka de volta; humano revisa e o agente itera. — [Augment Code workflow](https://www.augmentcode.com/workflows/coding/meeting-notes-to-pr)
- Stilla (integração Linear, beta privado): captura action items de reuniões no Linear; assistente por issue rascunha PRs com contexto de reuniões, código e docs. — [Linear: Stilla](https://linear.app/integrations/stilla)
- Tactiq: roda prompt de IA sobre a transcrição e cria uma issue no Linear por action item (sem etapa de código). — [Tactiq help](https://help.tactiq.io/en/articles/12085070-automatically-create-linear-issues-from-meeting-transcripts)
- Mistral cookbook: transcrição → PRD → tickets no Linear (para antes do PR); referência de código aberta. — [Mistral cookbook](https://docs.mistral.ai/resources/cookbooks/mistral-agents-non_framework-transcript_linearticket_agent-TranscriptToLinearTicketAgent)
- Read AI: push de action items para o Linear após revisão. — [Linear: Read AI](https://linear.app/integrations/read-ai)

### Inferences
- Esquema mínimo do item extraído: `{tipo: decisão|tarefa|bug|ideia|direcionamento, produto_id, cliente_id, resumo, citação_literal + timestamp/msg_id da fonte, confiança, possível_duplicata_de}`. A citação literal com link para a fonte é o que torna o item auditável e reduz alucinação.
- Entity linking barato: tabela `produtos`/`clientes` com aliases (nomes, domínios de email, números de WhatsApp, IDs de grupo, títulos recorrentes de reunião). Resolver pela **origem** antes de pedir ao LLM (ex.: mensagem do número X → cliente Y → produto Z); LLM só desempata.
- Dedup: embeddings (pgvector no Supabase ou Vectorize no Cloudflare) dos itens abertos do backlog + LLM julgando "mesmo item?" sobre os top-k. Esse é o mesmo padrão do Augment, descrito acima.
- Mensagens de WhatsApp precisam de **janelamento** (agrupar por conversa e por período, ex.: ao fim de inatividade de N horas) antes da extração. Mensagem a mensagem gera ruído e duplicatas.
- Portão humano obrigatório entre "item extraído" e "agente de código": inbox de triagem com aprovar/editar/descartar (pode ser no próprio Telegram).

### Gaps
- Não encontrei casos públicos maduros de pipeline totalmente automático "reunião → PR mergeado"; Augment e Stilla são descrições de workflow/beta.
- Métricas de precisão da extração de action items (falsos positivos) não encontradas.

## 6. Privacidade / LGPD ao gravar clientes

### Takeaway
Não encontrei guia específico da ANPD sobre gravação de reuniões. As fontes jurídicas secundárias convergem: gravação de pessoa identificável é tratamento de dado pessoal. Exige base legal documentada (consentimento específico **ou** execução de contrato / legítimo interesse), finalidade determinada, transparência e política de retenção/eliminação. Consentimento genérico é nulo.

### Cited Findings
- Gravação de reunião (áudio/vídeo com pessoas identificáveis) é tratamento sob a LGPD; organização deve definir quando grava, quem autoriza e qual base legal; cautela extra com reuniões sensíveis (saúde, disciplinares, M&A, **menores**). — [judit.io](https://judit.io/blog/gestao-juridica-legal-operations/gravacao-de-reunioes-riscos-limites-regras-lgpd/)
- Bases alternativas ao consentimento: execução de contrato, legítimo interesse, obrigação legal etc. (Art. 7º). — [judit.io](https://judit.io/blog/gestao-juridica-legal-operations/gravacao-de-reunioes-riscos-limites-regras-lgpd/); [Confidata](https://confidata.com.br/blog/como-implementar-gestao-consentimento)
- Consentimento deve ser escrito ou demonstrável (Art. 8º); autorizações genéricas são nulas (Art. 8º §4º); revogável a qualquer tempo. — [Conjur](https://www.conjur.com.br/2021-ago-28/rodrigues-lgpd-consentimento-relacoes-trabalhistas//?print=1); [Confidata](https://confidata.com.br/blog/como-implementar-gestao-consentimento); [FIEMG FAQ](https://www.fiemg.com.br/wp-content/uploads/media/FIEMG/INTEGRIDADE/ICTSFIEMG/FAQ.pdf)
- Meta encerrou o serviço Limitless na UE/Reino Unido no contexto da aquisição, sinal do peso regulatório sobre wearables "sempre gravando". — [Hedy](https://www.hedy.ai/post/meta-acquires-limitless-ai-privacy/)

### Inferences
- Postura prática: cláusula no contrato/proposta com clientes B2B ("reuniões e mensagens podem ser gravadas/transcritas e processadas por IA para registro de requisitos; retenção X; provedores Y") + aviso verbal/no convite no início da call. Base legal provável: execução de contrato / legítimo interesse, com consentimento como reforço.
- Clientes de **educação** podem envolver dados de menores (alunos) em reuniões ou mensagens. Nesse caso, evitar ingerir esse conteúdo ou anonimizar.
- Minimização: guardar transcrição e itens extraídos; apagar áudio/vídeo bruto após N dias (Recall já guarda só 7 dias grátis). Usar provedores de LLM/STT com zero-retention / sem treino nos dados, e registrar a transferência internacional (servidores fora do Brasil).
- Wearable "sempre ligado" em encontros presenciais é o caso de maior risco legal e reputacional; preferir gravação explícita, ligada sob demanda e avisada.

### Gaps
- Nenhum documento primário da ANPD sobre gravação de reuniões ou uso de IA em transcrição foi localizado.
- Gravação de conversa por um dos interlocutores tem jurisprudência penal/civil própria no Brasil (lícita como prova em muitos casos), distinta da LGPD. Não pesquisado aqui.
- Regras de transferência internacional (Res. ANPD de cláusulas-padrão) aplicadas a STT/LLM nos EUA: não pesquisado.
