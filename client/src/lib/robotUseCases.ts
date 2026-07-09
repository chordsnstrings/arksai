/**
 * THE ROBOT USE-CASE CATALOG (operator 2026-07-06: "the use cases for robots is higher
 * now — think of the use cases, and create UI for all of them").
 *
 * Every card is a PRESET over capabilities that already exist in the engine — role,
 * mandate, escalation defaults, autonomy, studio-tools policy, and which panels the hire
 * flow should surface. Nothing here adds server behavior; it packages what a robot can
 * already do into jobs a non-technical owner recognizes:
 *  - grounded auto-replies on email / WhatsApp / Telegram / SMS (voice notes understood,
 *    attachments read, per-sender memory, meeting invites answered with real iCal)
 *  - STUDIO TOOLS mid-conversation: it can MAKE an image, ad creative, document,
 *    spreadsheet or chart, or pull stock photos — delivered on the same channel
 *  - the COMMANDER build bridge: text it to build anything the platform can build
 *    (websites published live, decks, reports, videos, music…) and deliver it anywhere
 *  - gated HTTP actions (live lookups the admin connects), routines (digests + scheduled
 *    builds), remote approval, per-robot analytics.
 */

export type UseCaseGroup = 'talk' | 'make' | 'schedule';

export interface RobotUseCase {
  id: string;
  emoji: string;
  title: string;
  blurb: string;
  /** Capability tags rendered as chips on the card. */
  chips: string[];
  group: UseCaseGroup;
  /** Server role this maps onto (custom roles carry the persona in config). */
  kind: 'customer_service' | 'personal_assistant' | 'custom';
  /** True for the department-specialist card — the dept picker appears. */
  wantsDept?: boolean;
  name: string;
  mandate: string;
  knowledgeHint: string;
  escalateOn?: string;
  /** Default autonomy for this job (auto = quiet inbox, ask = approve each reply). */
  autonomy: 'autonomous' | 'ask_big' | 'ask_all';
  /** Studio-tools policy this job should start with. */
  replyTools?: 'commanders' | 'everyone' | 'off';
  /** Step 3 also mounts the commanders panel (this job is driven by YOUR commands). */
  commanderCentric?: boolean;
  /** One-line pointer shown after hire (where to finish the setup). */
  postHire?: string;
}

export const USE_CASE_GROUPS: { id: UseCaseGroup; label: string; sub: string }[] = [
  { id: 'talk', label: 'Answer people', sub: 'It watches its channels and replies for you — around the clock.' },
  { id: 'make', label: 'Make things on command', sub: 'You message it; it produces and delivers real work.' },
  { id: 'schedule', label: 'Run on a schedule', sub: 'It works on a rhythm and reports in — no prompting.' },
];

export const ROBOT_USE_CASES: RobotUseCase[] = [
  {
    id: 'support',
    emoji: '🎧',
    title: 'Customer support desk',
    blurb: 'Answers customer messages on email, WhatsApp, Telegram or SMS from your knowledge — warm, on-brand, and it escalates the sensitive stuff to you.',
    chips: ['24/7 replies', 'Voice notes understood', 'Reads attachments', 'Escalates to you'],
    group: 'talk',
    kind: 'customer_service',
    name: 'Support Desk',
    mandate:
      'Reply to incoming customer messages (email, WhatsApp, Telegram, SMS): answer from our knowledge, keep it warm and on-brand, and escalate refunds, billing, or anything sensitive to a human.',
    knowledgeHint: 'Paste your FAQ, policies, product info, opening hours, delivery terms…',
    escalateOn: 'refunds, cancellations, anything about money, legal threats, an upset customer',
    autonomy: 'autonomous',
  },
  {
    id: 'sales',
    emoji: '💼',
    title: 'Sales assistant',
    blurb: 'Answers product and pricing questions from your knowledge, and can MAKE and send a brochure, one-pager or price sheet right in the chat. Hot leads get flagged to you immediately.',
    chips: ['Makes & sends brochures', 'Product answers', 'Flags hot leads'],
    group: 'talk',
    kind: 'custom',
    name: 'Sales Assistant',
    mandate:
      'Answer product, pricing and availability questions from our knowledge. When a prospect asks for details in writing, produce a clean one-page document or price sheet and send it. Flag serious buying interest, discount requests, and contract questions to a human immediately.',
    knowledgeHint: 'Paste your product catalog, pricing, packages, differentiators, common objections…',
    escalateOn: 'discount requests, contract terms, serious buying interest, complaints',
    autonomy: 'autonomous',
    replyTools: 'everyone',
    postHire: 'It can send documents it makes to anyone it talks to — tune that under Settings → Studio tools.',
  },
  {
    id: 'orderdesk',
    emoji: '📦',
    title: 'Order & booking desk',
    blurb: 'Answers "where is my order?"-type questions with LIVE data — connect a lookup (order status, stock, booking slots) and it fetches the real answer before replying.',
    chips: ['Live lookups', 'Order status', 'Escalates exceptions'],
    group: 'talk',
    kind: 'custom',
    name: 'Order Desk',
    mandate:
      'Handle order and booking questions. Use the connected lookups to fetch the real status before answering — never guess an order state. Escalate refunds, damaged goods, and anything the lookups cannot answer.',
    knowledgeHint: 'Paste your shipping times, return policy, booking rules, service areas…',
    escalateOn: 'refunds, damaged or lost orders, chargebacks',
    autonomy: 'autonomous',
    postHire: 'Connect a live lookup (your order-status API) under Settings → Actions.',
  },
  {
    id: 'assistant',
    emoji: '📇',
    title: 'Executive assistant',
    blurb: 'Manages your inbox and chats on your behalf — triages, acknowledges, accepts or declines meeting invites with a real calendar reply, proposes times.',
    chips: ['Inbox triage', 'Real iCal replies', 'Checks with you first'],
    group: 'talk',
    kind: 'personal_assistant',
    name: 'Personal Assistant',
    mandate:
      'Manage my inbox: triage what arrives, acknowledge messages, accept or decline meeting invitations, and propose times — checking with me before anything consequential.',
    knowledgeHint: 'Your preferences: meeting hours, who always gets time, what to decline, tone…',
    autonomy: 'ask_big',
  },
  {
    id: 'specialist',
    emoji: '✦',
    title: 'Department specialist',
    blurb: 'An expert for one function — Finance, Marketing, Legal, HR… — that answers messages with that department\'s rigor and voice.',
    chips: ['Domain expertise', 'On-brand answers'],
    group: 'talk',
    kind: 'custom',
    wantsDept: true,
    name: '',
    mandate: '',
    knowledgeHint: 'Paste the documents, policies and context this specialist should answer from…',
    autonomy: 'autonomous',
  },
  {
    id: 'studio',
    emoji: '🎨',
    title: 'Studio & builder',
    blurb: 'Your production line in a chat. Text it for an image, ad creative, document, spreadsheet or chart and it makes the file on the spot. Ask for a website, video, deck or song and it runs a full build — delivered wherever you say.',
    chips: ['Images & ad creatives', 'Docs · sheets · charts', 'Builds websites & videos', 'Delivers anywhere'],
    group: 'make',
    kind: 'custom',
    name: 'Studio',
    mandate:
      'You are my on-demand production studio. When I ask for an image, creative, document, spreadsheet or chart, make it and send it here. When I ask for something bigger — a website, video, deck, report or song — build it completely and deliver it where I say. Keep replies short; the work is the answer.',
    knowledgeHint: 'Brand context: your company, colors, logo description, tone, standard footer…',
    autonomy: 'autonomous',
    replyTools: 'commanders',
    commanderCentric: true,
    postHire: 'Add YOUR OWN address below — only commanders can order builds and studio work.',
  },
  {
    id: 'reporter',
    emoji: '📈',
    title: 'Reporting robot',
    blurb: 'Recurring reports without asking twice: a weekly sales PDF, a monthly summary deck, a daily digest of what it handled — built on schedule and sent to your channel.',
    chips: ['Scheduled builds', 'Daily/weekly digest', 'Delivered to you'],
    group: 'schedule',
    kind: 'custom',
    name: 'Reporter',
    mandate:
      'Produce my recurring reports on schedule and send them to my channel. Keep each report consistent with the last one; flag anomalies in a short note with the delivery.',
    knowledgeHint: 'What the report covers, where the numbers come from, the sections you expect…',
    autonomy: 'autonomous',
    replyTools: 'commanders',
    commanderCentric: true,
    postHire: 'Set the rhythm under Settings → Routines (daily/weekly report briefs), and add your address below so it can deliver to you.',
  },
  {
    id: 'social',
    emoji: '📣',
    title: 'Social media manager',
    blurb: 'Runs your Facebook & Instagram: plans and posts content, replies to comments and DMs, and creates & optimises ads — as hands-on or hands-off as you set the autonomy slider.',
    chips: ['Posts & schedules', 'Replies to comments', 'Runs ads on a budget', 'Autonomy slider'],
    group: 'make',
    kind: 'custom',
    name: 'Social Manager',
    mandate:
      'Manage our Facebook Page + Instagram: plan and publish on-brand posts, reply warmly to comments and DMs (escalating anything negative or sensitive), and plan/run paid ads within the budget. Generate the creative; never post placeholders. Follow the autonomy setting — propose when low, act when high.',
    knowledgeHint: 'Your brand voice, products/offers, target audience, do-not-say topics, posting cadence, monthly ad budget…',
    escalateOn: 'complaints, refunds, legal or press matters, anything negative or that you are unsure how to answer',
    autonomy: 'ask_all',
    replyTools: 'commanders',
    commanderCentric: true,
    postHire: 'Connect your Facebook Page + Instagram under Settings → Connections, then set the autonomy slider and a daily ad-spend cap under Settings → Social.',
  },
];

export const useCaseSpec = (id: string): RobotUseCase | undefined => ROBOT_USE_CASES.find((u) => u.id === id);
