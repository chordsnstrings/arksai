# CAMPAIGN CRAFT — funnels, neuromarketing & copy science → encodable rules

Research distillation for the Campaign bot's "brain" (deep-research run 2026-07-10, completed
in full: 5 search angles → 22 sources → 88 extracted claims → 3-vote adversarial verification
→ 21 confirmed / 4 refuted / 0 unverified → 12 merged findings). Every rule below is tagged:

- **[VERIFIED]** — survived unanimous adversarial verification against the primary source
  (votes 3-0 up to 9-0 on merged claims).
- **[PRACTITIONER]** — named practitioner/platform source (Motion 550k-ad study, PPC Hero,
  Stackmatix, Adyogi portfolio, CXL/Unbounce), plausible but not academically controlled.
- **[REFUTED]** — killed 0-3 in verification; listed so we never encode it.

**The meta-lesson from verification itself:** every blanket/universal rule that was tested got
killed (vertical-agnostic gates, "always demand-framed scarcity", "loss framing always wins"),
while every CONDITIONAL if/then rule survived. The brain must be a table of moderated rules
keyed to vertical + product type, not universal constants.

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
  failure; judge vs vertical benchmarks and own history, not vs last month alone. Verifier
  refinement: a separate global tracker showed CPL roughly FLAT into early 2026, and some
  verticals bucked the trend hard (restaurants CPL −93%) — encode as "expect drift,
  recalibrate the priors quarterly", NOT "assume perpetual rises". [VERIFIED 3-0]
- **Channel intent is a funnel-stage variable:** Amazon's ~11% CVR vs Meta's ~1.2–1.5%
  purchase-CVR reflects arrival intent (BOFU vs intent-creation), not platform quality —
  never compare CVRs across channels directly. [VERIFIED 3-0, medium confidence —
  single-vendor panel]

## 2. Vertical benchmarks (the per-industry priors)

WordStream/LocaliQ 2025 (MEDIANS, 726 US leads + 554 traffic campaigns, Apr 2024–Jun 2025 —
small per-vertical samples with real volatility [restaurants CVR jumped ~341% YoY], so encode
exact values as **noisy soft priors**; the ~24× CROSS-VERTICAL SPREAD itself is the stable,
load-bearing fact. Two more verifier caveats: the 7.72% leads "CVR" is a FORM-COMPLETION
rate (lead QUALITY declined ~11% YoY — the report bot should say so), and the sample skews
US SMB. [VERIFIED 6-0 incl. methodology caveats]):

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

E-commerce (Triple Whale, ~35k DTC brands, Jan–Dec 2025): per-vertical spreads are real
(apparel CVR 1.46/ROAS 2.18 · electronics 1.20/1.92 · automotive 1.30/2.54) [VERIFIED 6-0],
but Triple Whale's VERTICAL-AGNOSTIC blend (CPA $38.19/ROAS 1.86) was **REJECTED 0-3** as a
pause-gate baseline — use per-vertical rows only, and note they run Triple Whale's own
attribution model (directional priors, not Meta-native constants). Also [REFUTED]: "Meta grew
to 68.3% of ecommerce ad spend". CRITICAL metric-class rule: DTC purchase-CVR (~1.2–1.5%) and
lead-form CVR (~8%) are DIFFERENT METRICS — the engine must never compare a sales campaign
against a leads benchmark or vice versa.

## 3. Neuromarketing & persuasion science — what the evidence actually supports

### Scarcity (the most meta-analyzed lever)
- Scarcity cues generally raise purchase intention — TWO independent peer-reviewed
  meta-analyses converge (Barton et al. 2022, J. Retailing, 416 effects/131 studies; Ladeira
  et al. 2023, Psychology & Marketing). Boundary conditions to encode as guardrails: scarcity
  BACKFIRES under reactance (restrictions that read as externally imposed on the buyer) and
  for low need-for-uniqueness audiences; evidence is largely lab purchase-intention, not
  measured ad-conversion lift. [VERIFIED 3-0]
- **Scarcity TYPE is category-conditional — the core if/then rule:** demand-based ("selling
  fast") for utilitarian products; supply-based ("limited edition") for experiences;
  time-based (deadlines) for high-involvement purchases. Category-conditioning FIRST, wording
  second. [VERIFIED 6-0] (The blanket "always prefer demand-framed" claim was **REFUTED
  0-3** — do not encode it.)
- "Only 3 left" vs "ends soon": no significant main-effect difference (SMD 0.287 vs 0.395) —
  but non-significance ≠ equivalence (the time-based point estimate runs ~38% higher, possibly
  underpowered), and secondary moderation exists (quantity-framing skews utilitarian,
  time-framing skews high-involvement). Don't burn variant budget on this distinction; let
  the category rule pick. [VERIFIED 6-0 incl. the nuance]
- Scarcity is ~1.7× stronger when the product carries **social signaling value** (SMD 0.4575
  vs 0.2742) → pair scarcity with social-proof/status framing for visible products (fashion,
  beauty, cars, venues). Verifier caveats: subgroup CIs overlap slightly, and effects are
  weaker/non-significant in some cultures (Germany/Netherlands in Barton et al.) — relevant
  for a UAE multi-market operator: treat as a weighting, not a law. [VERIFIED 3-0]
- Stronger for less-familiar brands and for seasonal/enduring-luxury goods. [VERIFIED, same
  meta-analyses]
- **HARD ETHIC: only truthful scarcity.** The Princeton 11k-site crawl found >40% of
  countdown timers in the wild are fake (reset/no effect) and 234 outright deceptive
  instances; the FTC's Dark Patterns report targets exactly this. The engine must NEVER emit
  a countdown/stock/activity claim it cannot ground in user-provided fact (offer end date,
  real inventory). Scarcity copy without a grounded basis → QC hard-fail. [VERIFIED crawl
  stats; FTC named source]

### Framing & loss aversion
- Loss aversion is real in product choice (Neumann & Böckenholt 2014, 33 studies; reinforced
  by Brown et al. 2024 JEL: mean λ≈1.96 with WIDE heterogeneity) but its magnitude varies too
  much by category/context for a fixed multiplier. λ≈2 is a reasonable central PRIOR only.
  [VERIFIED 3-0] — and the mirror claim ("the same source justifies loss-framed messaging as
  a blanket lever") was **REFUTED 0-3**: the evidence supports variability, not a universal
  loss-framing rule.
- Gain frames induce positive emotion (d=.31), loss frames negative emotion (d=.22), and the
  persuasion effect runs THROUGH the matched emotion (gain×positive b=.18, loss×negative
  b=−.70); the DIRECT gain-vs-loss effect is "elusive" (consistent with O'Keefe & Jensen).
  **Rule: choose the frame by the emotional register the ad needs** — gain/positive for
  aspiration verticals (travel, fitness goals, education), loss/protective for
  prevention/risk verticals (insurance, security, screening) — never default to fear.
  Caveats: effects are small, the corpus is mostly health communication (ad extrapolation is
  an inference), and the gain-side mediation is marginal (p=.045). [VERIFIED 9-0]
- Loss framing applies to quality/feature claims, not just price. [VERIFIED, same sources]

### Visual attention (eye-tracking + field study)
- Faces pull attention; a face with **AVERTED gaze looking AT the product/text** increases
  attention to the ad's text+product AND brand/message memory; a **direct-to-camera gaze**
  traps fixations on the face and WEAKENS message memory (Sajjacholapunt & Ball 2014
  eye-tracking; corroborated by To & Patrick 2021, J. Consumer Research, whose **Facebook
  field study found averted-gaze ads produced higher click-through AND purchase**). Encodable
  exception: direct gaze wins when the goal is spokesperson CREDIBILITY in an informational
  appeal (testimonial, expert). Encode as a default-with-exception, not an absolute (primary
  lab evidence is one 2014 study, format-moderated). [VERIFIED 9-0, medium confidence]

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

**Do NOT encode (all killed 0-3 in verification):** blanket demand>supply scarcity
preference; Triple Whale's vertical-agnostic CPA/ROAS blend as a pause-gate baseline;
"Meta grew to 68.3% of ecommerce ad spend"; "loss framing is a blanket evidence-backed
lever" (the loss-aversion literature supports VARIABILITY, not universal loss framing).
Also never: fixed loss-aversion multipliers; cross-metric-class benchmark comparisons
(purchase-CVR vs lead-form CVR); fake urgency/countdown/stock/activity claims of any kind
(FTC dark-pattern territory — the hard ethical + legal line).

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

Verified-against: WordStream/LocaliQ Facebook Ads Benchmarks 2025 (corroborated by Search
Engine Land + PPC Land) · Triple Whale benchmark + 2025 ecommerce report (per-vertical rows
only; global blend refuted) · Barton et al. 2022 J. Retailing scarcity meta-analysis (416
effects/131 studies) · Ladeira et al. 2023 Psychology & Marketing scarcity meta-analysis
(converges on positive scarcity + social-signaling moderator; its demand>supply ranking
refuted) · Nabi et al. 2020 Communication Research framing meta-analysis (+ O'Keefe & Jensen)
· Neumann & Böckenholt 2014 J. Retailing loss-aversion meta-analysis (+ Brown et al. 2024
JEL, λ≈1.96) · Sajjacholapunt & Ball 2014 eye-tracking + To & Patrick 2021 J. Consumer
Research field study (gaze) · Motion Thumbstop Pulse Creative Benchmarks 2026 (550k
ads/$1.3B) · Meta Transparency Center ad standards · Princeton "Dark Patterns at Scale"
(11k-site crawl) + FTC dark-patterns report · PPC Hero / Stackmatix / Adyogi / CXL / Unbounce
practitioner playbooks · First Page Sage CPL 2026 (weak, expectations-only).
