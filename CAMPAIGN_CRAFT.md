# CAMPAIGN CRAFT — funnels, neuromarketing & copy science → encodable rules

Research distillation for the Campaign bot's "brain" (deep-research run 2026-07-10: 5 search
angles → 22 sources → 88 extracted claims → 3-vote adversarial verification). Every rule below
is tagged with its evidence level:

- **[VERIFIED]** — survived 3-0 adversarial verification against the primary source.
- **[META]** — quotes a peer-reviewed meta-analysis verbatim (verification pass was cut short
  by a usage limit, but the quote↔source linkage was checked at extraction).
- **[PRACTITIONER]** — named practitioner/platform source (Motion 550k-ad study, PPC Hero,
  Stackmatix, Adyogi portfolio, CXL/Unbounce), plausible but not academically controlled.
- **[REFUTED]** — killed in verification; listed so we never encode it.

House rule (same as MOTION_CRAFT/SCRIPT_CRAFT): the MODEL composes within these rules; the
ENGINE enforces them deterministically — benchmarks, checklists and bans live in code, not in
prompt vibes.

---

## 1. The 2026 Meta funnel doctrine (what actually works now)

- **Creative volume beats prediction.** Motion's 2026 benchmark (550k+ ads, 6k advertisers,
  ~$1.3B spend, Sep 2025–Jan 2026): ~half of all ads get little/no spend; **~6% of ads absorb
  the majority of account spend**; only ~5% of ads spend ≥10× the account's median ad. Top
  advertisers aren't better predictors — they **launch more tests**. An account with a HIGH
  hit rate is likely under-testing. [PRACTITIONER, large-N platform data]
  → Engine: the rotating pool + 48h rotation is the right architecture; a "winner" is
  deterministically definable as **spend ≥ 10× account-median ad spend**; treat high win-rate
  as a signal to ENLARGE the pool, not to celebrate.
- **Signal density rules structure.** ~50 conversion events/ad set/week to exit Learning
  Limited → consolidate into FEW broad ad sets, never fragment. (Already encoded:
  `adSetCountFor`.) [PRACTITIONER, matches Meta's own guidance]
- **Budget split by stage.** Practitioner starting points: 20–30% TOFU / 20–30% MOFU /
  40–50% BOFU (Stackmatix); fashion D2C skews 20–30/30–40/30–50 (Adyogi); brand-building
  literature (Binet & Field) says 60/40 brand-vs-activation for LONG horizons. CBO for
  prospecting, ABO for retargeting. [PRACTITIONER — treat as defaults, not law]
- **Retargeting is the highest-ROAS layer** (~4.2× avg claimed) with stage-matched recency
  windows: checkout-started 3–7d, add-to-cart 7–14d, product viewers 14–30d, video viewers
  30–90d; ALWAYS exclude recent converters (7–14d). MOFU audiences = behavioral customs
  (video % viewers, LP visitors, cart viewers, engagers); seed lookalikes from warm audiences
  back into TOFU. [PRACTITIONER]
- **Objective choice:** leads-objective CTR (2.59%) runs ~50% above traffic-objective CTR
  (1.71%) — Meta's lead optimization finds better-fit users; a direct-response brief should
  default to leads/sales objectives, using traffic only as a degrade. [VERIFIED, WordStream]
- **Catalog ads (e-commerce):** enriched/optimized feeds ≈1.5× ROAS over raw feeds; sold-out
  SKU ads should pause within the hour (daily sync insufficient); expect Meta to concentrate
  delivery on a handful of SKUs. [PRACTITIONER, Adyogi 350-brand portfolio]
- **Cost climate:** CPL rose ~21% YoY to $27.66 avg and 80% of industries saw CVR declines
  (competition + privacy + inflation) — rising CPL is the WEATHER, not necessarily campaign
  failure; judge vs vertical benchmarks and own history, not vs last month alone. [VERIFIED]

## 2. Vertical benchmarks (the per-industry priors)

WordStream/LocaliQ 2025 (MEDIANS, 726 US leads + 554 traffic campaigns, Apr 2024–Jun 2025 —
small per-vertical samples, so encode as **soft priors, not hard gates** [VERIFIED incl. the
methodology caveat]):

| Vertical (leads objective) | CTR | CPC | CVR | CPL |
|---|---|---|---|---|
| **All industries** | 2.59% | $1.92 | 7.72% | $27.66 |
| Restaurants & food | high | low | **18.25%** | **$3.16** |
| Real estate | — | — | 9.53% | $16.61 |
| Career & employment | — | — | — | $17.64 |
| Attorneys & legal | — | — | 10.53% | — |
| Beauty & personal care | — | — | — | $51.42 |
| Health & fitness | — | — | — | $52.98 |
| Dentists & dental | **1.05%** | **$9.78** | — | **$76.71** |

Traffic objective, all industries: CTR 1.71%, CPC $0.70. Highest traffic CTRs are the
"anytime treat" verticals (shopping/gifts 4.13%, travel 2.76%, sports 2.60%); lowest are
need-based/considered (auto repair 0.80%, physicians 0.83%, finance/insurance 0.98%) —
i.e. **emotional/creative-led ads work where intent is spontaneous; credibility-led where
considered**. [VERIFIED]

The spread is ~24× on CPL — **a single global CPL target is wrong by an order of magnitude**;
every pause/scale/judge rule must be vertical-relative. [VERIFIED]

Blended (paid+organic, First Page Sage 2026 — agency data, weaker source): eCommerce ~$91,
HVAC ~$92, healthcare ~$361, real estate ~$448, legal ~$649, financial services ~$653, B2B
SaaS ~$237, higher-ed ~$982 per lead. Use only to SET USER EXPECTATIONS in the brief UI, not
as optimizer gates. [PRACTITIONER]

E-commerce (Triple Whale, ~33–35k DTC brands, $18.4B spend): per-vertical spreads are real
(apparel CVR 1.46/ROAS 2.18 · electronics 1.20/1.92 · automotive 1.30/2.54) [VERIFIED], but
the "global CPA $38.19 / ROAS 1.86" single-row claim FAILED verification — treat Triple
Whale's global row as disputed; use their per-vertical rows only. [REFUTED: the global-row
claim; also refuted: "Meta grew to 68.3% of ecommerce ad spend".]

## 3. Neuromarketing & persuasion science — what the evidence actually supports

### Scarcity (the most meta-analyzed lever)
- Scarcity cues generally raise purchase intention (J. Retailing 2022 meta-analysis, 416
  effect sizes / 131 studies). [META]
- **Type ranking overall: supply-based ("limited edition") > time-based ("ends Friday") >
  demand-based ("selling fast")** — but CATEGORY-CONDITIONAL: demand-based works best for
  utilitarian products, supply-based for experiences, time-based for high-involvement
  purchases. [META] (The opposite ranking — demand > supply, from Ladeira 2023 — was
  **[REFUTED]** in verification; do not encode it.)
- "Only 3 left" vs "ends soon" are statistically equivalent (SMD 0.287 vs 0.395, n.s. diff) —
  don't burn variants on that distinction. [VERIFIED]
- Scarcity is ~1.7× stronger when the product carries **social signaling value** (SMD 0.4575
  vs 0.2742) → pair scarcity with social-proof/status framing for visible products (fashion,
  cars, venues). [VERIFIED]
- Stronger for less-familiar brands and for seasonal/enduring-luxury goods. [META]
- **HARD ETHIC: only truthful scarcity.** The Princeton 11k-site crawl found >40% of
  countdown timers in the wild are fake (reset/no effect) and 234 outright deceptive
  instances; the FTC's Dark Patterns report targets exactly this. The engine must NEVER emit
  a countdown/stock/activity claim it cannot ground in user-provided fact (offer end date,
  real inventory). Scarcity copy without a grounded basis → QC hard-fail. [VERIFIED crawl
  stats; FTC named source]

### Framing & loss aversion
- Loss aversion is real in product choice (33-study meta-analysis) but its MAGNITUDE varies
  widely by category/context — no fixed multiplier, no "loss framing always wins". [META]
- Gain frames induce positive emotion (d=.31), loss frames negative emotion (d=.22), and the
  persuasion effect runs THROUGH the emotion (Nabi et al. 2020, 25 studies / 5,772 people).
  **Rule: choose the frame by the emotion the vertical needs** — gain/positive for
  aspiration verticals (travel, fitness goals, education), loss/protective for
  prevention/risk verticals (insurance, security, health screening) — never default to fear.
  [META]
- Loss framing applies to quality/feature claims, not just price. [META]

### Visual attention (eye-tracking)
- Faces pull attention; a face with **AVERTED gaze looking AT the product/text** increases
  attention to the ad's text+product AND brand/message memory; a **direct-to-camera gaze**
  traps attention on the face and WEAKENS message memory (format-dependent; worst on vertical
  banners). Rule: when the goal is message recall, prefer averted-gaze-toward-content faces;
  direct gaze only when the face IS the message (personal brand, testimonial). [META,
  eye-tracking primary studies]

### CTAs & microcopy
- CTAs are the most-tested element (~30% of VWO tests) but a 6,700-experiment Qubit
  meta-analysis found CTA tests rarely move the needle much — **don't spend variant budget on
  button copy; spend it on hooks/offers/creative**. [PRACTITIONER meta-data]
- Personalized/targeted CTAs beat generic by ~42% (HubSpot). CTA copy must answer: what's my
  motivation for clicking + what exactly do I get (Aagaard checklist). [PRACTITIONER]

## 4. Copy & creative craft that moves Meta performance

- **Hooks that WIN: immediacy + clarity + a concrete reason to act.** Motion's winner
  analysis: offer-led hooks hit 9.29% winner-rate vs storytelling 6.23% vs question 5.47%;
  price framing / offers / urgency / newness reduce comprehension effort. Broad lifestyle
  statements and vague benefit claims LOSE. (Caveat: dataset spans BFCM/holidays — offer bias
  inflated; keep archetype diversity, weight offer/price hooks up.) [PRACTITIONER, 550k ads]
- **Low-production text-forward assets win more than teams expect** — text-only ads, product
  images with text overlays, simple GIFs rank among top performers because they're fast to
  vary; UGC asset type ≈7.56% hit rate; polished production signals credibility but slows
  iteration. Our text-free-background + composited-crisp-text pipeline is exactly this shape.
  [PRACTITIONER]
- **UGC-style/authentic creative ≈ +29% CVR vs brand-polished** at MOFU (multiple practitioner
  sources repeat this figure — single-origin, treat as directional). [PRACTITIONER]
- **Winning visual style is vertical-specific:** fashion → culturally-fluent/playful; finance
  & professional services → credibility-forward/explanatory; home & lifestyle →
  demonstration/process. Platform-wide "trending format" advice loses to vertical rules.
  [PRACTITIONER, 550k ads]
- Frameworks (AIDA, PAS, 4Cs, JTBD) are scaffolds for VARIANT DIVERSITY, not magic: encode
  them as distinct copy shapes so the pool tests structurally different messages, not five
  rewordings of one message.

## 5. Compliance hard gates (Meta ad standards — encode as REJECT rules)

- Review covers creative + text + targeting **+ the landing page**; mostly automated, ~24h;
  ads are subject to re-review at ANY time. QC must gate the whole funnel destination.
  [VERIFIED-class, Meta Transparency Center]
- **Personal-attributes rule:** copy must not assert/imply the viewer's race, ethnicity,
  religion, age, sexual orientation, gender identity, disability, physical/mental health.
  Ban "Are you [attribute]?" second-person constructions ("Are you diabetic?", "Struggling
  with depression?"). This directly bounds PAS problem-agitation in health/finance.
- **Health/weight-loss/cosmetic:** 18+ targeting only; must NOT imply or attempt to generate
  negative self-perception → loss-aversion/insecurity hooks are BANNED in this vertical;
  gain-framed aspiration copy only.
- **Special ad categories** (housing/employment/credit + social issues): must self-declare;
  restricted targeting. (Already encoded: `detectSpecialAdCategories` — extend with
  social-issues detection.)
- **Message match:** every ad component must be relevant to the offer; products in the ad
  must match the landing page; no shocking/sensational content → curiosity-gap clickbait
  hooks must stay within message-match bounds.

## 6. THE ENCODING MAP — where each rule lands in the engine

| Rule | Module | Mechanism |
|---|---|---|
| Vertical detection (12+ industries) | `agent/social/verticals.ts` (NEW) | pure keyword/LLM-assist classifier over the brief → `VerticalProfile` |
| Per-vertical benchmark priors (CTR/CPC/CVR/CPL + spread caveat) | `verticals.ts` catalog | drives optimizer thresholds + CampaignBrief expectation copy ("dental leads typically cost $40–90") |
| Optimizer judges vs vertical prior, not global | `socialCampaigns.ts decideOptimizations` | loser rule becomes `CPR > k × max(campaign-median, vertical-prior)`; CPL-inflation weather-aware |
| Winner = spend ≥10× account-median | `campaignOptimize` + report | deterministic winner classification; high hit-rate → "pool too small" advisory |
| Hook archetype v2 (offer/price/newness/urgency/proof/question/story, weighted by Motion hit-rates + vertical) | `creativeBatch.ts` | archetype set per vertical; offer-led weighted up for e-comm/F&B, credibility-led for finance/legal/dental |
| Copy shapes (PAS/AIDA/JTBD/4Cs as structural variants) | `creativeBatch.ts` body generator | one shape per background, rotated — structural diversity in the pool |
| Scarcity rules (type-by-category, truthful-only, social-signal pairing) | `creativeBatch.ts` + copy QC gate | scarcity copy ONLY when brief carries a grounded basis (end date/stock); type picked by category; else omitted |
| Frame-by-vertical (gain vs loss) | `verticals.ts` → copy generator | aspiration verticals gain-framed; prevention verticals loss-framed; health ALWAYS gain-framed (Meta rule) |
| Compliance copy gate (personal attributes, health self-perception, sensationalism, message-match) | `agent/social/copyCheck.ts` (NEW) | deterministic regex/rule pass over every headline/body BEFORE upload — like scriptProblems for ads |
| Special-ad-category widening (social issues) | `detectSpecialAdCategories` | extend keyword sets |
| Visual style per vertical + averted-gaze rule | `creativeBatch.ts` imagery prompts + vision QC rubric | per-vertical imagery prompt packs; "if a face is present, gaze toward product/text" in prompt + QC check |
| Funnel architecture per vertical (retargeting ladder, budget split, consideration length) | `resolveObjectivePlan` → `planFunnel` (NEW) | vertical + objective → stage plan (v1: prospecting + engagement-custom-audience retargeting once signals exist) |
| CTA checklist (motivation + what-you-get; don't over-variant buttons) | copy generator | CTA from a small vetted per-objective set; variant budget goes to hooks |
| Expectation-setting in the brief UI | `CampaignBrief.tsx` | show vertical CPL range + "costs are rising ~20%/yr platform-wide" honesty note |
| Report bot benchmarks column | `socialReport.ts reportObservations` | observations compare account metrics vs vertical prior ("your CPL $22 vs restaurant benchmark $3–17…") |

**Do NOT encode:** demand>supply scarcity ranking [REFUTED]; Triple Whale global CPA/ROAS row
[REFUTED]; Meta-68.3%-share claim [REFUTED]; fixed loss-aversion multipliers; fake
urgency/countdown of any kind (FTC dark-pattern territory — hard ethical + legal line).

## 7. Current-engine gap table

| Today | Target |
|---|---|
| 5 generic hook templates, body = "product: topic." | Vertical-weighted archetype set + structural copy shapes + scarcity/frame rules |
| One imagery prompt style for all industries | Per-vertical imagery packs + gaze rule + UGC-style option |
| No copy QC | `copyCheck.ts` deterministic gate (compliance + craft + truthfulness) |
| Optimizer judges vs campaign-median only | Vertical-prior-aware thresholds + winner classification + pool-size advisory |
| Single prospecting layer | `planFunnel`: retargeting ladder from engagement customs once the pixel-free signals exist (video viewers/engagers), budget-split defaults |
| Brief UI shows no cost expectations | Vertical CPL range + honesty note |
| Report has no benchmark context | Vertical-benchmark comparison column in observations |

## 8. Source register (top)

Verified-against: WordStream/LocaliQ Facebook Ads Benchmarks 2025 · Triple Whale benchmark +
2025 ecommerce report (per-vertical rows only) · J. Retailing 2022 scarcity meta-analysis
(416 effects/131 studies) · Ladeira 2023 Psychology & Marketing scarcity meta-analysis
(partially refuted) · Nabi et al. 2020 Communication Research framing meta-analysis · J.
Retailing 2014 loss-aversion meta-analysis · PMC eye-tracking gaze studies (averted vs mutual
gaze) · Motion Thumbstop Pulse Creative Benchmarks 2026 (550k ads/$1.3B) · Meta Transparency
Center ad standards · Princeton "Dark Patterns at Scale" (11k-site crawl) + FTC dark-patterns
report · PPC Hero / Stackmatix / Adyogi / CXL / Unbounce practitioner playbooks · First Page
Sage CPL 2026 (weak, expectations-only).
