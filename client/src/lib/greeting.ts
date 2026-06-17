/**
 * A warm, personalized, time-of-day greeting for a returning user — Claude-style
 * ("Coffee and ArksAI time, Kamran?"). Uses the user's LOCAL time (client clock) and a
 * pool of lines per slot so it varies and never feels canned. The name is optional; each
 * line carries a {n} slot that becomes ", Name" when known and nothing when not.
 */

type Slot = 'morning' | 'afternoon' | 'evening' | 'night';

const LINES: Record<Slot, string[]> = {
  morning: [
    'Coffee and ArksAI time{n}?',
    'Morning{n} — what are we shipping today?',
    'Good morning{n}. What’s first on the list?',
    'Rise and build{n}. What do you need?',
    'Fresh start{n} — what are we making this morning?',
    'Morning{n}. Got something on your mind to create?',
  ],
  afternoon: [
    'Good afternoon{n}. What are we working on?',
    'Afternoon{n} — what can I make for you?',
    'Hey{n}, pick up where you left off, or something new?',
    'Afternoon{n}. What’s the next thing to ship?',
    'Back at it{n}? Tell me what you need.',
    'Good afternoon{n} — let’s get something done.',
  ],
  evening: [
    'Good evening{n}. One more thing to ship?',
    'Evening{n} — what are we making tonight?',
    'Hey{n}, winding down or building something?',
    'Evening{n}. What can I get done for you?',
    'Good evening{n} — what’s on your plate?',
  ],
  night: [
    'Working late{n}? Let’s make it quick and good.',
    'Late one{n} — what are we building?',
    'Burning the midnight oil{n}? What do you need?',
    'Still up{n}? Tell me what to make.',
    'Night owl{n}? Let’s ship something.',
  ],
};

function slotFor(hour: number): Slot {
  if (hour < 5 || hour >= 22) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

/** First name only, trimmed; '' if none / a generic placeholder. */
export function displayName(rawName?: string | null): string {
  try {
    const stored = localStorage.getItem('arksai.name');
    if (stored && stored.trim()) return stored.trim().split(/\s+/)[0];
  } catch {
    /* private mode */
  }
  const n = (rawName ?? '').trim();
  if (!n || /^(operator|admin|user)$/i.test(n)) return '';
  return n.split(/\s+/)[0];
}

/** A varied, time-aware greeting. Rotates by the hour so repeat visits differ. */
export function greeting(name?: string | null, now: Date = new Date()): string {
  const pool = LINES[slotFor(now.getHours())];
  // hour-of-epoch seed → a different line as the day goes on / across visits
  const idx = Math.floor(now.getTime() / 3_600_000) % pool.length;
  const n = name ? `, ${name}` : '';
  return pool[idx].replace('{n}', n);
}
