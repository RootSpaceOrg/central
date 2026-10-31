# Reference architecture and building blocks for a self-built, always-on personal agent orchestration platform ("Central"), as of Oct 2026

Researched 2026-10-31. Sources are primary docs where reachable; third-party comparison sites are flagged as such. Prices are "as seen on 2026-10-31" unless another date is stated.

## Durable execution / workflows for hours-long agent runs with human approval pauses

### Takeaway
Hours-long runs with multi-day approval waits are well covered by Cloudflare Workflows (waits are free and don't count toward concurrency, wall-clock per step is unlimited, sleeps up to 365 days), Inngest (max run length 30/90/366 days by plan), and Temporal Cloud (pay per action, no base fee). For a solo developer, the biggest shift in 2026 is that Anthropic's Claude Managed Agents now covers durable sessions, cron schedules, budgets and webhooks itself. That leaves the orchestrator only the outer business workflow (ingest → propose → approve → dispatch), not the agent loop.

### Cited Findings
- **Cloudflare Workflows limits (Workers Paid):** 10,000 steps by default, configurable to 25,000. Step wall-clock is unlimited. CPU per step is 30 s by default, configurable to 5 min. `step.sleep` max is 365 days. 50,000 concurrent running instances per account. Persisted state is 1 GB per instance, completed instances are retained 30 days, and event payloads and step results max out at 1 MiB. On the Free plan: 1,024 steps, 10 ms CPU per step, 100 concurrent instances. — [CF Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/)
- **Cloudflare Workflows concurrency and cron:** instances that are waiting (sleeping, retrying, or waiting for an event) don't count toward concurrency. Cron-triggered instances get 1 h of run time per firing outside the concurrency limit. Cron schedules are capped at 100 per account. — [CF Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/)
- **Cloudflare Workflows billing:** you are billed only while code executes, so waiting on third-party APIs or approvals costs $0. — [Cloudflare Workflows product page](https://www.cloudflare.com/product/workflows)
- **Unconfirmed Cloudflare figures:** the `waitForEvent` timeout reportedly defaults to 24 h, and step pricing reportedly is $0.30 per million after 10M free per month. Both come from third-party skill pages and are not confirmed on Cloudflare's docs. — [playbooks.com skill page](https://playbooks.com/skills/itechmeat/llm-code/cloudflare-workflows)
- **Inngest plans:**

  | Plan | Price | Included executions | Overage | Concurrent steps | Max run length (incl. sleeps/waits) |
  |---|---|---|---|---|---|
  | Free | $0 | 50k | none (pauses at quota) | 5 | 30 days |
  | Pro | from $99/mo | 1M | $50 per 1M | 100 | 90 days |
  | Business | from $499/mo | 10M | $25 per 1M | 500 | 366 days |

  Each `step.run` counts as an execution. Inngest now also lists "concurrent sandboxes" (100 / 1,000 / custom) with a 24 h max sandbox duration on Pro and Business. — [Inngest pricing](https://www.inngest.com/pricing)
- **Inngest caveat (third-party):** Inngest Connect needs a long-running server and doesn't support serverless targets like Lambda, and Python support was described as beta. — [Hookdeck comparison](https://hookdeck.com/webhooks/platforms/inngest-alternatives)
- **Temporal Cloud pay-as-you-go:**
  - $50 per million actions, falling to $25 per million with self-service volume discounts. No base fee.
  - Active storage $0.042/GB-h; retained storage $0.00105/GB-h.
  - $150 in credits for 90 days.
  - Billable actions are Workflow, Activity, Timer, Signal, Query and Schedule.
  - The Business support add-on starts at $500/mo.
  - Temporal markets "durable AI agents": OpenAI Agents SDK and Google ADK run LLM and tool calls as durable Activities.

  — [Temporal pricing](https://temporal.io/pricing)
- **Setup effort (third-party opinion):** one source puts Temporal setup at 2–3 days versus about 30 minutes for Inngest. Another positions Trigger.dev (Apache 2.0, self-hostable, realtime streaming to the UI) for TypeScript teams. — [noqta.tn](https://noqta.tn/blog/durable-execution-ai-agents-inngest-trigger-temporal-2026); [automationatlas](https://automationatlas.io/guides/trigger-dev-vs-inngest-2026-comparison/)
- **Cloudflare Agents SDK:**
  - Each agent is a Durable Object with durable identity, local SQL, real-time connections, scheduled work and recoverable execution.
  - A "harness" capability runs the agent loop. The "Pi harness" runs durably and continues after eviction; it is experimental and pinned at `~1.4.0`.
  - Channels include chat, voice, email, Slack and webhooks, and the chat example includes HITL approvals.
  - Page last updated 2026-10-29.

  — [CF Agents docs](https://developers.cloudflare.com/agents/)
- **Lessons from Anthropic's multi-agent research system:**
  - Agents resume from the point of failure rather than restarting (retries plus regular checkpoints).
  - "Rainbow deployments" are needed because long-running agents can't all be updated at once.
  - The lead agent persists its plan to external memory because context beyond 200k tokens gets truncated.

  — [Anthropic engineering](https://www.anthropic.com/engineering/multi-agent-research-system)

### Inferences
- **Recommended split:** use an outer workflow engine for Central's business process (event → proposal → `waitForEvent(approval)` → dispatch → wait for the PR/deploy webhook). Push the hours-long coding loop into a managed agent session or sandbox, not into workflow steps. That keeps step counts and billed executions low.
- **Cloudflare fit:** Cloudflare Workflows is the cheapest fit for "wait days for an approval" because waiting is free. Its 30 s–5 min CPU limit per step is irrelevant when steps only call out to sandboxes or APIs, since the limit counts CPU, not wall-clock.
- **Inngest fit:** the 30-day Free cap would break proposals that sit unapproved longer than that.
- **Temporal fit:** at solo scale (say 100k actions/month) Temporal is about $5/mo, but you run workers yourself (ECS/Fly). Highest operational overhead of the options.
- **Step Functions:** a native AWS option given the user's stack. Not researched here (see Gaps).
- **DBOS (Postgres-backed):** a natural fit with Supabase. Not researched here (see Gaps).

### Gaps
- AWS Step Functions Standard pricing and limits were not fetched. From prior knowledge: max 1 year execution, and task tokens support HITL callbacks. Verify before relying on this.
- Restate, DBOS and Trigger.dev pricing pages were not fetched.
- Cloudflare Workflows' official pricing and the max `waitForEvent` timeout were not found on official docs.

## Sandboxes for running coding agents

### Takeaway
Per-second CPU pricing has converged at about $0.0504 per vCPU-hour (E2B, Daytona). Cloudflare Containers is roughly 40% pricier per vCPU-second but bills CPU only when active, and pairs natively with Durable Objects and Workflows. Max duration is the main differentiator: E2B caps sessions at 1 h (Hobby) or 24 h (Pro, $150/mo base). Claude Managed Agents includes its own sandbox for $0.08 per session-hour on top of tokens, or can run on a self-hosted sandbox.

### Cited Findings
- **E2B:**
  - Hobby: $0, 20 concurrent sandboxes, 1 h max session, one-time $100 credits.
  - Pro: $150/mo plus usage, 100 concurrent (add-ons for 600 at $650/mo or 1,100 at $1,150/mo), 24 h max session.
  - Enterprise: $3,000/mo minimum.
  - Usage: $0.000014 per vCPU-second and $0.0000045 per GiB-second; storage free.
  - Sizes 1–8 vCPU and 1–8 GiB, default 2 vCPU / 4 GiB. CPU only.

  — [E2B pricing](https://e2b.dev/pricing)
- **Daytona:**
  - $0.0504 per vCPU-hour and $0.0162 per GiB-hour.
  - Storage $0.000108 per GiB-hour; first 5 GiB free.
  - $200 free credits; up to $50k for startups.
  - Claims "sub 90ms sandbox creation."
  - The page states no max duration and no auto-stop details.

  — [Daytona pricing](https://www.daytona.io/pricing)
- **Cloudflare Containers (Workers Paid $5/mo):**
  - Included per month: 25 GiB-h memory, 375 vCPU-min, 200 GB-h disk.
  - Overage: $0.000020 per vCPU-second (active CPU only), $0.0000025 per GiB-second (provisioned), $0.00000007 per GB-second disk.
  - Billed per 10 ms while running. Egress in NA/EU: $0.025/GB after 1 TB.
  - Instance types range from lite (1/16 vCPU, 256 MiB) to standard-4 (4 vCPU, 12 GiB, 20 GB disk).

  — [CF Containers pricing](https://developers.cloudflare.com/containers/pricing/)
- **Cloudflare Sandbox SDK:**
  - Runs on Containers. Each instance is a microVM with its own kernel and network.
  - Driven from a Durable Object (`container.exec`). Outbound internet can be disabled.
  - Workspace snapshots can restore files between instances.
  - A "Coding agents" guide covers running Claude Code, Codex and Devin in a per-task sandbox.
  - Requires Workers Paid. The Durable Object scheduling policy is in public beta.

  — [CF Sandbox SDK](https://developers.cloudflare.com/sandbox/)
- **Third-party claims:** Modal Sandboxes run on gVisor and cost about 41% more per vCPU than E2B and Daytona; E2B uses Firecracker microVMs. Modal Starter is $0 with $30/mo credit; Team is $250/mo. — [beri.net](https://www.beri.net/article/e2b-vs-modal-vs-daytona-agent-sandbox-pricing-isolation-2026); [costbench](https://costbench.com/software/ai-code-execution/e2b/)
- **Claude Agent SDK self-hosting:**
  - Run persistent containers, often several SDK processes per container, with one subprocess per session.
  - Size containers for the maximum number of concurrent sessions.
  - `resume` plus `sessionStore` options support resumption.
  - The hosting cookbook covers local Docker, Modal and Kubernetes.

  — [Agent SDK hosting](https://code.claude.com/docs/en/agent-sdk/hosting)

### Inferences
- **Example cost:** a 2 vCPU / 4 GiB coding sandbox running 1 h costs about $0.17 on Daytona (2×$0.0504 + 4×$0.0162 = $0.166) and about the same on E2B (2×$0.0504 + 4×$0.0162 = $0.166). Compute is small next to LLM tokens.
- **E2B duration cap:** the 24 h Pro cap is fine for "hours-long" work. The 1 h Hobby cap is not.
- **GitHub Actions runners as sandboxes:** cheap for PR-producing jobs, and the user already uses GitHub Actions. The 6 h job limit is from prior knowledge, not verified here. They are not interactive or resumable.
- **AWS Lambda's 15 min cap** (prior knowledge) rules it out for the agent loop. ECS Fargate works but means building the sandbox yourself.

### Gaps
- Vercel Sandbox, Fly Machines, Modal official pricing, and Fargate/CodeBuild prices were not fetched.
- Cloudflare Containers max instances and lifetime limits were not fetched.
- E2B pause/resume persistence is not shown on the pricing page.

## Agent runtimes and Anthropic's managed offering; multi-agent patterns

### Takeaway
Anthropic now ships **Claude Managed Agents** (beta header `managed-agents-2026-04-01`, public beta since 2026-04-08 per third parties). It is a hosted harness with sandboxes, long-running resumable sessions, MCP, skills, memory stores, vaults, GitHub resources, budgets, webhooks and cron "scheduled deployments", priced at token rates plus $0.08 per session-hour while running. It removes most of the "dispatch coding agents into cloud sandboxes" plumbing. Custom loops remain possible with the Claude Agent SDK (headless Claude Code) or with Codex/OpenAI Agents SDK inside your own sandbox.

### Cited Findings
- **What Managed Agents is:** a "pre-built, configurable agent harness that runs in managed infrastructure", best for long-running tasks and asynchronous work.
  - Built-in tools: bash, file operations, web search/fetch, MCP servers.
  - Built-in prompt caching and compaction.
  - Supports steering and interruption mid-run.
  - SSE streaming, with full event history persisted server-side.

  — [Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview)
- **Core concepts:** Agent (model, prompt, tools, MCP, skills), Environment (an Anthropic cloud sandbox or a self-hosted sandbox on your own infrastructure), Session, and Events. Sessions "resume cleanly after pauses." The service is not eligible for ZDR or HIPAA. It is available on the Claude API, Claude Platform on AWS and Google Cloud. MCP tunnels and "dreaming" are in a limited research preview. — [Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview)
- **Environments:** each session gets its own sandbox even when sessions share an environment. Networking is unrestricted or limited to an `allowed_hosts` allowlist. — [Environments](https://platform.claude.com/docs/managed-agents/environments)
- **Scheduled deployments:**
  - Cron plus IANA timezone, with minute-level granularity.
  - Jitter of up to 15% of the interval (minimum 5 s, maximum 9 min). Max 1,000 deployments per org.
  - Can attach files, GitHub repositories, memory stores and vaults.
  - Per-run `budget` (`max_list_cost`); a session pauses with `budget_reached` when it hits the cap.
  - Webhooks for deployment and run events, plus a manual `run` endpoint.
  - Pause and unpause, with no backfill of missed runs.

  — [Scheduled deployments](https://platform.claude.com/docs/en/managed-agents/scheduled-deployments)
- **Pricing:** standard token rates plus $0.08 per session-hour, metered only while the session status is "running". — [Anthropic pricing PDF via search](https://www-cdn.anthropic.com/files/4zrzovbb/website/9e03129acc36d31970777d336f969bb53dc84355.pdf). Third parties say no Batch discount applies. They also disagree on Sonnet 5 token prices: $2.50/$12.50 in the Anthropic PDF versus $3/$15 from TrueFoundry. Check the official pricing page. — [TrueFoundry](https://www.truefoundry.com/blog/claude-managed-agents-pricing)
- **Agent SDK vs Managed Agents:** the Agent SDK hosting docs point to Managed Agents when you don't need infrastructure control or your own data plane. — [Agent SDK hosting](https://code.claude.com/docs/en/agent-sdk/hosting)
- **Multi-agent research system:**
  - Orchestrator-worker setup (Opus lead, Sonnet subagents) scored 90.2% higher than a single agent on an internal eval.
  - Token usage explained 80% of the variance on BrowseComp.
  - Multi-agent systems use about 15× the tokens of chat; single agents about 4×.
  - The lead spawns 3–5 subagents in parallel. Subagents write outputs to the filesystem and pass references back.
  - LLM-as-judge with a 0–1 score plus pass/fail was the most consistent evaluation.

  — [Anthropic engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- **Temporal integration:** Temporal markets durable execution for the OpenAI Agents SDK and Google ADK. — [Temporal pricing](https://temporal.io/pricing)

### Inferences
- **Fastest path for Central:** Managed Agents for the coding and scout agents, with GitHub resources, vaults for secrets, per-run budgets as a kill switch, and webhooks back to Central. Central becomes mostly event intake, memory, ranking, inbox and policy.
- **Main trade-offs:** beta status, vendor lock-in (Claude only), no ZDR, and $0.08/h overhead. Running 10 agents × 2 h/day ≈ $48/mo in runtime fees, before tokens.
- **Codex and other non-Claude agents** still need your own sandbox (E2B, Daytona or Cloudflare Sandbox), or the "self-hosted sandbox" environment type, which may host your own image. Verify that.
- **Frameworks:** LangGraph, Mastra and Pydantic AI add value mainly for non-coding agents (ranking, triage). Coding agents should use the vendor harness.

### Gaps
- OpenAI Codex SDK / Agents SDK hosted offerings, LangGraph Platform, Mastra and Pydantic AI were not researched in this pass.
- Managed Agents max session duration, multi-agent/subagent docs and memory-store docs were not fetched in detail. The deployment docs reference subagents and memory stores.

## Memory / knowledge: the "product brain"

### Takeaway
The market splits into Zep/Graphiti (temporal knowledge graph with fact validity windows), Mem0 (bolt-on memory layer) and Letta (agent-as-runtime with self-managed memory). The benchmarks are vendor-reported and contested. For a solo developer already on Supabase, the inference is pgvector plus structured tables, with per-repo CLAUDE.md files as the agent-facing projection. Managed Agents "memory stores" are another native option.

### Cited Findings
- **Positioning:** Mem0 is a memory layer added to an existing agent. Letta is a runtime where the agent manages its own memory. Zep builds a temporal knowledge graph, and Graphiti is its open-source engine. Zep stores validity windows on facts, which supports questions like "what was true in Q1?". — [atlan](https://atlan.com/know/best-ai-agent-memory-frameworks-2026/); [vectorize](https://vectorize.io/articles/zep-alternatives) (third-party)
- **Benchmarks (contested):** Zep/Graphiti scores 63.8 on LongMemEval (vendor-reported). Mem0 self-reports 92.5% on LoCoMo after an April 2026 rewrite. One cited benchmark was run by Cognee with tuned settings for itself and defaults for the others. — [atlan](https://atlan.com/know/best-ai-agent-memory-frameworks-2026/) (third-party)
- **Pricing (third-party, July 2026):** Mem0 is free up to 10k memories, then $19, $79 or $249/mo. Letta Pro is $20/mo. Zep Flex is $125/mo. All three can be self-hosted for free. — [developersdigest](https://www.developersdigest.tech/blog/best-ai-agent-memory-providers-2026)
- **Managed Agents memory stores:** they attach to sessions and deployments, including self-hosted environments via the API. — [Scheduled deployments](https://platform.claude.com/docs/en/managed-agents/scheduled-deployments)
- **External memory for plans:** Anthropic's research system saves plans to external memory and passes filesystem artifacts by reference. — [Anthropic engineering](https://www.anthropic.com/engineering/multi-agent-research-system)

### Inferences
- **Layered product brain:**
  1. Postgres "source of truth" tables for products, decisions, proposals and approvals.
  2. pgvector embeddings over transcripts and docs for retrieval.
  3. Optionally, Graphiti on the same data when temporal "what changed" queries become painful.
  4. Generated per-repo CLAUDE.md files and skills as the compressed context that coding agents actually load.
- **Approvals feed ranking:** storing approve/reject as rows makes them training signal for proposal ranking.

### Gaps
- The Claude memory tool docs, Graphiti self-host requirements (Neo4j/FalkorDB) and the Supabase pgvector limits were not fetched.

## MCP: hosting remote servers and exposing Central as an MCP server

### Takeaway
Remote MCP runs over Streamable HTTP with OAuth. Cloudflare documents scoped OAuth with step-up authorization and a "Code Mode" pattern, and the Agents SDK has an MCP client manager. Exposing Central as a remote MCP server lets the Claude apps (phone and desktop) and any agent query and act on it. Managed Agents can consume MCP servers directly, and MCP tunnels are in research preview.

### Cited Findings
- **Cloudflare MCP guidance:**
  - Remote servers use Streamable HTTP; clients authorize with OAuth.
  - Give each operation its own scope, and return an `insufficientScope()` challenge so the client can request more access (step-up).
  - Avoid sending every tool definition to the model: use "Code Mode", a small search-and-execute interface in front of a large API.
  - Define `inputSchema` and `outputSchema` for every tool and return matching `structuredContent`.

  — [CF MCP docs](https://developers.cloudflare.com/agents/model-context-protocol/)
- **Agents SDK MCP client:** includes an `MCPClientManager` capability. — [CF Agents docs](https://developers.cloudflare.com/agents/)
- **Managed Agents and MCP:** agents can include MCP servers. MCP tunnels are a limited research preview. — [Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview)

### Inferences
- **Where to host Central's MCP server:** Cloudflare (McpAgent with an OAuth provider) is the lowest-effort host. A Lambda-hosted Streamable HTTP server also works if staying all-AWS.
- **Use scopes for safety:** read tools vs act tools such as `approve_proposal` or `dispatch_agent`, with step-up auth for the act tools, gives a safe phone-side control surface.

### Gaps
- The McpAgent and OAuth provider pages and the AWS-hosted MCP options (AgentCore Gateway, Lambda) were not fetched.

## Human-in-the-loop: approval inbox, push and feedback into ranking

### Takeaway
The durable-wait primitive exists in every engine: Cloudflare `step.waitForEvent` (free while waiting), Inngest `waitForEvent`, Temporal Signals (each billed as an action), and Managed Agents sessions that pause and resume with steering events. The inbox itself is app-level: a table of pending approvals, a PWA with web push, and approve/reject sending an event that resumes the workflow.

### Cited Findings
- **Cloudflare:** waiting instances don't count toward concurrency, and waiting costs $0. — [CF limits](https://developers.cloudflare.com/workflows/reference/limits/); [CF Workflows](https://www.cloudflare.com/product/workflows)
- **Cloudflare Agents SDK:** the chat example includes HITL approvals; Slack, email and webhook channels exist. — [CF Agents docs](https://developers.cloudflare.com/agents/)
- **Managed Agents:** sessions can be steered or interrupted with user events. A budget pause (`budget_reached`) is itself an approval point. Webhooks report lifecycle events. — [Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview); [Scheduled deployments](https://platform.claude.com/docs/en/managed-agents/scheduled-deployments)
- **Temporal:** Signals are billable actions. — [Temporal pricing](https://temporal.io/pricing)

### Inferences
- **Pattern:**
  1. A proposal row (status `pending`) triggers a web push to the Angular PWA. Telegram is an optional fallback.
  2. Approve or reject hits an API that records the decision (with an optional reason) and emits `approval.decided`.
  3. The workflow resumes.
  4. Decision history becomes features or few-shot examples for the ranker.

### Gaps
- HumanLayer status in 2026, iOS PWA web push specifics, Expo and LangGraph interrupts were not researched in this pass.

## Event bus and webhook ingestion

### Takeaway
Supabase Queues (pgmq) gives a Postgres-native queue with exactly-once delivery within a visibility window, archiving, and RLS. It fits a Supabase-centric Central, where events, memory and proposals live in one database. EventBridge and Cloudflare Queues are alternatives if the orchestrator lives on AWS or Cloudflare.

### Cited Findings
- **Supabase Queues (pgmq):** Postgres-native with guaranteed delivery. "A Message is delivered exactly once to a consumer within a customizable visibility window." Supports archiving for audit and RLS/API permissions. — [Supabase Queues](https://supabase.com/docs/guides/queues)
- **Managed Agents webhooks:** they emit session, deployment and run events. — [Scheduled deployments](https://platform.claude.com/docs/en/managed-agents/scheduled-deployments)

### Inferences
- **Ingestion pattern:** webhook receivers (GitHub, meeting tools, Managed Agents) verify the signature, insert into `events` plus pgmq, and a consumer (pg_cron plus an Edge Function, or a workflow trigger) processes them. Idempotency keys are needed.

### Gaps
- EventBridge and Cloudflare Queues pricing, pgmq throughput, and Supabase Cron details were not fetched.

## Observability and cost control

### Takeaway
Hard per-run cost caps now exist natively in Managed Agents (`budget.max_list_cost`, which pauses at the cap). Langfuse remains the default open-source tracing tool: free to self-host, MIT core, acquired by ClickHouse in January 2026. Kill switches are best built as a deployment pause plus a central "agents enabled" flag checked by the orchestrator.

### Cited Findings
- **Managed Agents budgets:** per-session and per-deployment budgets (for example, a "2000" cap allows about $20 per run). Sessions pause with `budget_reached`. Deployments can be paused, unpaused or archived via the API. — [Scheduled deployments](https://platform.claude.com/docs/en/managed-agents/scheduled-deployments)
- **Langfuse:** MIT-licensed core, free to self-host, acquired by ClickHouse in January 2026 with self-hosting kept. Cloud pricing reports conflict: Core at $29/mo vs paid plans from about $59/mo. — [langwatch](https://langwatch.ai/blog/langfuse-vs-langsmith); [costbench](https://costbench.com/software/ai-observability/langfuse/) (third-party). LangSmith self-hosting requires Enterprise. — [agenticwire](https://www.agenticwire.news/article/langfuse-vs-langsmith-self-hosted)
- **Token cost:** multi-agent systems use about 15× the tokens of chat, so budgets matter more than compute. — [Anthropic engineering](https://www.anthropic.com/engineering/multi-agent-research-system)

### Inferences
- **Cost control:** compute (sandbox $0.1–0.2/h, session runtime $0.08/h) is minor next to tokens, so put guardrails on tokens: per-run budgets, daily org caps, and model tiering (Opus lead, Sonnet/Haiku workers).

### Gaps
- Official Langfuse pricing and the Claude Agent SDK's OpenTelemetry support were not verified.
