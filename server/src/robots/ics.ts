/**
 * Minimal, dependency-free iCalendar handling for the personal-assistant invite lane
 * (RFC 5545/5546): parse a METHOD:REQUEST/CANCEL VEVENT, and build a METHOD:REPLY with the
 * robot's PARTSTAT (ACCEPTED/DECLINED) — UID + SEQUENCE preserved so the organizer's
 * calendar matches the reply to the right event.
 */

export interface ParsedInvite {
  method: 'REQUEST' | 'CANCEL' | 'REPLY' | 'OTHER';
  uid: string;
  sequence: number;
  summary: string;
  organizerEmail: string;
  /** Raw DTSTART value + its TZID (display is best-effort; the reply never rewrites time). */
  dtstart: string;
  tzid: string | null;
  attendees: string[];
}

/** Unfold RFC5545 folded lines (CRLF + space/tab continuation). */
export function unfoldIcs(text: string): string[] {
  return text
    .replace(/\r\n[ \t]/g, '')
    .replace(/\n[ \t]/g, '')
    .split(/\r?\n/)
    .filter(Boolean);
}

function propValue(line: string): string {
  const i = line.indexOf(':');
  return i >= 0 ? line.slice(i + 1).trim() : '';
}

function propParam(line: string, param: string): string | null {
  const m = new RegExp(`;${param}=("[^"]*"|[^;:]*)`, 'i').exec(line.split(':')[0] || '');
  return m ? m[1].replace(/^"|"$/g, '') : null;
}

function mailtoEmail(v: string): string {
  const m = /mailto:([^\s;]+)/i.exec(v);
  return (m ? m[1] : v).trim().toLowerCase();
}

export function parseIcs(text: string): ParsedInvite | null {
  if (!text || !/BEGIN:VCALENDAR/i.test(text)) return null;
  const lines = unfoldIcs(text);
  const out: ParsedInvite = {
    method: 'OTHER',
    uid: '',
    sequence: 0,
    summary: '',
    organizerEmail: '',
    dtstart: '',
    tzid: null,
    attendees: [],
  };
  let inEvent = false;
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith('BEGIN:VEVENT')) inEvent = true;
    else if (upper.startsWith('END:VEVENT')) inEvent = false;
    else if (upper.startsWith('METHOD:')) {
      const v = propValue(line).toUpperCase();
      out.method = v === 'REQUEST' || v === 'CANCEL' || v === 'REPLY' ? (v as ParsedInvite['method']) : 'OTHER';
    } else if (inEvent) {
      if (upper.startsWith('UID')) out.uid = propValue(line);
      else if (upper.startsWith('SEQUENCE')) out.sequence = parseInt(propValue(line), 10) || 0;
      else if (upper.startsWith('SUMMARY')) out.summary = propValue(line);
      else if (upper.startsWith('ORGANIZER')) out.organizerEmail = mailtoEmail(propValue(line));
      else if (upper.startsWith('DTSTART')) {
        out.dtstart = propValue(line);
        out.tzid = propParam(line, 'TZID');
      } else if (upper.startsWith('ATTENDEE')) out.attendees.push(mailtoEmail(propValue(line)));
    }
  }
  if (!out.uid) return null;
  return out;
}

/** Human-readable time for the reply context ("2026-07-10 14:00 (Asia/Dubai)"). */
export function describeWhen(inv: ParsedInvite): string {
  const v = inv.dtstart;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(v);
  if (!m) return v || 'time unspecified';
  const base = `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
  if (/Z$/.test(v)) return `${base} UTC`;
  return inv.tzid ? `${base} (${inv.tzid})` : base;
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function dtstampNow(now = new Date()): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Build the RFC 5546 METHOD:REPLY the robot sends back to the organizer. CRLF line endings;
 * UID/SEQUENCE copied from the request; ATTENDEE = the robot's own mailbox with its PARTSTAT.
 */
export function buildIcsReply(
  inv: Pick<ParsedInvite, 'uid' | 'sequence' | 'organizerEmail' | 'summary'>,
  attendeeEmail: string,
  partstat: 'ACCEPTED' | 'DECLINED',
  now = new Date(),
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//ArksAI//Robot Assistant//EN',
    'VERSION:2.0',
    'METHOD:REPLY',
    'BEGIN:VEVENT',
    `UID:${inv.uid}`,
    `SEQUENCE:${inv.sequence || 0}`,
    `DTSTAMP:${dtstampNow(now)}`,
    inv.organizerEmail ? `ORGANIZER:mailto:${inv.organizerEmail}` : '',
    `ATTENDEE;PARTSTAT=${partstat};CN=${icsEscape(attendeeEmail)}:mailto:${attendeeEmail}`,
    inv.summary ? `SUMMARY:${icsEscape(inv.summary)}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.join('\r\n') + '\r\n';
}
