import type { SessionMode } from '../../../shared/types';
import { complexityTier, type Tier } from './router';

/**
 * What general people actually make. Visual deliverables get the full design
 * system + gating visual QC; non-visual ones (api/cli/library) don't.
 */
export type TaskType =
  | 'web-app'
  | 'landing'
  | 'dashboard'
  | 'form'
  | 'portfolio'
  | 'content'
  | 'internal-tool'
  | 'data-viz'
  | 'mobile'
  | 'report'
  | 'api'
  | 'cli'
  | 'library'
  | 'generic';

export type Audience = 'marketing' | 'internal' | 'consumer' | 'developer';

export interface TaskProfile {
  type: TaskType;
  /** Drives the design context, gating visual QC, and the quality model floor. */
  isVisual: boolean;
  audience?: Audience;
  tier: Tier;
}

const VISUAL_TYPES = new Set<TaskType>([
  'web-app',
  'landing',
  'dashboard',
  'form',
  'portfolio',
  'content',
  'internal-tool',
  'data-viz',
  'mobile',
  'report',
]);

// Ordered most-specific-first. First match wins.
const TYPE_RULES: { type: TaskType; re: RegExp }[] = [
  { type: 'landing', re: /\b(landing\s?page|marketing\s?(site|page)|home\s?page|hero\s?section|waitlist|product\s?page|sales\s?page)\b/ },
  { type: 'data-viz', re: /\b(chart|graph|plot|data\s?viz|visuali[sz]ation|histogram|scatter|heatmap)\b/ },
  { type: 'dashboard', re: /\b(dashboard|admin\s?(panel|console)|analytics|metrics|kpi|reporting\s?ui)\b/ },
  { type: 'form', re: /\b(form|survey|questionnaire|sign[\s-]?up\s?page|contact\s?form|onboarding\s?flow|wizard)\b/ },
  { type: 'portfolio', re: /\b(portfolio|personal\s?(site|website)|r[eé]sum[eé]|cv\s?site|about[\s-]?me)\b/ },
  { type: 'content', re: /\b(blog|article|docs?\s?site|documentation\s?site|newsletter|content\s?site|magazine)\b/ },
  { type: 'internal-tool', re: /\b(internal\s?tool|crud\s?app|admin\s?tool|back\s?office|ops\s?tool)\b/ },
  { type: 'mobile', re: /\b(mobile\s?app|ios\s?app|android\s?app|react\s?native|expo|pwa|phone\s?app)\b/ },
  { type: 'library', re: /\b(library|npm\s?package|sdk|reusable\s?(module|component\s?lib))\b/ },
  { type: 'cli', re: /\b(cli|command[\s-]?line|terminal\s?(app|tool)|shell\s?script)\b/ },
  { type: 'api', re: /\b(api|rest\s?api|graphql|endpoint|backend\s?(service|only)|microservice|webhook|cron|worker)\b/ },
  // generic web/app catch-alls (after the specific ones)
  { type: 'web-app', re: /\b(web\s?app|website|web\s?site|app|ui|front\s?end|interface|page|html|css|react|vue|svelte|next\.?js|tailwind)\b/ },
];

const STRONG_UI = /\b(ui|website|web\s?app|landing|dashboard|html|css|react|vue|svelte|tailwind|page|design|frontend|front\s?end)\b/;

/** Cheap, deterministic classification from task text + mode. Side-effect free. */
export function classifyTask(task: string, mode: SessionMode): TaskProfile {
  const tier = complexityTier(task, mode);
  if (mode === 'report') return { type: 'report', isVisual: true, audience: undefined, tier };

  const t = task.toLowerCase();
  let type: TaskType = 'generic';
  for (const rule of TYPE_RULES) {
    if (rule.re.test(t)) {
      type = rule.type;
      break;
    }
  }

  // generic is only visual if there are explicit UI signals (conservative).
  const isVisual = VISUAL_TYPES.has(type) || (type === 'generic' && STRONG_UI.test(t));

  let audience: Audience | undefined;
  if (type === 'landing' || type === 'portfolio' || type === 'content') audience = 'marketing';
  else if (type === 'api' || type === 'cli' || type === 'library') audience = 'developer';
  else if (type === 'dashboard' || type === 'internal-tool') audience = 'internal';
  else if (isVisual) audience = 'consumer';

  return { type, isVisual, audience, tier };
}

/**
 * Archetype router (Phase 3): map the brief → the scaffold-first architecture pick, so the
 * plan gate SHOWS the user what will be built ("multi-tenant SaaS → service + orgs + crud")
 * and the build starts from the right correct-by-construction base. Pure + deterministic;
 * the model may adjust with a stated reason, never silently.
 */
export interface ArchitectureSuggestion {
  base: 'scaffold_app' | 'create_react_app' | 'create_web_app' | 'create_expo_app';
  modules: string[];
  /** One human-readable line for the plan ("Multi-tenant SaaS → scaffold_app + orgs, crud, dashboard"). */
  line: string;
}

const BACKEND_SIGNALS =
  /\b(login|log[\s-]?in|sign[\s-]?up|account|auth|users?\b|members?\b|multi[\s-]?tenant|saas|workspace|team|database|backend|persist|server[\s-]?side|api\b|store\s?data|save\s?data|orders?\b|bookings?\b|reservations?\b|inventory|crm|admin)/;

const MODULE_SIGNALS: { name: string; re: RegExp }[] = [
  { name: 'orgs', re: /\b(multi[\s-]?tenant|saas|workspaces?|teams?|organi[sz]ations?|invite|memberships?|tenants?)\b/ },
  { name: 'catalog', re: /\b(shop|store(front)?|e[\s-]?commerce|products?|cart|checkout|sell(ing)?|orders?|menu\s?ordering)\b/ },
  { name: 'payments', re: /\b(stripe|paypal|payments?|pay\s?online|card\s?payments?|take\s?payments?|accept\s?(cards?|payments?))\b/ },
  { name: 'booking', re: /\b(book(ing|ings)?|appointments?|reservations?|time\s?slots?|scheduling|clinic|salon|rentals?|court|classes?\s?schedule)\b/ },
  { name: 'cms-lite', re: /\b(blog|posts?|articles?|cms|news(letter)?\s?section|journal|content\s?management)\b/ },
  { name: 'dashboard', re: /\b(dashboards?|analytics|kpis?|metrics|stats|charts?|insights)\b/ },
  { name: 'forms', re: /\b(contact\s?form|intake|surveys?|questionnaires?|submissions?|enquir(y|ies)|inquir(y|ies)|lead\s?capture)\b/ },
  { name: 'uploads', re: /\b(uploads?|photos?|images?|avatars?|attachments?|files?\b|gallery|documents?)\b/ },
  { name: 'realtime', re: /\b(real[\s-]?time|live\s?(updates?|board|feed)|chat|presence|notifications?|collaborat)/ },
  { name: 'jobs', re: /\b(daily|weekly|digest|cron|scheduled\s?(task|job|report)|reminders?|recurring)\b/ },
];

// "no accounts needed", "without a backend", "doesn't need login" — a NEGATED capability
// must not count as a backend signal. Remove negated phrases before matching.
const NEGATION_RE =
  /\b(?:no|without|not?\s+(?:need(?:ed|ing)?|required?|want(?:ed)?)|doesn'?t\s+(?:need|require|have)|don'?t\s+(?:need|require|want))\s+(?:an?\s+|any\s+)?(?:user\s+)?(logins?|log[\s-]?ins?|accounts?|sign[\s-]?ups?|auth\w*|backend|databases?|servers?)\b/g;

export function suggestArchitecture(task: string, profile: TaskProfile): ArchitectureSuggestion | null {
  const t = task.toLowerCase().replace(NEGATION_RE, ' ');
  if (profile.type === 'report' || profile.type === 'cli' || profile.type === 'library') return null;

  if (profile.type === 'mobile') {
    return { base: 'create_expo_app', modules: [], line: 'Mobile app → create_expo_app (native) or a PWA per the mobile decision rule.' };
  }

  // A developer API (webhooks/integrations, no UI) gets the api-only base — key auth +
  // a self-documenting index instead of a client app.
  if (profile.type === 'api') {
    return { base: 'scaffold_app', modules: [], line: 'Developer API → scaffold_app base "api-only" (JSON + API-key auth + self-documenting index page).' };
  }

  const needsBackend = BACKEND_SIGNALS.test(t) || profile.type === 'internal-tool';
  if (needsBackend) {
    const modules = MODULE_SIGNALS.filter((m) => m.re.test(t)).map((m) => m.name);
    // crud is the exemplar the domain entities are cloned from — always in for entity apps.
    if (!modules.length || !['catalog', 'booking', 'cms-lite'].some((m) => modules.includes(m)) || /\b(track|manage|records?|entries|list)\b/.test(t)) {
      modules.unshift('crud');
    }
    const label = modules.includes('orgs')
      ? 'Multi-tenant SaaS'
      : modules.includes('catalog')
        ? 'Commerce'
        : modules.includes('booking')
          ? 'Booking/scheduling'
          : 'App with accounts + data';
    return {
      base: 'scaffold_app',
      modules: [...new Set(modules)],
      line: `${label} → scaffold_app + modules: ${[...new Set(modules)].join(', ') || '(base)'}`,
    };
  }

  if (profile.type === 'landing' || profile.type === 'portfolio' || profile.type === 'content') {
    return { base: 'create_web_app', modules: [], line: 'Static site → create_web_app (no server, publishes as files).' };
  }
  if (profile.isVisual) {
    return { base: 'create_react_app', modules: [], line: 'Stateful client app → create_react_app (backend:true only if it must persist).' };
  }
  return null;
}
