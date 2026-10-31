# AI coding-agent orchestrators, ADEs and cloud/background coding agents (as of Oct 31, 2026)

Research note scope: products + programmable surfaces (API/SDK/webhooks/MCP) to decide reuse vs build for a solo dev's personal orchestration center. ~17 tool calls; many sources are secondary (comparison blogs). Primary-source verification flagged per item. Dates of sources given when known.

## 1. Which products exist and what do they do today (execution model, parallelism, triggers, mobile, review UX, pricing, API)

### Takeaway
The market has split into (a) local ADEs/orchestrators that wrap CLI agents in git worktrees (Orca, Conductor, Sculptor, Vibe Kanban, which is winding down) with no cloud runtime and little or no external API, and (b) vendor cloud agents (Claude Code on the web plus Routines and Managed Agents, Codex Cloud, Cursor Cloud Agents, Devin, Copilot coding agent, Jules, Factory, Amp, Warp Oz, Kiro) that run in vendor sandboxes. Several of the cloud agents now expose an HTTP API to start a task. The ones with a documented "start task" API are Claude (Routines fire endpoint, Managed Agents API), Cursor (Cloud Agents API v0/v1), Devin (v3 sessions) and GitHub Copilot (assign issue via REST/GraphQL). For Codex Cloud, a public REST "create task" endpoint was not confirmed.

### Cited Findings

**Orca (stablyai), the user's current ADE**
- An open-source "Agent Development Environment" from Stably AI. It runs several coding agents in parallel, each in its own git worktree, and lets you compare diffs and merge the best result. Available via Homebrew cask `stablyai/orca/orca`, GitHub Releases, macOS/Windows/Linux. — [landscape.jimmysong.io](https://landscape.jimmysong.io/projects/orca/); [tenten guide](https://university.tenten.co/t/orca-ade-ai-agent-git-worktree/2535)
- Execution is local or over SSH on a remote machine (file editing, git, terminals, auto-reconnect, port forwarding). The site describes no hosted cloud runtime, though a user mentions running Orca on a VPS. — [onorca.dev](https://onorca.dev/)
- Has a CLI that lets agents control the environment (worktree create, snapshot, click, fill), plus MCP, hooks and skills support. There is an "Automations" section, but the page does not detail scheduling. No separate public API is described. — [onorca.dev](https://onorca.dev/)
- Companion app for iOS/Android pairs with desktop Orca: live agent status, usage, account switching, sending follow-ups. — [onorca.dev](https://onorca.dev/)
- GitHub/Linear integration: browse PRs/issues/boards, open a worktree from a task, review/approve PRs, inspect CI, resolve conflicts, open PRs, create Linear issues. — [onorca.dev](https://onorca.dev/)
- Free and open source, MIT license. Claims 27 supported agents (Claude Code, Codex, OpenCode, Gemini, Cursor, Copilot, Amp, Goose, Cline, Kiro, Qwen Code, ...) plus any CLI agent. It brings no models of its own and uses your installed and logged-in CLIs. — [onorca.dev](https://onorca.dev/); [landscape.jimmysong.io](https://landscape.jimmysong.io/projects/orca/)
- Popularity numbers conflict: about 45.4k GitHub stars in one source vs about 3.2k in an older SourcePulse snapshot. — [sourcepulse](https://www.sourcepulse.org/projects/27429804)

**Conductor**
- Still active. A free Mac desktop app that runs parallel Claude Code, Codex and Cursor agents in isolated workspaces (worktrees). No paid plan yet, with paid collaboration features planned. Mac-only, local. — [pivio ranking 2026](https://pivio.app/blog/best-claude-code-orchestrators-2026); [nimbalyst 2026](https://nimbalyst.com/blog/best-agent-management-tools-2026/) (secondary)

**Vibe Kanban (Bloop)**
- Bloop announced the shutdown on Apr 10, 2026. Remote services stayed up 30 days, then the product moved to fully local. The README still says "sunsetting", but commits resumed in Sep 2026 and v0.1.45 shipped to npm on Sep 19, 2026. Status is ambiguous, so treat it as unmaintained/community. — [vibecoding.app review](https://vibecoding.app/blog/vibe-kanban-review); [crewlyai](https://crewlyai.com/en/blog/vibe-kanban-alternative)

**Sculptor (Imbue)**
- Alive and free in beta. Runs Claude Code agents locally inside Docker containers. — [nimbalyst 2026](https://nimbalyst.com/blog/best-agent-management-tools-2026/) (secondary)

**Terragon**
- Shut down. The official page says that as of Feb 9, 2026 the service was shut down and all sandboxes terminated, and the code is open source at terragon-labs/terragon-oss. Some blogs say Jan 2026, which conflicts with the official page. — [terragonlabs.com](https://www.terragonlabs.com/)

**Claude Code (Anthropic): cloud sessions, Routines, Managed Agents**
- Claude Code on the web (claude.ai/code) runs sessions in Anthropic-hosted cloud environments. Each environment has a name, a network access level, .env-style variables and a setup script (Bash, runs before Claude Code starts, result cached). The setup script does not re-run when an idle VM is restored. — [code.claude.com cloud-environments](https://code.claude.com/docs/en/cloud-environments); [mirror](https://jiezhi.github.io/dochub/claude-code/cloud-environments/)
- `/web-setup` in the CLI syncs the local `gh` token and creates a default environment with Trusted network access. — [code.claude.com web-quickstart](https://code.claude.com/docs/en/web-quickstart)
- Several repositories can be attached to one session, and you can pick the starting branch. — [code.claude.com web-quickstart](https://code.claude.com/docs/en/web-quickstart)
- Sessions can be started and monitored from the Claude mobile app (Code tab). Plans: Pro, Max, Ultra, Team, Enterprise (premium seats). — [code.claude.com claude-code-on-the-web](https://code.claude.com/docs/en/claude-code-on-the-web.md); [fast.io guide](https://fast.io/resources/claude-code-web-interface-guide/)
- **Routines** (research preview): saved cloud agents that run on a schedule, on an API call or on a GitHub event. Created at claude.ai/code/routines, in Desktop, or via `/schedule` in the CLI (CLI-created routines are schedule-only, and API/GitHub triggers are added on the web). — [builder.io](https://www.builder.io/blog/claude-code-routines); [rickhigh substack](https://rickhigh.substack.com/p/claude-code-routines-running-your)
- Routines API: `POST /v1/claude_code/routines/{routine_id}/fire` with a per-routine bearer token (shown once, regenerating revokes the old one) and the header `anthropic-beta: experimental-cc-routine-2026-04-01`. Missing header returns 400. — [platform.claude.com routines-fire](https://platform.claude.com/docs/api/claude-code/routines-fire)
- Routine runs count against a per-account daily allowance that varies by plan, and they consume the same subscription usage as interactive sessions. GitHub triggers require the Claude GitHub App on the repo (`/web-setup` does not install it). — [platform.claude.com](https://platform.claude.com/docs/api/claude-code/routines-fire); [rickhigh](https://rickhigh.substack.com/p/claude-code-advanced-the-four-ways)
- **Claude Managed Agents** (API product): public beta since Apr 8, 2026, header `managed-agents-2026-04-01`. Billing is standard token rates plus $0.08 per session-hour of runtime (idle time excluded). This replaces Code Execution container-hour billing. Self-hosted sandboxes still pay the $0.08/session-hour. Batch and fast-mode discounts do not apply. Web search is $10 per 1k searches. — [verdent pricing guide](https://verdent.ai/guides/claude-managed-agents-pricing); [analyticsvidhya Jun 2026](https://www.analyticsvidhya.com/blog/2026/06/claude-managed-agents/); [medium fine print](https://medium.com/@sathishkraju/anthropics-managed-agents-i-read-the-fine-print-so-you-don-t-have-to-ed17b77e17c5) (all secondary; verify on Anthropic pricing page)

**OpenAI Codex (Cloud + CLI)**
- After DevDay (Sep 29, 2026), Codex Cloud runs tasks on OpenAI VMs. Flow: create an environment (pick GitHub repos, install deps), publish it, then start tasks. Unpublished environments cannot run tasks. Options include background repo refresh, per-environment internet policy (package-manager preset, custom domains, unrestricted), and network secrets substituted by a proxy so they never enter the sandbox. Plans: Plus, Pro, Business, Edu, Enterprise. — [apidog DevDay 2026 recap, Oct 2, 2026](https://apidog.com/blog/codex-devday-2026-updates/)
- CLI v0.159.1 (Sep 29, 2026) defaults to model "GPT-6.1 Sol". Worktree support has been on by default since 0.156.0. It adds `/agents`, `/worktree`, `/fork`, `/review`, `codex resume`, and `codex cloud` (hand work to the cloud, list cloud chats). — [apidog](https://apidog.com/blog/codex-devday-2026-updates/)
- Code Review: GitHub GA (`@codex review`, only P0/P1 flagged, rules go in `## Code Review Rules` in AGENTS.md). Codex Security Cloud (research preview) runs scheduled repo scans and opens draft fix PRs. — [apidog](https://apidog.com/blog/codex-devday-2026-updates/)
- Cloud tasks can be triggered from Slack and Linear. A Codex blog mentions `codex cloud exec` or the TypeScript SDK for embedding cloud tasks in pipelines, without detail. — [danielvaughan Codex blog, Mar 2026](https://codex.danielvaughan.com/2026/03/27/codex-slack-linear-cloud-tasks/)
- Claims of a beta REST `/v1/codex/cloud/tasks` endpoint (apidog) are unsourced and conflict with other guides. Treat as unverified. — [apidog endpoints post](https://apidog.com/pt/blog/what-api-endpoints-available-codex-2025)

**Cursor Cloud Agents (formerly background agents)**
- Cloud Agents API v1 is in public beta: `POST /v1/agents` creates a durable agent and queues its first run, with a split agent / per-prompt-run model and Basic or Bearer auth. The legacy v0 (`POST /v0/agents` plus status, conversation, follow-up, stop, delete) is still documented. — [mcpbundles blog](https://mcpbundles.com/blog/cursor-cloud-agents-api); [litellm pass-through docs](https://docs.litellm.ai/docs/pass_through/cursor.md); [mindcloud ref](https://mindcloud.co/docs/universal/rest/cursor/latest) (secondary; the official doc mirror URL returned 404)

**Devin (Cognition)**
- API v3 is organization-scoped: `POST /v3/organizations/{org_id}/sessions`. `devin_mode` accepts lite/normal/fast, and `create_as_user_id` lets a service user create sessions on behalf of a user. — [docs.devin.ai API release notes](https://docs.devin.ai/api-reference/release-notes)
- Open bug (filed Oct 29, 2026): sessions created via the API (origin=api) don't appear in the web app's Sessions list. — [CognitionAI/devin-cli#45](https://github.com/CognitionAI/devin-cli/issues/45)

**GitHub Copilot coding agent**
- Since Dec 3, 2025, issues can be assigned to Copilot via REST and GraphQL, with target repo, base branch and custom instructions. The agent opens a PR. — [github.blog changelog](https://github.blog/changelog/2025-12-03-assign-issues-to-copilot-using-the-api)
- From Actions, a working `gh api` call sets `agent_assignment` and assigns `copilot-swe-agent[bot]`, but the default `GITHUB_TOKEN` lacks permission to assign the bot, so a PAT or App token is needed. — [community discussion #186820, Feb 2026](https://github.com/orgs/community/discussions/186820)

**Google Jules**
- Async agent on GitHub. Tasks can be assigned via a `jules` label on an issue. A Jules API exists (HTTPS, Google Cloud token auth) per secondary sources, but the official reference was not verified. Pricing reports conflict ($20/mo vs tiered plans on the official page). — [jules.google](https://jules.google/); [tembo Jules alternatives](https://www.tembo.io/blog/jules-alternatives); [vibecodinghub review](https://vibecodinghub.org/tools/jules)

**Factory (Droids), OpenHands, Amp, Warp Oz, Kiro** (all secondary sources)
- Factory: Droids run locally, in Factory-managed cloud, or in private deployments. They can be started from Slack or the app. Pro tier is about $20/mo, and managed computers start around $100/mo. — [mastra software-factory list](https://mastra.ai/articles/best-software-factory); [northflank Devin alternatives](https://northflank.com/blog/top-devin-ai-alternatives-for-autonomous-coding)
- OpenHands: open source and self-hostable with your own keys. OpenHands Cloud is the hosted offering, with a free tier of about 10 conversations/day. — [northflank](https://northflank.com/blog/top-devin-ai-alternatives-for-autonomous-coding)
- Amp: independent of Sourcegraph since Dec 2025. Remote "orbs" keep running after the laptop closes and are reachable from terminal, web or phone. Free Hobby tier. — [getrush Amp alternatives](https://getrush.ai/compare/amp-alternatives/)
- Warp Oz: cloud orchestration layer that runs agents (including external harnesses such as Claude Code and Codex) in Docker-based sandboxes per run. Limited cloud agents on the free tier. Sources conflict on licensing: Wikipedia says Oz was open-sourced Apr 2026, AgentsCamp says Oz is proprietary and only the client is AGPL-3.0. — [Wikipedia Warp](https://en.wikipedia.org/wiki/Warp_(terminal)); [agentscamp](https://agentscamp.com/guides/comparisons/best-claude-code-alternatives-2026); [augmentcode Kiro vs Warp](https://www.augmentcode.com/tools/kiro-vs-warp)
- Kiro (AWS): spec-driven agentic IDE that replaced Amazon Q Developer. Native iOS app in Jun 2026, cloud sessions in preview from Aug 2026. — [augmentcode Kiro vs Warp](https://www.augmentcode.com/tools/kiro-vs-warp); [openchamber 36 tools](https://openchamber.dev/blog/ai-coding-agents/)

### Inferences
- **Programmable "start task in repo X with prompt Y, get status/PR" surfaces, ranked by maturity:**
  - Devin v3 and Copilot's assign-issue API: documented, but per-seat/ACU priced and closed.
  - Cursor Cloud Agents API: v1 beta, with full lifecycle endpoints.
  - Claude Managed Agents API: general-purpose agent sessions, pay-per-token plus runtime.
  - Claude Routines fire: only fires a pre-configured routine, research preview, per-routine token, uses subscription quota. Good for subscription-funded night shifts.
  - Codex: CLI/SDK-driven, no confirmed public REST task API.
- Local ADEs (Orca, Conductor, Sculptor) are UIs, not orchestration backends. Orca's CLI plus SSH worktrees are the closest to scriptable, but it has no cloud runtime and no scheduler API.
- Product churn is high: Terragon died in Feb 2026, Vibe Kanban in Apr 2026. Building tightly on a small ADE startup is risky. Vendor APIs (Anthropic, OpenAI, GitHub) are more durable but beta-flagged.
- For a Claude Max subscriber, Routines plus the cloud environments approximate "scheduled agents in cloud sandboxes up to PR, controllable from phone" with zero build. The missing parts are a cross-vendor queue, a summary dashboard, and multi-repo/deploy coordination.

### Gaps
- Official Cursor v1 docs could not be fetched (mirror 404). Webhook support and auto-PR parameters are unverified.
- No current pricing collected for Cursor, Devin (ACU), Copilot (premium requests), Codex or Claude plans. Re-check vendor pricing pages (prices as of Oct 2026 not verified).
- Charlie (Charlie Labs) and other 2026 entrants were not researched due to the tool-call budget.
- Whether Claude Code supports outbound webhooks or a status/list-sessions API for cloud sessions beyond Routines fire was not verified. Claude Agent SDK and Claude Code GitHub Actions details were not fetched in this pass.
- Whether Orca "Automations" include cron scheduling is unknown.

## 2. Multi-repo task support

### Takeaway
Explicit multi-repo support was confirmed for Claude Code on the web (several repos per session) and Codex Cloud environments (pick GitHub repos when creating the environment). Most other tools are one-repo-per-task (Copilot assigns per issue/repo, Devin/Cursor per repo as far as found), so cross-repo changes (Lambda + API GW Terraform + Angular) still need an orchestrator that fans out per-repo tasks and links the PRs.

### Cited Findings
- Claude Code on the web: you can attach several repositories to one session. — [code.claude.com web-quickstart](https://code.claude.com/docs/en/web-quickstart)
- Codex Cloud environment setup includes picking GitHub repositories (plural) and installing deps. — [apidog DevDay recap](https://apidog.com/blog/codex-devday-2026-updates/)
- Copilot assign-issue API takes a target repo and base branch per assignment. — [github.blog](https://github.blog/changelog/2025-12-03-assign-issues-to-copilot-using-the-api)
- Practitioner pattern: a multi-repo workspace (parent folder with several repos) is where agents "actually shine". — [medium multi-repo workspace](https://medium.com/@sunghyunroh/multi-repo-workspace-strategy-the-structure-where-ai-coding-agents-actually-shine-4ed6b87fb11d)

### Inferences
- With about 70 repos, a "workspace manifest" per product (which repos form one product) is the key custom artifact, whatever runtime is chosen.
- It is unclear whether Claude multi-repo sessions can open coordinated PRs in each repo. Needs a hands-on test.

### Gaps
- Multi-repo behavior of Cursor, Devin, Factory and Jules not verified.

## 3. Known limitations and complaints from heavy users

### Takeaway
The dominant complaint is that review, not generation, becomes the bottleneck, followed by token cost scaling super-linearly with parallel agents, merge/conflict overhead, and vendor-specific flakiness (preview features, API sessions not visible in the UI, product shutdowns).

### Cited Findings
- HN (Mar 2026), thread on "AI coding agents generate more code, but not more software": commenters say review was already the bottleneck and agents make it worse, and automated review hasn't delivered practical gains yet. — [HN 50059523](https://news.ycombinator.com/item?id=50059523)
- Simon Willison: "the natural bottleneck on all of this is how fast I can review the results." — [practicalaidatascience substack](https://practicalaidatascience.substack.com/p/one-developer-multiple-agents-parallel)
- "Five parallel agents won't make you 5x faster. You are the queue." — [dev.to](https://dev.to/gabrielanhaia/five-parallel-coding-agents-wont-make-you-5x-faster-you-are-the-queue-4peo)
- Multi-agent configurations used about 15x the tokens in one controlled study, with non-monotonic returns as agents were added. — [arXiv 2608.13867](https://arxiv.org/pdf/2608.13867)
- Merge/conflict resolution, rather than generation, is where much of the real time cost lands. One vendor-style estimate budgets review tooling at 1.5-2x generation cost. — [codacy](https://blog.codacy.com/does-your-engineering-team-have-a-parallelization-strategy-for-ai-coding-agents-2026); [agentconn](https://agentconn.com/blog/10x-prs-1x-reviewers-code-quality-bottleneck-gate-2026/)
- Vendor-specific issues:
  - Devin API sessions are invisible in the UI (Oct 2026). — [devin-cli#45](https://github.com/CognitionAI/devin-cli/issues/45)
  - Claude Routines are a research preview with daily caps that share subscription quota. — [platform.claude.com](https://platform.claude.com/docs/api/claude-code/routines-fire)
  - Claude cloud setup scripts don't re-run on VM restore, so environments can be stale. — [cloud-environments mirror](https://jiezhi.github.io/dochub/claude-code/cloud-environments/)
  - Copilot's default `GITHUB_TOKEN` can't assign the agent. — [discussion #186820](https://github.com/orgs/community/discussions/186820)
- Shutdown risk: Terragon (Feb 2026) and Vibe Kanban (Apr 2026). — [terragonlabs.com](https://www.terragonlabs.com/); [vibecoding.app](https://vibecoding.app/blog/vibe-kanban-review)

### Inferences
- For a solo dev, the orchestrator's highest-value feature is review triage (morning summary, risk scoring, CI status, auto-review gate such as `@codex review` or Claude review), not maximum parallelism.
- Cost control favors subscription-funded runs (Claude Max Routines/cloud sessions, ChatGPT Pro Codex cloud) over per-token API agents for night shifts, as long as quotas allow.

### Gaps
- Little hard data on sandbox flakiness rates or context loss per vendor. Evidence is anecdotal.

## 4. Open-source building blocks to roll your own

### Takeaway
A DIY stack is feasible: agent harness (Claude Agent SDK / Claude Code headless, Codex CLI/SDK, OpenHands) + sandbox (E2B, Daytona, Modal, Cloudflare Sandbox, Vercel Sandbox, Fly Machines) + a queue/scheduler + GitHub App for PRs. Alternatively, use Claude Managed Agents as hosted harness plus sandbox. Sandbox compute is cheap relative to tokens (about $0.05-0.13 per vCPU-hour).

### Cited Findings
- Per vCPU-hour: E2B and Daytona about $0.0504, Modal about $0.071 ($0.142 per 2-vCPU core), Cloudflare about $0.072 (active CPU only), Vercel about $0.128 (active CPU only). — [northflank pricing](https://northflank.com/blog/ai-sandbox-pricing); [marktechpost Aug 2026](https://www.marktechpost.com/2026/08/27/best-agent-sandboxes-2026-cold-start-pricing-network-policy/)
- Memory per GiB-hour: E2B/Daytona about $0.0162, Modal about $0.024, Vercel about $0.0212, Cloudflare about $0.009. — [northflank](https://northflank.com/blog/ai-sandbox-pricing)
- Billing model: Vercel and Cloudflare bill active CPU only (better for idle agents waiting on LLM calls). E2B, Daytona and Modal bill full price while running. — [fly.io learn](https://fly.io/learn/ai-sandbox-pricing/); [northflank](https://northflank.com/blog/ai-sandbox-pricing)
- Plan fees: E2B Pro $150/mo, Modal Team $250/mo, Vercel Pro $20/mo, Cloudflare Workers Paid $5/mo, Daytona pay-as-you-go with $200 free credit. — [northflank](https://northflank.com/blog/ai-sandbox-pricing)
- Cold start (Aug 2026 benchmark): Vercel and Modal under 1s, E2B about 1.6s, Cloudflare about 5s, Daytona about 0.3s but only a 37% success rate in that run. Another source puts Daytona at about 90ms and E2B at about 150ms. One source claims Daytona was "closed" (no longer open-source) from Jun 2026, which conflicts with others. — [marktechpost](https://www.marktechpost.com/2026/08/27/best-agent-sandboxes-2026-cold-start-pricing-network-policy/); [upstash 15 providers](https://upstash.com/blog/ai-agent-sandbox-providers-compared-2026)
- Claude Managed Agents can run on self-hosted sandboxes (still $0.08/session-hour) or on Anthropic's. — [verdent](https://verdent.ai/guides/claude-managed-agents-pricing)
- Terragon's full background-agent platform is open source (terragon-labs/terragon-oss), a reference implementation of a cloud-sandbox coding-agent orchestrator. — [terragonlabs.com](https://www.terragonlabs.com/)
- OpenHands is open source and self-hostable with BYO model keys. — [northflank](https://northflank.com/blog/top-devin-ai-alternatives-for-autonomous-coding)
- Warp Oz is possibly open-source orchestration (license disputed, see section 1). — [Wikipedia](https://en.wikipedia.org/wiki/Warp_(terminal))

### Inferences
- An 8-hour night shift with 5 parallel 2-vCPU/4GiB sandboxes costs about 5 x 8 x (2 x 0.05 + 4 x 0.016) ≈ $6.6 on E2B/Daytona rates, tiny compared with token cost. Sandbox choice should be driven by DX, network policy and secrets handling, not price.
- The cheapest build path that reuses the user's existing stack is a thin control plane, for example on AWS (Lambda + SQS/EventBridge Scheduler + DynamoDB) or Cloudflare (Workers + Durable Objects + Sandbox SDK). It would dispatch to (1) Claude Routines/cloud sessions or Managed Agents, (2) Codex cloud via CLI/SDK, (3) Cursor/Copilot APIs, and aggregate PRs via the GitHub API into a mobile-friendly dashboard. Building your own sandbox harness only pays off if vendor quotas or multi-repo needs block you.
- terragon-oss is worth reading before writing from scratch.

### Gaps
- Claude Agent SDK, Codex SDK (TS/Python) and OpenHands SDK APIs were not fetched in this pass. Capabilities (session resume, streaming, hooks) are unverified here.
- Fly Machines pricing and Cloudflare Containers limits for long-running (multi-hour) agent jobs were not collected.
- License status of Daytona and Warp Oz needs primary verification.
