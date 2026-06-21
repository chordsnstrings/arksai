# Adding an expertise — the recipe

ArksAI's "expertise" is the domain-rigor layer: when a user's request maps to a known
task (e.g. `finance.cashflow`), the agent gets that task's professional standards injected
into its system prompt, plus the right department persona. An expertise shows up to the user
as a **play** (a ready-to-run tile in the Launchpad) AND auto-routes from a free-form message.

Adding one used to mean hand-editing two unrelated files that drifted. Now there is a **single
source of truth for the key set** (`shared/expertiseKeys.ts`) and a **sync test** that fails the
build if any piece is missing. Follow these five steps; the test enforces completeness.

> Golden rule: an expertise is only "added" when **all four** exist for its key — the registry
> entry, the client play, the server standard, and the server triggers. The sync test
> (`server/test/expertiseRegistry.test.ts`) checks this in both directions, so you cannot
> half-add one.

---

## The pieces

| Piece | File | What it is |
|---|---|---|
| **Registry key** | `shared/expertiseKeys.ts` (`EXPERTISE_KEYS`) | The canonical `"<dept>.<task>"` id. Single source of truth. |
| **Play** | `client/src/lib/departments.ts` | The user-facing tile + the ready-to-run first message. |
| **Standard** | `server/src/agent/expertise.ts` (`TASK`) | The professional rigor injected into the prompt. |
| **Triggers** | `server/src/agent/expertise.ts` (`TASK_TRIGGERS`) | Phrases that auto-route a free-form message to this expertise. |

Departments themselves also need two things, but only when you add a NEW department:
a **persona** in `DEPARTMENT` and **`DEPARTMENT_TRIGGERS`**, both in `expertise.ts`, plus the
department id in `DEPARTMENT_IDS` in `shared/expertiseKeys.ts` and a `Department` entry in
`departments.ts`.

---

## Steps (adding a task to an existing department)

### 1. Pick the department + the key
Choose the department (e.g. `personal`, `finance`) and a short task slug. The key is
`"<departmentId>.<task>"`, e.g. `personal.complaintletter`. Use `[a-z_]` only.

### 2. Register the key (the single source of truth)
Add the key to `EXPERTISE_KEYS` in `shared/expertiseKeys.ts`, under its department's group:

```ts
  // personal
  'personal.complaintletter',
```

This is now the authoritative list; the compiler types the client `Play.key` against it, and
the sync test compares every other side to it.

### 3. Add the play (`client/src/lib/departments.ts`)
Add a `Play` to the right `Department.plays`. `key` is typed as `ExpertiseKey`, so an
unregistered key is a **compile error**.

```ts
{ key: 'personal.complaintletter', title: 'Complaint letter', blurb: 'Firm, polite, effective.',
  mode: 'code', model: A, category: 'create', icon: 'mail',
  prompt: 'Write a firm but polite complaint / dispute letter (an editable .docx): the facts, the specific issue, what I want done, and an escalation line. Ask me the essentials, then draft it.' },
```

- Pick `mode`: `report` → designed PDFs/decks; `code` → apps, sheets, docs; `chat` → conversational.
- Pin `model` only with the constants `A` (`arksai-auto`) or `M3` (`arksai-max`); omit to route by mode.
- The `prompt` IS the first message — make it a real, ready-to-run brief (≥80 chars; the catalog test enforces this).

### 4. Add the standard (`server/src/agent/expertise.ts` → `TASK`)
Compose from the reusable archetypes (`REPORT`, `RESEARCH`, `DECK`, `DASHBOARD`, `FIN_SHEET`,
`TRACKER`, `HR_DOC`, `TECH_DOC`, `SOCIAL`) plus a one-line task delta. Only write the part that's
specific to this task — the archetype carries the shared rigor.

```ts
  'personal.complaintletter':
    'Complaint / dispute letter: firm but polite; lead with the facts (dates, order/ref numbers); state the specific failure and the exact remedy sought; give a reasonable deadline and an escalation line; keep it to one page. Never invent facts.',
```

### 5. Add the triggers (`server/src/agent/expertise.ts` → `TASK_TRIGGERS`)
3–8 strong, natural, lowercase phrasings a real user would type. Multi-word phrases route more
decisively. Phrases must be **unique across tasks** (a collision test guards this).

```ts
  'personal.complaintletter': ['complaint letter', 'dispute letter', 'letter of complaint', 'write a complaint'],
```

### 6. Run the gate
```
npm run typecheck && npm test && npm run build
```
The sync test (`expertiseRegistry.test.ts`) confirms the key now has a play, a standard, and
triggers, with no orphans and no trigger collisions. If you forgot any piece, it fails with a
message naming the exact missing key. Optionally add the new phrasing to the benchmark in
`expertiseRouter.test.ts` so the auto-route is locked.

---

## Adding a NEW department

1. Add the department id to `DEPARTMENT_IDS` in `shared/expertiseKeys.ts`.
2. Add its keys to `EXPERTISE_KEYS` (group them under a `// <dept>` comment).
3. Add a `persona` for it in `DEPARTMENT` and phrases in `DEPARTMENT_TRIGGERS` (both in `expertise.ts`).
   (A module-load guard + the sync test both require a persona for every registered department.)
4. Add a `Department` entry (with `id`, `name`, `blurb`, `accent`, `icon`, `plays`) to
   `DEPARTMENTS` in `departments.ts` — `id` is typed `DepartmentId`, so it must be registered.
5. Add each play, standard, and triggers as above. Run the gate.

---

## Worked example — `personal.complaintletter`

1. `shared/expertiseKeys.ts`: add `'personal.complaintletter'` under the `personal` group
   (and `'personal'` to `DEPARTMENT_IDS` if `personal` is new).
2. `departments.ts`: add the play (step 3 above) to the Personal department's `plays`.
3. `expertise.ts` `TASK`: add the standard (step 4).
4. `expertise.ts` `TASK_TRIGGERS`: add `['complaint letter', 'dispute letter', …]` (step 5).
5. `npm run typecheck && npm test && npm run build` → green. Typing
   "write a complaint letter about a faulty product" now auto-routes to `personal.complaintletter`,
   and the play appears in the Launchpad.

That's the whole drift-proof loop: register the key, fill the four pieces, the test guarantees
they all exist and agree.
