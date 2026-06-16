# UAE Legal — department plan (research + build-ready scope)

> Status: **PLAN ONLY — no code changed.** A build-ready scope for a new **Legal** department
> (sibling to the existing *Tax & Compliance (UAE)* department), the way Marketing/Sales/
> Finance/HR/Engineering/Tax are defined today (`client/src/lib/departments.ts` plays +
> `server/src/agent/expertise.ts` standards + an injected knowledge base + `docx`/`render_report`
> deliverables). Laws cited were verified live (June 2026) — but **the KB must be maintained and
> the agent must cite the source article and never fabricate** (see Guardrails).

---

## 1. Positioning — "your in-house legal first-drafter, UAE-native"

A **helping hand for a UAE company's everyday legal work**: drafting, reviewing, and tracking the
documents and filings a UAE business actually deals with — **bilingual (Arabic ⇄ English)** and
**jurisdiction-aware** from the first question. It is NOT a replacement for a licensed UAE lawyer; it
produces **review-ready drafts and structured analysis**, and tells the user exactly when a
registered legal consultant, a notary, or court attestation is required.

**Why it's distinct from the Tax & Compliance dept:** Tax owns FTA filings (VAT 201/FAF, Corporate
Tax, Excise, e-invoicing, WPS). Legal owns **contracts, corporate/governance documents, employment
legal, data protection, IP, disputes/notices, and legal compliance (UBO, AML, ESR-legacy)** — and
cross-references Tax where they meet.

### The one thing that makes it credible: a **jurisdiction engine**
Every UAE legal output hinges on *which* legal system applies. The dept must resolve this **first**,
because it changes the governing law, language, courts, and even the contract template:

| Jurisdiction | Law | Language | Courts | Notes |
|---|---|---|---|---|
| **Mainland (onshore)** | UAE Federal + Emirate law, **civil law** (Egyptian/French-derived) | **Arabic** official (Arabic prevails in bilingual docs) | Local/Federal courts; 15-yr contract limitation | MOHRE employment, Ejari leases, MOE/DET licensing |
| **Free zones (non-financial)** | Federal law + the zone's own regs (JAFZA, DMCC, RAKEZ, DAFZA, SHAMS, IFZA…) | English/Arabic | UAE onshore courts (mostly) | Own employment contracts + leases |
| **DIFC** (Dubai) | **English common law**, own civil/commercial/employment/data laws | **English** | DIFC Courts (Small Claims <AED 500k, CFI, CoA); **6-yr** limitation | Can be chosen as a "conduit" jurisdiction |
| **ADGM** (Abu Dhabi) | **English common law** (direct application of English law) | **English** | ADGM Courts | Employment Regs 2024; own Data Protection Regs 2021 |

The intake for every Legal play asks (or infers from the org profile): **emirate, onshore vs free
zone vs DIFC/ADGM, and the counterparty's seat** → this selects the template, governing-law/dispute
clause, language, and filing route.

---

## 2. Guardrails (non-negotiable — bake into the persona + every output)

UAE regulates legal consultancy; "unauthorised practice of law" and liability are real risks. The
dept must be **safe by construction**:

1. **Draft / research assistant, not legal advice.** Every deliverable carries a standard footer:
   *"Draft prepared by ArksAI for review by a licensed UAE legal professional. Not legal advice."*
2. **Cite the source.** Reference the specific **law + article** (e.g., "Federal Decree-Law 33/2021,
   Art. 42"); **never invent** a law, article, or case. If unsure, say so and point to the official
   register (`uaelegislation.gov.ae`).
3. **Flag the human/official step.** Explicitly mark where a **notary** (POA, MOA), **attestation/
   legalisation** (MOFAIC), **court filing**, **registered legal consultant**, or **bilingual Arabic
   translation** is mandatory.
4. **Jurisdiction first.** Never draft without resolving mainland/free-zone/DIFC/ADGM.
5. **Bilingual where it matters.** Onshore court/government documents are **Arabic** (or bilingual,
   Arabic prevailing); produce a parallel-column Arabic/English draft and flag that a certified legal
   translator should confirm the Arabic.
6. **No fabricated figures/precedent**, consistent with the existing report/Tax rules.

---

## 3. Knowledge base (UAE legal framework — injected into the dept, per `project knowledge` pattern)

Structured so the agent can cite precisely. **Each entry = law name, number/year, scope, and the
"what a company uses it for."** (Verify-on-use; this is a maintained KB, not a substitute for the
official text.)

**A. Federal core (applies across all emirates unless a financial free zone carves out):**
- **Commercial Companies Law** — Federal Decree-Law **32/2021**, *as amended by Federal Decree-Law
  20/2025* (eff. 1 Oct 2025): non-profit companies, **multiple share classes in LLCs**, statutory
  **drag-along/tag-along**, share succession, deadlock. → MOA/AOA, SHAs, resolutions.
- **Labour Law** — Federal Decree-Law **33/2021** + Cabinet Res. 1/2022 (private sector, all emirates
  except DIFC/ADGM): limited-term contracts, notice, end-of-service, non-compete limits. → employment
  contracts, terminations, EOSG.
- **Civil Transactions Law (Civil Code)** — Federal Law **5/1985** (as amended): contract formation,
  obligations, limitation (15 yrs). → all onshore contracts.
- **Commercial Transactions Law** — Federal Decree-Law **50/2022**: commercial obligations, cheques
  (partial decriminalisation), commercial paper. → trade contracts, debt recovery.
- **Commercial Agencies Law** — Federal Law **3/2022** (eff. Jun 2023): exclusive agency, termination/
  compensation, **arbitration now permitted**, MOE registration. → distribution/agency agreements.
- **Data Protection (PDPL)** — Federal Decree-Law **45/2021**: lawful basis, consent, data-subject
  rights, cross-border. → privacy policies, DPAs, consent, ROPA.
- **Electronic Transactions & Trust Services** — Federal Decree-Law **46/2021**: **digital signatures
  = handwritten** (key automation enabler). → e-signed contracts, UAE Pass notary.
- **IP** — **Trademark** Federal Decree-Law 36/2021; **Copyright** 38/2021; **Patents/Industrial
  Design** 11/2021. → IP assignment/licence, trademark application packs.
- **Arbitration** — Federal Law **6/2018** (amended by 15/2023); **DIAC Rules 2022**. → arbitration
  clauses, notices of arbitration.
- **Bankruptcy / Financial Restructuring** — Federal Decree-Law **51/2023** (replaced 9/2016); natural-
  persons insolvency 19/2019. → restructuring, creditor notices (info only).
- **AML/CFT** — Federal Decree-Law 20/2018 + **goAML** registration for DNFBPs (AML framework updated
  2024–2025). → AML/KYC policies, goAML registration packs.
- **UBO** — **Cabinet Res. 58/2020, updated by Federal Decree-Law 10/2025 + Cabinet Res. 134/2025**:
  beneficial owners (≥25%), register within 15 days of change, penalties to AED 100k. → UBO declarations.
- **ESR** — Cabinet Decision 57/2020 (**largely wound down** — notifications cancelled for FYs ending
  after 31 Dec 2022; keep as legacy/check-only).
- **Consumer Protection** 15/2020; **Competition** 4/2012; **Cybercrime** 34/2021; **Capital Markets/
  SCA** (2026 overhaul) for securities.

**B. Emirate / jurisdiction layer:** Dubai (DET licensing, Dubai Courts, **RERA/Ejari** tenancy Law
26/2007, Dubai Data Law for govt data); Abu Dhabi (ADDED, ADJD); Sharjah/RAK/Ajman/Fujairah/UAQ
(local DEDs + free zones — RAK ICC offshore, RAKEZ, SHAMS). **Financial free zones:** **DIFC** (DIFC
Companies Law, Employment Law DIFC Law 2/2019, **Data Protection Law 5/2020**); **ADGM** (Companies
Regs, **Employment Regs 2024**, **Data Protection Regs 2021**, direct English law).

**C. Regulators & portals (drives filing routes):** MOJ / **UAE Pass e-notary**, **MOFAIC**
(attestation), **MOEC** (trademark, agencies, NER `ner.economy.ae`), **MOHRE / Tasheel** (employment),
**GDRFA / ICP** (visas/establishment), **DET / free-zone authorities** (licensing), **Ejari/RERA**,
**Dubai Courts / DIFC Courts / ADGM Courts** (e-filing), **goAML** (FIU), **UBO registrar**.

---

## 4. The plays (department catalog — grouped Create / Analyze / Operate)

Each play → a `title`, a `prompt` (jurisdiction-aware), a `mode` (mostly **code**→`generate_doc`, some
**report**, some **chat/plan** for analysis), and an `expertise` key. ~16 in the launch catalog;
rest are backlog.

### CREATE — draft the document (bilingual, jurisdiction-aware, review-ready)
1. **Commercial contract** (service / supply / consultancy) — incl. governing-law + dispute-resolution
   clause matched to the chosen jurisdiction, payment, IP, confidentiality, termination, force majeure.
2. **NDA / confidentiality** (mutual or one-way) — PDPL-aware.
3. **Employment contract + offer letter** — **MOHRE-aligned (mainland) / DIFC / ADGM / free-zone**
   variants, probation, notice, EOSG, **enforceable non-compete** (Art. 10 limits, 2-yr/geographic).
4. **MOA / AOA + Shareholders' Agreement** — LLC, reflecting the **2025 amendments** (share classes,
   drag/tag-along, reserved matters, deadlock, exit).
5. **Power of Attorney** — notary-ready, **bilingual**, scoped (corporate / litigation / property).
6. **Board & shareholder resolutions + minutes** — appointments, banking, approvals, AGM.
7. **Privacy Policy / DPA / consent + ROPA** — PDPL / DIFC DP / ADGM DP selectable.
8. **Website/App Terms of Service + Acceptable Use** — UAE consumer-protection aware.
9. **Distribution / Commercial Agency agreement** — Law 3/2022 + MOE registration pack.
10. **Tenancy / lease (Ejari-ready) or sublease** — Dubai RERA form-aligned.
11. **IP assignment & licensing agreement** + **trademark application pack** (classes, specimen, MOE).
12. **Legal notice / demand letter / cease & desist** — notary-ready, bilingual, with statutory basis.
13. **Settlement & release / quitclaim** — labour or commercial.
14. **MOU / term sheet / JV framework.**

### ANALYZE — review & assess (information, not advice)
15. **Contract review & risk report** — clause-by-clause vs UAE law: missing protections, one-sided
    terms, governing-law/forum check, enforceability flags, a ranked risk list + suggested redlines.
16. **Compliance health-check** — UBO, AML/goAML (if DNFBP), data protection, licensing, ESR-legacy →
    gap report + dated action plan (cross-refs Tax dept for CT/VAT).
17. **Licensing & jurisdiction advisor** — activity → required licences/approvals + a **mainland vs
    free-zone vs DIFC/ADGM recommendation** with trade-offs (ownership, tax, courts, cost).
18. **Policy/handbook gap analysis** — employee handbook / IT / data policies vs current law.
19. **Dispute position brief** — merits, **limitation (15-yr onshore vs 6-yr DIFC)**, forum options,
    indicative cost/time — clearly framed as information for a lawyer, not advice.

### OPERATE — keep it running
20. **Corporate legal calendar & filing tracker** — licence renewal, **UBO updates (15-day rule)**,
    AGM, trademark renewals, contract expiries → a tracked schedule (ties into the existing
    **Scheduled runs** feature for reminders/auto-regeneration).
21. **Contract lifecycle register** — key dates, renewal/notice windows, obligations.
22. **Notarisation / attestation packet builder** — assembles the exact documents + checklist +
    UAE-Pass-e-notary / MOFAIC submission steps.

**Backlog:** franchise agreement, employee stock/ESOP (DIFC/ADGM), GDPR↔PDPL bridge for exporters,
real-estate SPA/Oqood, regulatory licence applications by sector, court-filing bundle prep.

---

## 5. Deliverable types (reuse existing generators — no new render engine needed)
- **`generate_doc` (.docx)** — primary: contracts, policies, notices, resolutions, POAs. Needs the
  **bilingual / RTL Arabic** enhancement (parallel columns or mirrored sections; the existing
  editorial-font work + the open Calibri/font-embed item apply here).
- **`render_report` (PDF)** — contract-review reports, compliance health-checks, jurisdiction advisories,
  dispute briefs (designed, cited, page-safe — reuses the Report protocol).
- **`generate_spreadsheet` (.xlsx)** — filing trackers, contract registers, compliance matrices.
- **chat/plan** — quick clause explanations, intake triage.

---

## 6. Form-submission / filing automation (in scope, phased — mirrors the Tax dept's connector model)

**Tier 1 — ready-to-file output (build now, credential-free):** the agent produces the *exact*
document/pack the portal expects, plus a step-by-step submission guide:
- **UAE Pass e-notary** documents (POA, MOA, declarations, legal notices) — Federal Law 46/2021 makes
  the e-signature valid; produce the notary-ready bilingual doc + the UAE Pass submission steps.
- **Trademark application pack** (MOEC) — classes, applicant data, specimen, fees checklist.
- **UBO register form** + **goAML registration pack** + **Ejari-ready tenancy** + **MOHRE/Tasheel-format
  employment contract** + **MOFAIC attestation packet**.

**Tier 2 — pre-filled portal payloads (build next):** structured JSON/CSV that maps 1:1 to a portal's
fields so submission is copy-paste/upload, not re-keying (same idea as the WPS SIF file the Tax dept
already generates).

**Tier 3 — credentialed auto-submission (staged, like the Tax dept's parked OAuth connectors; NOT in
the public repo until secured):** direct submission via **UAE Pass / MOJ e-notary**, **MOEC trademark
e-filing**, **Dubai Courts / DIFC / ADGM e-registry**, **UBO/NER**, **MOHRE/Tasheel**, **Ejari**,
**goAML**. These need official integration, credentials, e-signature, and carry legal liability →
human-confirmation-before-submit, full audit log. **Keep on the roadmap; do not auto-file without
explicit per-submission user authorisation.**

---

## 7. How it maps onto the codebase (for the future build — no changes made now)
- `client/src/lib/departments.ts` → add `legal` department (accent + line-icon) with the plays above
  (each tagged `category` + a stable `key` like `legal.contract`, `legal.review`).
- `server/src/agent/expertise.ts` → a **UAE-legal persona** ("a meticulous UAE corporate/commercial
  drafter; jurisdiction-first; cites law+article; flags notary/attestation/lawyer-required; bilingual")
  + per-key standards (contract anatomy, MOHRE contract rules, MOA per 2025 amendments, PDPL policy
  structure, notice formalities, review rubric).
- **Knowledge base** → ship the §3 framework as dept knowledge (the project-knowledge mechanism), with
  a "verify against `uaelegislation.gov.ae`; never fabricate" instruction.
- `taskProfile.ts` → recognise legal-document intent (so the design/doc standards + model floor fire).
- **Bilingual/RTL** → the one genuinely new capability to add to `generate_doc` (Arabic column / RTL).
- **Scheduled runs** (existing) → power the legal calendar/renewal reminders.

---

## 8. Phased rollout
- **Phase 1 (catalog + brain):** `legal` department + the 16 plays + the UAE-legal persona + the §3
  knowledge base + guardrail footer + jurisdiction-intake. Deliverables via existing `generate_doc` /
  `render_report` / `generate_spreadsheet`. *(Mostly content/config — fits the existing pattern, low
  code risk.)*
- **Phase 2 (rigor + bilingual):** Arabic/RTL bilingual docx; a **clause library** + deterministic
  document checks (e.g., "governing-law + dispute clause present", "EOSG/notice present in employment
  contract", "UBO ≥25% threshold applied") paralleling the Tax dept's deterministic validators; Tier-1/2
  filing packs + pre-filled payloads.
- **Phase 3 (filing connectors):** staged, credentialed Tier-3 submission (UAE Pass e-notary, MOEC,
  courts e-registry) with human-confirm + audit log — security-reviewed, off the public repo.

---

## 9. Risks & mitigations
- **Unauthorised practice of law / liability** → "draft for licensed review, not advice" framing,
  source citation, human-in-the-loop, no auto-filing without authorisation.
- **Stale law** (UAE changes fast — e.g., the 2025 Companies-Law amendment) → KB is dated + the agent
  cites + can `web_fetch` the official register; schedule a periodic KB review.
- **Arabic accuracy** → flag certified legal translation; never claim the Arabic is court-ready.
- **Over-reach into Tax** → clear boundary; cross-reference, don't duplicate, the Tax dept.

---

### Open questions for you
1. **Scope of jurisdictions at launch** — all 7 emirates + DIFC + ADGM + free zones, or start with the
   highest-traffic (Dubai mainland + DIFC + DMCC/JAFZA free zones + ADGM) and expand?
2. **Bilingual** — is Arabic/RTL output a Phase-1 must, or acceptable as Phase-2?
3. **Filing automation appetite** — stop at Tier-1/2 (ready-to-file + pre-filled), or fund the
   credentialed Tier-3 connectors (and which portals first: UAE Pass e-notary, MOEC trademark, courts)?
4. **Liability posture** — is the "drafts-for-review, not legal advice" framing acceptable, or do you
   want a licensed-consultant review partner in the loop for certain deliverables?
