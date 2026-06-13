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
