import dns from 'node:dns';
import { fetchPublic } from '../lib/web';

/**
 * Mail-server autodiscovery: given just an email address, work out the IMAP + SMTP
 * host/port/security so the user doesn't have to know them. Three escalating steps —
 * a built-in table of common providers, an MX-record lookup (for Google Workspace /
 * Microsoft 365 custom domains), and finally the Mozilla/Thunderbird ISPDB. Returns
 * null when nothing matches → the UI then falls back to manual entry.
 *
 * The username is always the full email address (true for every provider here), and
 * the caller supplies the password — this only resolves the *servers*.
 */
export interface DetectedEmailConfig {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  /** How it was found — 'builtin:google', 'mx:m365', 'autoconfig', … (diagnostics). */
  source: string;
}

type Preset = Omit<DetectedEmailConfig, 'source'>;

// secure=true → implicit TLS on connect (993 IMAP / 465 SMTP); false → STARTTLS (587).
const PRESETS: Record<string, Preset> = {
  google: { imapHost: 'imap.gmail.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecure: true },
  m365: { imapHost: 'outlook.office365.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.office365.com', smtpPort: 587, smtpSecure: false },
  yahoo: { imapHost: 'imap.mail.yahoo.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.mail.yahoo.com', smtpPort: 465, smtpSecure: true },
  icloud: { imapHost: 'imap.mail.me.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.mail.me.com', smtpPort: 587, smtpSecure: false },
  aol: { imapHost: 'imap.aol.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.aol.com', smtpPort: 465, smtpSecure: true },
  zoho: { imapHost: 'imap.zoho.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.zoho.com', smtpPort: 465, smtpSecure: true },
  yandex: { imapHost: 'imap.yandex.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.yandex.com', smtpPort: 465, smtpSecure: true },
  gmx: { imapHost: 'imap.gmx.com', imapPort: 993, imapSecure: true, smtpHost: 'mail.gmx.com', smtpPort: 465, smtpSecure: true },
  godaddy: { imapHost: 'imap.secureserver.net', imapPort: 993, imapSecure: true, smtpHost: 'smtpout.secureserver.net', smtpPort: 465, smtpSecure: true },
  fastmail: { imapHost: 'imap.fastmail.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.fastmail.com', smtpPort: 465, smtpSecure: true },
};

// Common consumer domains → preset. Custom domains fall through to the MX lookup.
const DOMAIN_PRESET: Record<string, string> = {
  'gmail.com': 'google', 'googlemail.com': 'google',
  'outlook.com': 'm365', 'hotmail.com': 'm365', 'live.com': 'm365', 'msn.com': 'm365',
  'hotmail.co.uk': 'm365', 'outlook.co.uk': 'm365', 'live.co.uk': 'm365', 'hotmail.fr': 'm365',
  'yahoo.com': 'yahoo', 'yahoo.co.uk': 'yahoo', 'yahoo.in': 'yahoo', 'ymail.com': 'yahoo', 'rocketmail.com': 'yahoo',
  'icloud.com': 'icloud', 'me.com': 'icloud', 'mac.com': 'icloud',
  'aol.com': 'aol',
  'zoho.com': 'zoho', 'zohomail.com': 'zoho',
  'yandex.com': 'yandex', 'yandex.ru': 'yandex',
  'gmx.com': 'gmx', 'gmx.net': 'gmx', 'gmx.de': 'gmx',
  'fastmail.com': 'fastmail', 'fastmail.fm': 'fastmail',
};

/** Map a domain's MX exchange hosts to a known preset (Workspace/M365 custom domains). */
export function presetFromMx(mxHosts: string[]): string | null {
  const j = mxHosts.join(' ').toLowerCase();
  if (/google|googlemail|aspmx\.l\.google/.test(j)) return 'google';
  if (/outlook\.com|office365|mail\.protection\.outlook\.com|olc\.protection|microsoft/.test(j)) return 'm365';
  if (/yahoodns|yahoo/.test(j)) return 'yahoo';
  if (/icloud|me\.com|apple/.test(j)) return 'icloud';
  if (/zoho/.test(j)) return 'zoho';
  if (/yandex/.test(j)) return 'yandex';
  if (/secureserver\.net/.test(j)) return 'godaddy';
  if (/messagingengine\.com|fastmail/.test(j)) return 'fastmail';
  if (/gmx/.test(j)) return 'gmx';
  return null;
}

function withSource(p: Preset, source: string): DetectedEmailConfig {
  return { ...p, source };
}

export function domainOf(email: string): string | null {
  const d = (email.split('@')[1] || '').trim().toLowerCase().replace(/\.$/, '');
  return d && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : null;
}

/** Parse a Mozilla ISPDB / autoconfig XML doc into a config (regex — no XML dep). */
export function parseAutoconfigXml(xml: string): DetectedEmailConfig | null {
  const grab = (open: RegExp): { host: string; port: number; secure: boolean } | null => {
    const m = xml.match(open);
    if (!m) return null;
    const block = m[1];
    const host = (block.match(/<hostname>\s*([^<]+?)\s*<\/hostname>/i) || [])[1];
    const port = Number((block.match(/<port>\s*(\d+)\s*<\/port>/i) || [])[1]);
    const sock = ((block.match(/<socketType>\s*([^<]+?)\s*<\/socketType>/i) || [])[1] || '').toUpperCase();
    if (!host || !port) return null;
    return { host, port, secure: sock === 'SSL' };
  };
  const imap = grab(/<incomingServer[^>]*type="imap"[^>]*>([\s\S]*?)<\/incomingServer>/i);
  const smtp = grab(/<outgoingServer[^>]*type="smtp"[^>]*>([\s\S]*?)<\/outgoingServer>/i);
  if (!imap || !smtp) return null;
  return {
    imapHost: imap.host, imapPort: imap.port, imapSecure: imap.secure,
    smtpHost: smtp.host, smtpPort: smtp.port, smtpSecure: smtp.secure,
    source: 'autoconfig',
  };
}

async function resolveMx(domain: string): Promise<string[]> {
  const recs = await dns.promises.resolveMx(domain);
  return recs.sort((a, b) => a.priority - b.priority).map((r) => r.exchange);
}

async function mozillaAutoconfig(domain: string): Promise<DetectedEmailConfig | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetchPublic(`https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`, ctrl.signal);
    if (res.status !== 200 || !res.body) return null;
    return parseAutoconfigXml(res.body);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function detectEmailConfig(email: string): Promise<DetectedEmailConfig | null> {
  const domain = domainOf(email);
  if (!domain) return null;

  // 1. Built-in consumer domain.
  const direct = DOMAIN_PRESET[domain];
  if (direct) return withSource(PRESETS[direct], `builtin:${direct}`);

  // 2. MX record → Workspace / M365 / other custom-domain hosting.
  try {
    const mx = await resolveMx(domain);
    const id = presetFromMx(mx);
    if (id) return withSource(PRESETS[id], `mx:${id}`);
  } catch {
    /* no MX / DNS blocked → fall through */
  }

  // 3. Mozilla ISPDB autoconfig (covers thousands of providers).
  return mozillaAutoconfig(domain);
}
