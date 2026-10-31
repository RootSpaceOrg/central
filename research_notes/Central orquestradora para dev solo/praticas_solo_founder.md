# How AI-native solo founders operate with agents (2025-2026), and how to design for low motivation and decision fatigue

Research date: 2026-10-31. About 20 tool calls. Many popular sources here are secondary (blogs, aggregators, translated reposts). Founder revenue figures are almost always **self-reported and unaudited**. Each finding below is labelled with how reliable its source is.

## 1. Case studies: solo and tiny teams running products with AI agents

### Takeaway
The verified "solo with AI" winners are fewer and less solo than the discourse says. Base44 had 8 staff at exit. Medvi has 2 people and is an operations/marketing business, not an AI product. Marc Lou made about $1M in 2025, down 20% from 2024, from a portfolio where 3-4 products earn almost everything. The recurring pattern is: many cheap launches, quick abandonment of failures, a small core of earners, and one persistent session or workspace per product.

### Cited Findings
- **Marc Lou (primary source, his own newsletter, Jan 2026):** reports $1,032,000 earned in 2025 and says he made 20% less than in 2024, but had "more peaceful (better work/life balance)" and more diversified revenue. ShipFast and CodeFast "make around $20K/month each". DataFast is at $15.8K MRR, growing 14% MoM with about 7% churn, and he values it at about 4x ARR (about $800K). TrustMRR hit $25K MRR a few days after its Oct 2025 launch. — [Marc Lou newsletter](https://marclou.com/p/i-made-1-032-000-in-2025)
- **Marc Lou's kill pattern:** he launched 3 other startups in 2025: BioAge (failed), ClipMarc (failed), and one secret project. On TrustMRR he tried 10 verticals and 9 failed. He then pivoted to a buy/sell marketplace that "took off". For roadmap direction on DataFast he says he has "no idea what's next" and builds what power users ask for. Lesson he states: "Having an audience doesn't guarantee a successful startup." The post does not describe how he uses AI agents. — [Marc Lou newsletter](https://marclou.com/p/i-made-1-032-000-in-2025)
- A secondary analysis says his TrustMRR profile lists 17 products with verified revenue, but 4 of them dominate. — [Remarkable Magazine](https://remarkablemag.com/marc-lou-shipfast-fifteen-startups-one-million/) (secondary)
- **Marc Lou's operating rituals:** 10K steps per day, no alcohol, lifting on 340+ days, reads 10 books a year. Health is treated as an operating input. — [Marc Lou newsletter](https://marclou.com/p/i-made-1-032-000-in-2025)
- **Pieter Levels:** the only description of his Claude Code setup comes from a widely reposted secondary article, not his own posts. It says he runs Claude Code on a VPS, connects via Termius, keeps one tmux session per product directory, and leaves Claude Code open in each so he can resume from laptop or phone. The article's revenue figures are inconsistent: the headline says $1.6M/yr, a table says $80K monthly profit, and the $105K/mo Photo AI figure dates from March 2024. — [YouMind repost](https://youmind.com/pt-BR/landing/x-viral-articles/claude-code-solo-business-workflow) (secondary, treat with caution)
- **Tony Dinh (TypingMind):** a news report says the founder announced $1M annual revenue about 20 months after the Mar 2023 launch (Nov 2024, older source). Latka estimates 2024 revenue at $817.3K with a team of 3. A Mar 2026 newsletter claims $130-160K/month with no employees. These conflict on headcount and none is a primary source. — [AIBase](https://news.aibase.com/news/14433); [Latka](https://getlatka.com/companies/typingmind); [Nomadpreneur](https://nomadpreneur.beehiiv.com/p/solo-founder-who-turned-100-into-1-500-000-no-team-no-investors)
- **Base44 (Maor Shlomo):** Wix bought it for $80M cash in June 2025, about 6 months after he started building. Lenny's Newsletter says it reached about $1M ARR 3 weeks after launch. Calcalist reports 8 employees at the deal, who shared $25M in retention bonuses. Forbes says he had zero employees until the week before close. The sources conflict on how "solo" it really was. — [Lenny's Newsletter](https://www.lennysnewsletter.com/p/the-base44-bootstrapped-startup-success-story-maor-shlomo); [Calcalist](https://www.calcalistech.com/ctechnews/article/y0kdgmw7a); [Inc](https://www.inc.com/ben-sherry/vibe-coding-base44-wix-avishai-abrahami-maor-shlomo/91267959); [Forbes](https://www.forbes.com/sites/nehamehra/2026/08/03/why-ai-agent-startups-are-becoming-the-new-solo-founder-playbook/)
- **Medvi (Matthew Gallagher), the "one-person unicorn" story:** NYT profile, Apr 2026. Dealroom reports $401M revenue and $65M net profit in 2025, on track for $1.8B in 2026, started with $20K, about a dozen AI tools, and later one employee (his brother). Gallagher himself said: "It's not an AI company, but I did it with A.I." Critics call the NYT portrait "highly questionable but glowing". The figures are self-reported, and the business is GLP-1 telehealth with outsourced clinical and fulfilment operations. — [Dealroom](https://dealroom.co/news/127216-from-20k-to-1-8b-in-revenue-how-one-founder-built-a-telehealth-giant-wit/); [TeleCareAware critique](https://telecareaware.com/tag/matthew-gallagher/); [Il Post](https://www.ilpost.it/2026/04/10/mito-startup-unicorno-un-solo-dipendente/)
- A Taskade blog (Mar 2026 status) says no one-person $1B company had yet been achieved. Sam Altman's prediction of billion-dollar solo companies remains a prediction. — [Taskade](https://www.taskade.com/blog/one-person-companies); [Forbes](https://www.forbes.com/sites/nehamehra/2026/08/03/why-ai-agent-startups-are-becoming-the-new-solo-founder-playbook/)
- **Productivity reality check (METR RCT, Feb-Jun 2025):** 16 experienced developers worked 246 real tasks in repos they knew well. With AI allowed, tasks took **19% longer**. Developers had expected a 24% speed-up, and afterwards still believed they had been 20% faster. Caveats: small sample, early-2025 tools, and 56% had never used Cursor before. — [Simon Willison summary](https://simonwillison.net/2025/Jul/12/ai-open-source-productivity/); [eWeek](https://eweek.com/news/news-ai-tools-slow-developer-productivity-study)

### Inferences
- The real lever in these stories is **distribution plus portfolio churn** (launch many, keep the few that work). Agent tooling is the second lever. A "million-dollar" orchestration center should optimise for cheap launches, fast kill decisions and doubling down on winners, not only for coding throughput.
- The METR perception gap means a solo founder cannot trust his own feeling of being productive. The system should measure output that matters (shipped changes, revenue movement), not agent activity.
- Pattern worth copying from Levels (even if only secondarily sourced): one persistent, resumable agent workspace per product, reachable from a phone.

### Gaps
- No primary 2025-2026 source on Pieter Levels' or Danny Postma's agent workflow, cadence or numbers.
- No primary Tony Dinh revenue figure for 2025.
- No Anthropic or OpenAI customer stories about solo multi-product founders were retrieved.
- No source gave explicit numeric kill criteria from these founders.

## 2. Handling the review bottleneck, quality control, specs-first work and context across repos

### Takeaway
Every heavy user names human review as the constraint. The practices that converge across sources: plan or spec first, give the agent a way to verify its own work (tests, browser, a "verify" subagent), isolate sessions (separate checkouts or worktrees), keep a living CLAUDE.md of past mistakes, and send parallel agents only low-review-cost work (research, scouting, small maintenance). Accept that 10-20% of sessions will be thrown away.

### Cited Findings
- **Boris Cherny (Claude Code creator), Jan 2026 thread:**
  - Runs about 5 local terminal sessions plus 5-10 remote sessions on claude.ai/code, and abandons 10-20% because of unexpected scenarios. — [InfoQ](https://infoq.com/news/2026/01/claude-code-creator-workflow/); [Threadreader](https://threadreaderapp.com/scrolly/2007179832300581177)
  - Plan mode first, iterating until the plan is right, then auto-accept: "A good plan is really important!" — [InfoQ](https://infoq.com/news/2026/01/claude-code-creator-workflow/)
  - Giving Claude a verification loop (tests, bash, browser via the Chrome extension) improves results "2-3x" (his claim). He uses a verify-app subagent. — [InfoQ](https://infoq.com/news/2026/01/claude-code-creator-workflow/)
  - Team CLAUDE.md is checked into git, records mistakes and conventions, is about 2.5k tokens, and coworkers' PRs are tagged to add learnings. — [InfoQ](https://infoq.com/news/2026/01/claude-code-creator-workflow/)
  - A PostToolUse hook runs the formatter. Slash commands live in `.claude/commands/`. `/commit-push-pr` is used "dozens of times a day" and precomputes git status with inline bash. He uses a permission allowlist instead of `--dangerously-skip-permissions`, except in sandboxes. — [InfoQ](https://infoq.com/news/2026/01/claude-code-creator-workflow/)
  - Uses Opus with thinking for everything: slower per token but fewer corrections. — [InfoQ](https://infoq.com/news/2026/01/claude-code-creator-workflow/)
- **Simon Willison (Oct 2025):** "the natural bottleneck on all of this is how fast I can review the results". He can review and land only **one significant change at a time**. What he delegates in parallel: research/proofs of concept, codebase explanations (saved as context for later), small maintenance (deprecation warnings), carefully specified work ("makes review much less taxing"), and "scouting" (letting an agent attempt a hard task, not to merge it, but to learn which files are involved). He uses fresh checkouts in /tmp rather than worktrees, and Codex Cloud for async tasks launched from his phone. — [Simon Willison](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/)
- A practitioner guide warns that more agents means more tokens, review load and integration risk. Its advice: scale only after task boundaries, tests and review are working. — [aakashx](https://www.aakashx.com/blog/parallel-claude-code-agents/) (blog)
- One write-up says that running 3-5 instances makes the developer the bottleneck, because he alone tracks the state of every workstream. — [Engineered Intelligence](https://engineeredintelligence.substack.com/p/orchestrate-to-survive-the-speed) (blog)
- Solo-dev patterns seen in the wild: fixed agent roles (writer/reviewer/tester/architect) dispatched before commit, and a "review swarm" of 3 parallel reviewers (quality, business logic, security) followed by a fix-and-re-review loop. — [dev.to multi-agent](https://dev.to/javatarz/multi-agent-development-workflows-with-claude-code-n23); [dev.to 37 agents](https://dev.to/asklokesh/how-i-built-an-autonomous-ai-startup-system-with-37-agents-using-claude-code-2p79) (anecdotal)
- METR found developers spent about 9% of their time reviewing and cleaning AI output. — [GetDX summary](https://getdx.com/blog/metr-study-on-how-ai-affects-developer-productivity/)

### Inferences
- For the approval inbox, every proposal should arrive **pre-verified**: tests run, preview URL or screenshot attached, risk tier stated. That way the human judges intent and taste, not correctness line by line.
- Suggestion mode should mostly route **low-review-cost work** (research, scouting reports, small maintenance, already-specced tasks). Novel or architectural work belongs in pilot mode.
- Budget for a 10-20% discard rate: "reject" should be cheap and normal, not a failure state.
- Keep per-product context files (CLAUDE.md, learnings) as the main defence against context loss across repos. Feed reviewer rejections back into them, as Cherny's team does.

### Gaps
- No rigorous data on PR merge or acceptance rates for solo multi-repo setups.
- No source measured the review bottleneck quantitatively in 2026.

## 3. Proactive AI assistants and "chief of staff" agents: what exists, what users like and hate

### Takeaway
Proactive features (ChatGPT Pulse, Motion auto-scheduling) are valued when they arrive as a bounded, once-a-day digest the user controls. They are disliked when they interrupt mid-task, reshuffle plans without approval, or create a feeling of lost agency. Research on proactive coding assistants shows timing matters more than suggestion quality, and recommends backing off when users keep dismissing suggestions.

### Cited Findings
- **ChatGPT Pulse (Sep 2025):** Pro-only mobile preview that runs overnight and delivers a once-a-day brief. Users can give feedback or dismiss items, connectors are off by default, and OpenAI acknowledged it may show irrelevant items. — [Axios](https://www.axios.com/2025/09/25/chatgpt-prompts-you-pulse-openai); [Vaizle](https://insights.vaizle.com/news/openai-launches-chatgpt-pulse-a-once-a-day-brief-inside-chatgpt-that-runs-overnight)
  - Axios raised privacy and intrusiveness concerns. HN criticism that AI-initiated messaging feels "obnoxious" is cited only secondhand. — [Axios](https://www.axios.com/2025/09/25/chatgpt-prompts-you-pulse-openai)
- **CHI 2025 "Need Help?":** participants in the persistent-suggestion condition found the assistant distracting and annoying even though it improved productivity. The authors recommend lowering frequency when users keep dismissing suggestions. — [ACM](https://dl.acm.org/doi/10.1145/3706598.3714002); [alphaXiv](https://www.alphaxiv.org/abs/2410.04596)
- **Five-day field study (15 developers, 229 proactive interventions, 2026):** proactive suggestions were read faster than reactive ones, and trust rose when users could inspect edits before applying them. Secondary write-ups report about 52% engagement with suggestions shown **after a commit**, versus about 62% dismissal of suggestions shown **mid-task** (not verified against the paper). — [arXiv](https://arxiv.org/html/2601.10253v1); [ACM](https://dl.acm.org/doi/10.1145/3742413.3789148); [RDEL summary](https://rdel.substack.com/p/rdel-166-when-are-developers-receptive)
- **Motion (auto-scheduler):** Justuseapp's NLP analysis of about 1,846 reviews finds about 61% positive and 31% negative. Complaints: onboarding takes 2-4 weeks to fit, cluttered UI, weak mobile app, price increases. Reviewers say "automation can feel like losing agency" and that it reshuffles plans without approval. — [Justuseapp](https://justuseapp.com/en/app/1580440623/motion-tasks-ai-scheduling/reviews); [Saner](https://www.saner.ai/blogs/motion-reviews); [Morgen comparison](https://www.morgen.so/blog-posts/sunsama-vs-motion)
- **Sunsama, by contrast:** a guided daily planning ritual (15-20 minutes a day) that users describe as calming and preventing overwhelm. Sunsama's own roadmap page claims ex-Motion users found Motion "too opinionated and proactive" and spent time correcting it. That is the vendor's view of a competitor. — [Morgen](https://www.morgen.so/blog-posts/sunsama-vs-motion); [Sunsama roadmap](https://roadmap.sunsama.com/improvements/p/automatically-schedule-tasks-to-calendar)
- Notification fatigue, where users ignore agent outputs when volume is high relative to signal, is described as a failure mode in a non-peer-reviewed practitioner post. — [Zylos](https://zylos.ai/research/2026-05-28-proactive-ai-agents-autonomous-monitors/)

### Inferences
- Design suggestion mode as a **pull-based daily digest** (like Pulse or a Sunsama-style ritual), not push notifications. Push only for blocking or urgent items.
- Never auto-apply plan changes silently. Propose them, then let the user approve with one tap. Agency preservation is the main thing users ask of proactive tools.
- Track dismissal rate per proposal type and automatically reduce how often the agent proposes types that keep getting rejected (the CHI recommendation).
- Deliver suggestions at natural breakpoints (after a deploy or merge, start of day), never mid-flow in pilot mode.

### Gaps
- No good user research retrieved on Lindy, Reclaim, Notion AI agents, ChatGPT Tasks, or Claude's proactive and scheduled features. The main sources would be product docs and reviews.
- No systematic post-launch survey on Pulse.

## 4. Behavioural science for executing on low motivation, applied to an approval inbox

### Takeaway
The most robust tools are **defaults** (d = 0.68) and **implementation intentions / if-then plans** (d = 0.65; 2024 update d = 0.27-0.66). Choice overload is real but depends on context. It grows with set complexity, task difficulty and preference uncertainty, which is exactly the low-energy state, so cap the options shown. "Decision fatigue" as ego depletion did **not** replicate well, so design for cognitive load and friction rather than a "willpower tank". Streaks can backfire after a break (the "what-the-hell" effect).

### Cited Findings
- **Choice overload:**
  - Chernev et al. 2015 meta-analysis (99 observations, N = 7,202) found four moderators: choice-set complexity, decision-task difficulty, preference uncertainty, and decision goal. With these moderators accounted for, assortment size has a significant overload effect. — [Kellogg](https://www.kellogg.northwestern.edu/academics-research/research/detail/2015/when-product-assortment-leads-to-choice-overload-a-conceptual/) (2015, older)
  - The earlier Scheibehenne et al. 2010 meta-analysis found a mean effect of about zero with high variance. — [Scheibehenne 2010](https://abcwest.cogs.indiana.edu/pmwiki/pdf/scheibehenne.options.2010.pdf) (older)
  - A 2022 review concludes that whether the effect appears depends heavily on context. — [arXiv 2212.03931](https://arxiv.org/html/2212.03931v2)
  - No source validates "3 options" as a magic number. It is a heuristic.
- **Defaults:**
  - Jachimowicz et al. 2019 meta-analysis (58 studies, N = 73,675): d = 0.68 (95% CI 0.53-0.83), with large heterogeneity. Defaults work better in consumer domains, and ease of decision did not moderate the effect. — [Princeton](https://collaborate.princeton.edu/en/publications/when-and-why-defaults-influence-decisions-a-meta-analysis-of-defa/); [Columbia press release](https://business.columbia.edu/press-release/cbs-press-releases/defaults-are-not-same-default) (2019, older)
  - Mertens et al. 2022 report about 0.62 for switching opt-in to opt-out. — [MPRA](https://mpra.ub.uni-muenchen.de/113398/9/MPRA_paper_113398.pdf)
- **Implementation intentions:**
  - Gollwitzer & Sheeran 2006: 94 tests, d = 0.65 on goal attainment. — [Uni Konstanz](https://kops.uni-konstanz.de/entities/publication/2e749bfb-8533-437c-8203-7e788c910c5f) (older)
  - Sheeran, Listrom & Gollwitzer 2024 update (642 tests): d = 0.27-0.66. Effects are stronger with an explicit if-then format, with higher motivation, and when the plan is rehearsed. — [goalsandprogress summary](https://goalsandprogress.com/implementation-intentions-research/) (secondary)
- **Decision fatigue and ego depletion:**
  - Hagger et al. 2016 multilab preregistered replication (23 labs, N = 2,141) failed to find the effect. Defenders argue the manipulation was weak. — [PMC commentary](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4971805/); [Frontiers](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2016.01155/epub) (2016, older)
  - The "hungry judges" parole study (Danziger 2011) has been challenged on non-random case order and on prisoners without lawyers going last. — [Annie Duke](https://www.annieduke.com/?p=3122)
- **Streaks:**
  - The what-the-hell effect: a single lapse triggers abandonment, first observed in dieting research. — [EFPSA](https://more.efpsa.org/rpblog/?p=1172)
  - A medRxiv preprint (17 interviews, not peer-reviewed) suggests that breaking a long run streak can hurt wellbeing and lead to quitting the activity when the streak was the main motive. — [medRxiv](https://www.medrxiv.org/content/10.1101/2024.12.26.24319676.full.pdf)
  - A related cheating "what-the-hell" replication failed. — [FORRT](https://forrt.org/flora-replication-atlas/doi/10.1037/e722852011-095/)

### Inferences (apply to the approval inbox)
- **Default-accept with an easy undo:** each card shows one recommended action, pre-selected, plus a one-tap reject or snooze. Reversibility lowers the stakes of approving, so the inbox should state "reversible: yes/no" on every card and keep a rollback path (revert PR, feature flag).
- **Cap visible choices:** show at most 3 alternatives per card and a short queue per session (for example 5-10 cards). Low energy is high preference uncertainty, which is exactly where overload bites. "3" is a heuristic, not evidence-based.
- **Turn approvals into if-then plans:** when he approves a big item, the system auto-creates a concrete "when X, then I/agent do Y" next step, already scheduled. That is the implementation-intention format, which has the strongest evidence.
- **Tiny next step:** every proposal should end in a 1-action next step (approve, look at preview, answer one question). The evidence for this is indirect, via implementation intentions and reducing task difficulty (a Chernev moderator).
- **Avoid fragile streaks:** use cumulative, non-resetting progress (shipped count, MRR delta) instead of daily streaks that punish a missed day.
- Do not build on the "willpower battery" model. Design for low friction and low cognitive load at all times. Energy-mode switching (pilot vs suggestion) is still sensible as **user-declared state**, not as an inferred depletion.
- Swipe-style judging fits binary approve/reject on pre-verified, reversible items. Irreversible or high-cost items (pricing changes, deleting data, public posts) should need an explicit confirm, never a swipe.

### Gaps
- No ADHD-specific peer-reviewed evidence was retrieved on productivity app design, streaks or energy matching.
- No study was found on Tinder-style swipe UIs for work approvals.
- No validated research on "energy-based task matching".

## 5. Business side: choosing which product to push, kill criteria, rituals

### Takeaway
Real operators run portfolios with heavy power-law concentration (a few products earn most of the money) and kill or pivot quickly when a launch fails (Marc Lou: 2 failed startups and 9 of 10 TrustMRR verticals in one year). Focus decisions follow traction and power-user requests. I found no published, numeric kill criteria from these founders.

### Cited Findings
- Marc Lou: 2025 portfolio of ShipFast and CodeFast (about $20K/mo each, his main income), DataFast ($15.8K MRR, +14% MoM), and TrustMRR ($25K MRR soon after launch). He killed BioAge and ClipMarc, and 9 of 10 TrustMRR verticals failed before a pivot worked. He values products at about 4x ARR. — [Marc Lou](https://marclou.com/p/i-made-1-032-000-in-2025)
- 4 of his 17 revenue-verified products dominate. — [Remarkable Magazine](https://remarkablemag.com/marc-lou-shipfast-fifteen-startups-one-million/) (secondary)
- Diversification was an explicit goal: 20% less revenue in exchange for lower dependency and better balance. — [Marc Lou](https://marclou.com/p/i-made-1-032-000-in-2025)

### Inferences
- An agent-run weekly review can compute, per product: MRR, MoM growth, churn, implied value (multiple of ARR), and hours or tokens spent. It then proposes the top 1 product to push and the bottom 1 to freeze or kill as a pre-digested suggestion-mode card. Marc Lou's 4x-ARR valuation and his MoM growth plus churn metrics are a ready template.
- Kill criteria have to be defined by the user up front (for example, no paying customers after N weeks, or MRR below X after Y months). The agent should only check them and propose. No source gives evidence-based thresholds.

### Gaps
- No primary sources on weekly review or OKR-lite rituals of these founders in 2025-2026.
- No published numeric kill criteria.

## 6. Failure modes: agent sprawl, cost blowups, notification fatigue, losing product taste, burnout

### Takeaway
The best-documented failure is **burnout and cognitive exhaustion from parallel agents**. Simon Willison reports being drained by about 11am after running 4 agents, and people losing sleep because "my agents could be doing work for me". Costs scale with model choice, parallelism and cache-hit rate. Notification fatigue and the agency loss of over-proactive tools are documented in the proactive-assistant research and reviews.

### Cited Findings
- **Burnout and exhaustion:**
  - Willison (Lenny's Podcast, 2026; date given variously as Apr or Jul): runs 4 agents in parallel, mentally drained by about 11am, "I am getting more time, but I am exhausted". He has heard of people losing sleep to keep agents busy. — [AOL/BI coverage](https://www.aol.com/articles/ai-pilled-engineers-working-harder-081601472.html); [LetsDataScience](https://letsdatascience.com/news/software-engineers-feel-exhausted-by-ai-agents-19115894); [StartupFortune](https://startupfortune.com/ai-coding-agents-make-engineers-faster-and-more-exhausted/)
  - The fatigue reportedly grew noticeably from Nov 2025 with stronger agentic tools. — [LetsDataScience](https://letsdatascience.com/news/software-engineers-feel-exhausted-by-ai-agents-19115894)
- **Costs (all secondary, verify against Anthropic's docs):**
  - Pricing guides cite Anthropic as saying enterprise API spend averages about $13 per developer per active day ($150-250/month), with 90% of users under $30 per active day. One third-party estimate puts a solo developer running 15-20 Opus tasks a day at about $600-1,800/month on the API.
  - Max plans are $100 or $200/month.
  - Cache-hit rate (visible via `/cost`) is said to be the best predictor of spend.
  - 5-hour limits were reportedly doubled on May 6, 2026.
  - — [MorphLLM](https://www.morphllm.com/claude-code-cost); [Verdent](https://www.verdent.ai/guides/claude-code-pricing-2026); [gauravtiwari](https://gauravtiwari.org/claude-code-pricing/)
- **Discard rate:** 10-20% of sessions are abandoned even for the Claude Code creator. — [InfoQ](https://infoq.com/news/2026/01/claude-code-creator-workflow/)
- **Notification and agency failures:**
  - Persistent proactive suggestions are rated "distracting and annoying". — [ACM CHI 2025](https://dl.acm.org/doi/10.1145/3706598.3714002)
  - Motion's self-reshuffling plans make users feel a "loss of agency". — [Morgen](https://www.morgen.so/blog-posts/sunsama-vs-motion)
- **Losing touch with reality:** developers felt 20% faster while actually being 19% slower (METR). That is a taste and calibration risk when you stop doing hands-on work. — [Simon Willison](https://simonwillison.net/2025/Jul/12/ai-open-source-productivity/)

### Inferences
- Build guardrails into the orchestration center:
  - a cap on concurrent agents (Willison's ceiling of about 4, plus one significant change in review at a time)
  - a daily or weekly token budget per product, with alerts
  - "quiet hours" with no agent pings
  - an explicit "end of day" that stops queueing new work, to counter the urge to keep agents busy late at night
- **Product taste:** keep the human on the decisions that define the product (what to build, positioning, pricing, UI acceptance via previews and screenshots). Delegate implementation and verification. Periodically force a hands-on review of a real user flow so his judgement stays calibrated.
- Suggestion mode should reduce cognitive load, not add to it. If the inbox grows faster than he can clear it, the system should throttle agents, not keep stacking cards.

### Gaps
- No documented real cases of runaway agent cost (looping subagents or CI) with numbers.
- No primary source for Anthropic's current cost figures was retrieved (the official page to check is code.claude.com/docs/en/costs).
- No data on "agent sprawl" across many repos for solo founders specifically.
