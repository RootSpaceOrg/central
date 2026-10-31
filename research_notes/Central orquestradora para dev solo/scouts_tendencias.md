# Scouts de tendências e oportunidades: fontes, APIs, ferramentas e padrões de agentes (out/2026)

Most pricing below comes from third-party blogs and vendor comparison pages, often written by competitors. Primary sources were confirmed only where noted ("official"). Check every number on the vendor's own page before budgeting.

## 1. Data sources and their programmatic access in 2026

### Takeaway
The most valuable "voice of user" sources (Reddit, X) are now paywalled or legally risky for commercial use. GummySearch shut down because it could not get a Reddit commercial license. Cheap and reliable sources are Hacker News (free), Product Hunt (non-commercial by default), Google Trends (official API still alpha and application-only, pytrends dead), web change monitoring (changedetection.io self-hosted), and the dev's own product data. For Brazil there is no official Reclame Aqui API, only unofficial Apify scrapers.

### Cited Findings
**Reddit**
- There is no public self-serve commercial price page. Free access is for approved non-commercial use at 100 queries/min. The commercial figure most often repeated is ~$0.24 per 1,000 calls with a reported ~$12k/yr minimum, under a contract Reddit reviews by hand. These figures are unverified against Reddit's own docs. — [Techloy](https://www.techloy.com/reddit-api-pricing-in-2026-complete-guide-for-developers-and-businesses/); [Octolens](https://octolens.com/blog/reddit-api-pricing); [SocialCrawl](https://www.socialcrawl.dev/blog/reddit-api-key-limits-alternatives-2026)
- Enterprise access is reported at $50k+ (unverified). — [eseospace](https://eseospace.com/blog/reddit-api-pricing/)
- Unverified single-source claim: the free tier ends in March 2027 and new access requests close Oct 31, 2026. No corroboration found. — [BigIdeasDB](https://bigideasdb.com/reddit-api-pricing)
- GummySearch closed because it "was not able to reach an agreement that aligns with Reddit's Data API Usage policies." The founder notes that some products use the API without a commercial license, and that taking payments would have risked losing API access entirely. — [GummySearch Final Chapter (official)](https://gummysearch.com/final-chapter)

**X/Twitter**
- Pay-per-use became the default for new developers on Feb 6, 2026. Free, Basic and Pro were closed to new sign-ups. — [Open Terms Archive](https://opentermsarchive.org/en/memos/x-replaces-its-dollar200-entry-level-api-plan-with-a-pay-per-use-model/); [Gigazine](https://www.gigazine.net/gsc_news/en/20260209-x-api-pay-per-use/); [MediaNama](https://www.medianama.com/2026/02/223-x-developer-api-pricing-pay-per-use-model/)
- Legacy Basic plans were auto-migrated to pay-per-use from June 1, 2026. Legacy Pro reportedly followed after Sept 1, 2026. — [bundle.social](https://bundle.social/blog/x-api-pricing-2026-costs-limits); [postproxy](https://www.postproxy.dev/blog/x-api-pricing-2026/)
- Rates conflict between sources. One gives ~$0.005 per post read and $0.01 per post created, another $0.015 per post created. Reading a user is ~$0.01. Usage is paid with prepaid credits. The monthly read cap is reported as 2M by one source and 3M by another. Enterprise reportedly starts at $42k+/month. — [upload-post](https://www.upload-post.com/x-api-pricing/); [opentweet](https://opentweet.io/x-api-pricing); [SocialCrawl](https://www.socialcrawl.dev/blog/best-twitter-x-data-apis-2026)

**Google Trends**
- Google announced an official Trends API (alpha) in July 2025. It gives consistently scaled data over a rolling window of about 5 years (1,800 days). Access is application-only. — [Google Search Central blog (official)](https://developers.google.com/search/blog/2025/07/trends-api?hl=it); [PPC Land](https://ppc.land/google-opens-alpha-testing-for-new-trends-api-targeting-developers-and-journalists/)
- As of Aug 31, 2026 the developer page was still "accepting applications for alpha testers". There is no GA date or pricing. — [konabayev](https://konabayev.com/blog/google-trends-api-landscape-2026/); [scrapebadger](https://scrapebadger.com/blog/does-google-trends-have-an-api-what-to-use-in-2026)
- The pytrends GitHub repo was archived on Apr 17, 2025, and its last PyPI release (4.9.2) dates from Apr 2023. Users report HTTP 429 errors even on early calls. Maintained unofficial forks include trendspyg; there are also paid SERP/Trends scraper APIs. — [dev.to](https://dev.to/esteban_ortega/pytrends-is-dead-heres-how-to-get-google-trends-data-in-2026-1a18); [dev.to](https://dev.to/rimulabs/pytrends-is-archived-how-to-migrate-your-google-trends-code-no-more-429s-4e63); [trendspyg GitHub](https://github.com/flack0x/trendspyg)

**Product Hunt**
- The official docs say: "by default the Product Hunt API must not be used for commercial purposes", and businesses should contact hello@producthunt.com. Rate limits are 6,250 GraphQL complexity points per 15 min and 450 requests per 15 min on other endpoints. — [Product Hunt API docs (official)](https://www.producthunt.com/v2/docs); [Rate limits (official)](https://api.producthunt.com/v2/docs/rate_limits/headers)

**Hacker News**
- The Algolia-powered HN Search API exists at hn.algolia.com/api, but my fetch returned only the page title, not endpoint or limit details. — [hn.algolia.com/api](https://hn.algolia.com/api)

**Instagram / TikTok**
- Instagram Graph API hashtag search allows at most 30 unique hashtags per IG business/creator account in a rolling 7-day window. Re-querying the same hashtag doesn't count again. It requires App Review for "Instagram Public Content Access". — [Meta developer docs (official)](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/hashtag-search)
- A 200 req/hour per user token cap is reported by a third party only. — [Phyllo](https://www.getphyllo.com/post/how-to-use-instagram-api-to-pull-photos-based-on-hashtag)

**Competitor page monitoring**
- changedetection.io is free when self-hosted (open source, browser automation, 85+ notification formats). The hosted plan is ~$8–9/mo. Visualping has a free tier and paid plans from ~$10–14/mo, with a REST API and an MCP server. Distill.io is ~$15/mo. — [UptimeRobot comparison](https://uptimerobot.com/knowledge-hub/monitoring/9-best-website-change-monitoring-tools-compared); [Guideflow](https://www.guideflow.com/blog/website-change-monitoring-software); [PageCrawl (competitor)](https://pagecrawl.io/blog/visualping-vs-pagecrawl); [SoftwareAdvice](https://www.softwareadvice.com/product/488698-Visualping)

**Brazil – Reclame Aqui**
- No official developer API was found. Unofficial Apify actors scrape public complaints (title, date, status, city, reputation card), e.g. at USD 0.005 per complaint. The publishers say they are not affiliated with Reclame Aqui and warn that complaints contain personal data (LGPD). — [Apify pmodinger](https://apify.com/pmodinger/reclame-aqui-brasil.md); [Apify national_scrim](https://apify.com/national_scrim/reclame-aqui-scraper.md)

**Paid trend tools**
- Exploding Topics is reported from ~$39/mo (billed yearly), with 100 tracked trends and 10 analyses on the entry plan. This comes from a competitor page. — [Preuve](https://preuve.ai/blog/best-saas-idea-finder-tools-2026)

### Inferences
- For a solo dev in Brazil, the cheapest high-signal stack is:
  - HN Algolia (free)
  - Google Trends via trendspyg or a paid SERP API, with geo=BR; apply for the official alpha
  - changedetection.io self-hosted on competitor pricing and changelog pages (mLabs, Etus, Reportei, Postgrain, and for education ClassApp, Agenda Edu)
  - Reclame Aqui via Apify for competitor complaint mining
  - Claude/Exa web search for everything else
- Avoid direct Reddit/X API ingestion for a commercial product. Reading Reddit through a general search API, or occasional manual/agent browsing for personal research, is lower risk than building a product on Reddit data.
- The 30-hashtag/week Instagram limit makes IG trend scanning via the official API viable only for a small, curated hashtag list. The dev's own IG-publishing SaaS already holds tokens, but using customer tokens for market research may breach Meta platform terms. Gustavo should check this.

### Gaps
- Official Reddit commercial pricing: not published, and the figures above are secondary.
- Official HN Algolia rate limits: not retrieved. Commonly cited as ~10,000 req/hour per IP, but I did not verify this.
- TikTok Creative Center / TikTok Research API access terms: no results.
- YouTube Data API quotas, app store review APIs (App Store Connect / Google Play Developer Reply API only cover your own apps), G2/Capterra (no public review API found), Glimpse, SparkToro, BuiltWith pricing: not researched within the budget.
- Mercado Livre/Brazil-specific trend APIs: not researched.

## 2. Web research agent infrastructure (search/fetch APIs, deep research)

### Takeaway
Claude's native web search costs $10 per 1,000 searches plus tokens, and newer versions add dynamic filtering that cuts context. Brave (~$5/1k), Exa (~$7/1k) and Tavily (~$5–8/1k) are cheaper per query. Page text sent into the model, not the search fee, usually dominates cost.

### Cited Findings
- **Claude web search (official):** $10 per 1,000 searches plus standard token costs. Search results count as input tokens.
  - Versions: `web_search_20250305` (basic), `web_search_20260209` (dynamic filtering, where Claude writes code to filter results before they enter context, with no extra code-execution charge), `web_search_20260318` (adds `response_inclusion: "excluded"` to cut output tokens).
  - Supports `allowed_domains`/`blocked_domains`, `max_uses`, `user_location` (e.g. country BR), and works in the Batches API at the same price, with throttling. — [Claude docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)
- **Brave Search API:** ~$5 per 1,000 requests plus a $5/mo free credit. — [Parallel](https://parallel.ai/articles/tavily-alternatives); [beri.net](https://www.beri.net/article/tavily-vs-exa-vs-brave-vs-perplexity-search-api-agent-cost-2026)
- **Exa:** ~$7 per 1,000 for up to 10 results, plus $1/1k per extra result. The free allowance is reported as 20k requests/mo by one source and $10/mo by another (conflict). — [costbench](https://costbench.com/compare/exa-vs-tavily/); [Parallel](https://parallel.ai/articles/exa-alternatives)
- **Tavily:** acquired by Nebius, announced Feb 10, 2026 and completed May 2026. ~$0.008/search, dropping to ~$0.005 at volume. — [Parallel](https://parallel.ai/articles/tavily-alternatives); [codenote](https://codenote.net/en/posts/tavily-alternatives-cost-comparison-search-extract-api/)
- **Firecrawl:** free tier, paid from ~$16/mo. Search ~$7/1k plus ~$1/1k pages per content format. — [costbench](https://costbench.com/compare/exa-vs-firecrawl/)
- **Quality:** in one benchmark Brave scored highest (14.89), but Firecrawl, Exa and Parallel were statistically close. — [Keenable](https://select.keenable.ai/r/ai-search-providers-result-quality-vs-cost/3x7Anh6bM03XxAnyhQMpxA)
- **Hidden cost:** at frontier-model prices, the page text an API returns can cost 6–20x the search fee. — [beri.net](https://www.beri.net/article/tavily-vs-exa-vs-brave-vs-perplexity-search-api-agent-cost-2026)
- **OpenAI o3-deep-research:** ~$10/M input and $40/M output tokens. It always calls web search, which adds ~$10 per 1k searches. These are aggregator figures, not confirmed on OpenAI's page. — [OpenRouter](https://openrouter.ai/openai/o3-deep-research/pricing); [Helicone](https://openrouter.helicone.ai/openai/o3-deep-research)

### Inferences
- A weekly scout run of ~50 searches costs ~$0.50 in Claude search fees. Token cost dominates, so use a small model (Haiku/Sonnet) with dynamic filtering for scanning and a larger model only for the final synthesis and ranking. Batches API with web search is a fit for non-urgent nightly runs.
- Exa's semantic "find similar" suits competitor discovery ("companies like X"). Brave or Claude search suit news and trend checks. One provider is enough to start.

### Gaps
- Perplexity Sonar API pricing and the official Exa/Tavily/Brave pricing pages were not fetched directly.
- Claude web fetch tool pricing was not fetched. It is believed to have no per-fetch fee beyond tokens, but this is unverified here.

## 3. Existing "idea/opportunity" tools: what works vs hype

### Takeaway
GummySearch, the best-known Reddit pain-point tool, stopped signups and renewals on Nov 30, 2025 and shuts down completely on Dec 1, 2026. Its clones (PainOnSocial, BigIdeasDB, Trend Seeker, etc.) face the same Reddit-licensing risk. IdeaBrowser is a curated idea catalog plus community at $499–$2,999/yr. Most reviews in this category are written by competitors.

### Cited Findings
- **GummySearch timeline (official):**
  - Nov 30, 2025: signups, purchases, renewals and the free tier ended.
  - Dec 1, 2025 to Nov 30, 2026: transition year for existing customers.
  - Dec 1, 2026: full shutdown and deletion of all user data. — [GummySearch](https://gummysearch.com/final-chapter); [GummySearch docs](https://gummysearch.com/docs/gummysearch-is-now-closed-6533h)
- **Alternatives:**
  - PainOnSocial (~$19/mo), BigIdeasDB (~$49.99 lifetime) and Trend Seeker (free tier). All of these claims come from vendors.
  - Monitoring alternatives: F5Bot (free keyword alerts), Syften, RedShip, Brand24. — [PainOnSocial](https://painonsocial.com/gummysearch-alternative); [Trend Seeker](https://trend-seeker.app/blog/gummysearch-alternative); [RedShip](https://redship.io/reddit-tool/gummysearch)
- **IdeaBrowser (Greg Isenberg):** annual-only tiers at $499, $1,499 and $2,999/yr. It is a curated catalog of 1,000+ ideas with research-agent reports and coaching/AMAs. One critic says its research agent does not cite claims back to sources. — [Preuve (competitor)](https://preuve.ai/compare/ideabrowser); [BigIdeasDB (competitor)](https://bigideasdb.com/ideabrowser-alternative)

### Inferences
- Generic idea databases sell the same ideas to thousands of founders, so they offer little edge. The dev's edge lies in niche signals: Brazilian SMB marketing, schools, PT-BR complaints, and his own user data. A custom scout aimed at his niches beats subscribing to idea catalogs.
- Prefer tools whose data access is licensed or official. A tool built on unlicensed Reddit access can die mid-use, as GummySearch shows.

### Gaps
- No independent, non-vendor review of IdeaBrowser, PainOnSocial, BigIdeasDB or Syften was found.
- Current Syften and Exploding Topics pricing was not verified on official pages.

## 4. Product signal → prioritized hypotheses (analytics, replays, support, billing, AI PM agents)

### Takeaway
PostHog now ships "PostHog AI" (formerly Max AI). It summarizes session replays, has batch summaries and Replay Vision (frustration and bug flagging, reportedly GA Aug 2026 on paid plans), and exposes all of this via an MCP server an agent can read. Commercial "AI PM" tools such as Productboard Spark cluster feedback and score it against objectives. There is little rigorous evidence that LLM-automated RICE works, and sources agree that final judgment stays human.

### Cited Findings
- PostHog AI summarizes session recordings using the filters currently applied, e.g. one experiment variant. Session Replay must be enabled. — [PostHog docs (official)](https://posthog.com/docs/posthog-ai/session-summaries)
- The PostHog MCP server lets AI agents read existing session summaries and manage playlists. — [PostHog docs (official)](https://posthog.com/docs/session-replay/surfaces/mcp)
- PostHog's own blog post "nobody watches session replays" is the motivation for AI summaries. — [PostHog blog](https://posthog.com/blog/nobody-watches-session-replays.md)
- Replay Vision reportedly went GA on Aug 3, 2026 for paid plans, with frustration scoring and bug flagging. A PostHog handbook page says it cannot yet target filtered sets of recordings, which conflicts with the filter-based summaries above. — [createwith (third-party)](https://www.createwith.com/tool/posthog/updates/posthog-replay-vision-enters-general-availability-adding-ai-to-session-replays); [PostHog handbook](https://posthog.com/handbook/marketing/positioning/replay-vision)
- Productboard Spark groups similar feature requests across channels, links feedback to the roadmap, and scores priority against business objectives. — [G2 Learn](https://learn.g2.com/ai-tools-for-product-managers)
- AI backlog scoring combines usage analytics with ARR impact to compute impact/effort dynamically. — [Xebia](https://xebia.com/articles/ai-powered-backlog-management-for-product-managers)
- On limits: "the last 10% of prioritization (edge cases, incomplete data, political realities)" is not resolved reliably by agents. — [Rework](https://resources.rework.com/es/libraries/job-description-templates/ai-product-manager); [CleverX](https://cleverx.com/blog/how-ai-is-changing-the-product-manager-role-in-2026)

### Inferences
- The minimal "product signal" scout for the dev's stack:
  1. PostHog MCP for funnels, retention and replay summaries.
  2. Supabase SQL views (activation, weekly active schools/businesses, IG publish failures).
  3. Stripe/Stone webhooks for churn, failed payments and downgrades, with a reason field.
  4. Support inbox / WhatsApp messages.

  An LLM clusters these weekly into hypotheses. Each hypothesis carries evidence links, an ICE score (fewer inputs than RICE, so less made-up precision) and a proposed experiment, then goes to an approval queue.
- Churn and billing events tied to usage drop-offs are the highest-value signal for a small SaaS. The LLM should cite the specific accounts/events behind each hypothesis so the dev can verify quickly on low-energy days.

### Gaps
- Enterpret, Dovetail AI and Mixpanel Spark details were not retrieved.
- No rigorous study was found comparing LLM-generated RICE/ICE scores to outcomes.
- PostHog AI pricing per summary was not retrieved.

## 5. Patterns to avoid noise (scoring, dedup, novelty, feedback loops)

### Takeaway
I found no authoritative source in this session specifically on noise-control for opportunity scouts. The recommendations below are inferences from standard IR/recsys practice and from the cost findings above, so treat them as design proposals, not cited facts.

### Cited Findings
- Productboard-style tools dedupe by grouping similar requests across channels before scoring. — [G2 Learn](https://learn.g2.com/ai-tools-for-product-managers)
- Claude dynamic filtering filters raw search results in code before they enter context, which reduces noise and tokens at ingestion. — [Claude docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)

### Inferences
- **Dedup:** embed each signal and merge items above a cosine-similarity threshold into one "theme". Keep a count and a source list, since frequency across independent sources is itself the score.
- **Novelty:** keep a store of previously surfaced themes and only surface a theme when it is new or its frequency/velocity jumped (e.g. Google Trends BR slope, mention count week over week).
- **Scoring:** use a fixed rubric (fit with existing products/ICP, evidence count, willingness-to-pay signals such as complaints about price or competitors, and effort) with the LLM as judge. Require citations per item and drop items without evidence.
- **Feedback loop:** log approve/reject plus a one-word reason. Start with few-shot examples of past approvals and rejections in the ranking prompt, which needs no training infra. Move to learned weights only if volume justifies it (YAGNI).
- **Output cap:** limit each digest to the top 3–5 suggestions, so a low-energy review stays under 10 minutes.

### Gaps
- No primary-source case studies were found on indie founders running automated opportunity scouts with feedback loops (Indie Hackers/levels.io posts were not retrieved within the tool budget).
