import { useEffect, useState } from 'react';
import { MAX_MODEL } from '@shared/types';
import { api, type PlayAccount, type PlayTrack } from '../api/client';
import { useStore } from '../state/sessionStore';

/**
 * "Android Apps" — the dedicated full-page surface (Sidebar / /android), mirroring Robots.
 * It owns the mobile-app flow: a guided INTAKE wizard (what · type · how it runs · visual
 * kit · backend · device capabilities · branding) that composes a precise brief. Because a
 * good native app needs a real plan, the agent does a short PLAN + clarifying round before
 * building (not blind one-shot), then hands off to the session view where the live progress
 * and the installable APK appear. Honest about timing — native builds take minutes.
 *
 * Also hosts the (dormant) PER-ORG Google Play connection: each company connects its OWN
 * developer account (admin-only), so apps publish under that company's identity + billing.
 */

type RunMode = 'pwa' | 'native' | 'both';
type BackendMode = 'none' | 'accounts' | 'realtime';

/** Device capabilities — each maps to an Expo module + the Android permission it needs. */
const FEATURES: { id: string; label: string; hint: string; brief: string }[] = [
  { id: 'camera', label: 'Camera / QR', hint: 'scan, photos', brief: 'Camera + QR/barcode scanning (expo-camera)' },
  { id: 'photos', label: 'Photo library', hint: 'pick & upload', brief: 'Photo library pick/upload (expo-image-picker)' },
  { id: 'location', label: 'Location / maps', hint: 'GPS, nearby', brief: 'Location + maps (expo-location, react-native-maps)' },
  { id: 'notifications', label: 'Notifications', hint: 'push, reminders', brief: 'Local + push notifications (expo-notifications)' },
  { id: 'contacts', label: 'Contacts', hint: 'address book', brief: 'Contacts access (expo-contacts)' },
  { id: 'microphone', label: 'Microphone', hint: 'voice, record', brief: 'Microphone / audio recording (expo-av)' },
  { id: 'biometric', label: 'Face / fingerprint', hint: 'secure login', brief: 'Biometric auth (expo-local-authentication)' },
  { id: 'calendar', label: 'Calendar', hint: 'events', brief: 'Calendar read/write (expo-calendar)' },
  { id: 'files', label: 'Files', hint: 'documents', brief: 'File/document access (expo-document-picker, expo-file-system)' },
  { id: 'media', label: 'Audio / video', hint: 'play media', brief: 'Audio/video playback (expo-av, expo-video)' },
  { id: 'haptics', label: 'Haptics', hint: 'vibration', brief: 'Haptics/vibration feedback (expo-haptics)' },
  { id: 'share', label: 'Share sheet', hint: 'send out', brief: 'Native share sheet (expo-sharing)' },
  { id: 'bluetooth', label: 'Bluetooth', hint: 'devices', brief: 'Bluetooth connectivity (react-native-ble-plx)' },
  { id: 'nfc', label: 'NFC / tap', hint: 'tap to read', brief: 'NFC read/write (react-native-nfc-manager)' },
];

/** App archetypes — steer the plan (screens, data model, flows). */
const TYPES: { id: string; label: string; hint: string }[] = [
  { id: 'utility', label: 'Utility / tool', hint: 'scanner, calculator, converter' },
  { id: 'social', label: 'Social / community', hint: 'profiles, feed, chat, swipe' },
  { id: 'marketplace', label: 'Marketplace', hint: 'listings, cart, checkout' },
  { id: 'booking', label: 'Booking / services', hint: 'schedule, slots, reminders' },
  { id: 'productivity', label: 'Productivity', hint: 'tasks, notes, tracker' },
  { id: 'content', label: 'Content / feed', hint: 'articles, video, library' },
  { id: 'health', label: 'Health / fitness', hint: 'logging, goals, streaks' },
  { id: 'finance', label: 'Finance', hint: 'wallet, budgets, payments' },
  { id: 'education', label: 'Education', hint: 'courses, quizzes, progress' },
  { id: 'other', label: 'Something else', hint: "I'll describe it" },
];

/** Android-specific visual kits — each is a concrete design direction injected into the brief. */
const KITS: { id: string; label: string; hint: string; bars: string[]; brief: string }[] = [
  {
    id: 'material',
    label: 'Material You',
    hint: 'dynamic color, rounded, elevated cards',
    bars: ['#6750a4', '#cfbcff', '#e8def8'],
    brief:
      'Material You / Material 3 — dynamic accent, rounded 16–28dp corners, tonal elevated surfaces, FAB, bottom nav, large headline type, ripple feedback.',
  },
  {
    id: 'minimal',
    label: 'Minimal / Editorial',
    hint: 'typography-first, hairlines, airy',
    bars: ['#1a1a1a', '#8a8a8a', '#ececec'],
    brief:
      'Minimal editorial — typography-first, generous whitespace, hairline dividers, restrained single accent, no heavy shadows, content-forward.',
  },
  {
    id: 'bold',
    label: 'Bold / Playful',
    hint: 'big type, vivid blocks, fun',
    bars: ['#ff5a5f', '#ffb400', '#00b8a9'],
    brief:
      'Bold & playful — oversized display type, vivid color blocks, chunky rounded buttons, friendly micro-animations, high-energy.',
  },
  {
    id: 'pro',
    label: 'Clean Pro',
    hint: 'neutral, crisp, data-dense',
    bars: ['#0f172a', '#475569', '#e2e8f0'],
    brief:
      'Clean professional — neutral palette, crisp cards, data-dense but legible, subtle borders, SaaS/enterprise feel, tabular numbers.',
  },
  {
    id: 'premium',
    label: 'Dark / Premium',
    hint: 'dark UI, neon accent, glassy',
    bars: ['#0b0b10', '#7c3aed', '#22d3ee'],
    brief:
      'Dark premium — near-black surfaces, one neon/gradient accent, glassy translucent cards, glow highlights, sleek and modern.',
  },
];

const ACCENTS = [
  '#e23744', '#f43f5e', '#f59e0b', '#eab308', '#10b981', '#14b8a6',
  '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#0f172a',
];

const TRACKS: { id: PlayTrack; label: string }[] = [
  { id: 'internal', label: 'Internal testing' },
  { id: 'closed', label: 'Closed testing' },
  { id: 'production', label: 'Production' },
];

export function AndroidConsole({ onClose }: { onClose: () => void }) {
  const setActive = useStore((s) => s.setActive);
  const beginRun = useStore((s) => s.beginRun);
  const me = useStore((s) => s.me);
  const isAdmin = !!(me?.isSuperadmin || me?.role === 'admin');
  const orgId = me?.currentOrg || null;

  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [type, setType] = useState('utility');
  const [run, setRun] = useState<RunMode>('native');
  const [kit, setKit] = useState('material');
  const [backend, setBackend] = useState<BackendMode>('none');
  const [features, setFeatures] = useState<string[]>([]);
  const [accent, setAccent] = useState(ACCENTS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const toggle = (f: string) =>
    setFeatures((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));

  const canBuild = name.trim().length > 1 && desc.trim().length > 5 && !busy;

  function brief(): string {
    const appName = name.trim();
    const typeLabel = TYPES.find((t) => t.id === type)?.label ?? type;
    const kitObj = KITS.find((k) => k.id === kit)!;
    const featList = features.map((id) => FEATURES.find((f) => f.id === id)?.brief).filter(Boolean);

    const lines: string[] = [
      `I want to build an Android app called "${appName}" — a ${typeLabel.toLowerCase()} app. Accent colour ${accent}.`,
      `What it does: ${desc.trim()}`,
      `Visual style: ${kitObj.brief}`,
      featList.length
        ? `Device capabilities to wire (use the right Expo modules + Android permissions, request at point-of-use, degrade gracefully on web): ${featList.join('; ')}.`
        : 'No special device capabilities.',
    ];

    if (run === 'pwa') {
      lines.push('Run target: a real installable PWA (manifest, service worker, app shell, add-to-home-screen, offline, safe-area) via add_ui_kit. No native APK.');
    } else {
      lines.push('Run target: a NATIVE Android app — Expo/expo-router, built to an installable APK on our build machine.');
      if (run === 'both') lines.push('Also ship the PWA/web version alongside the APK.');
    }

    if (backend === 'none') {
      lines.push('Data: local only (AsyncStorage seed) — no accounts, no network.');
    } else {
      lines.push(
        backend === 'realtime'
          ? 'Data: needs accounts AND live/shared/realtime data — add a backend.'
          : 'Data: needs accounts and saved/synced data — add a backend.',
      );
      lines.push('Backend deploys to our infra automatically (zero-config) — publish it and wire the client to its live URL with JWT.');
    }

    // The PLAN-FIRST gate — a good native app needs a plan before the long build.
    lines.push(
      '',
      'IMPORTANT — plan before you build:',
      '1. Restate this as a concrete BUILD PLAN: the screens + navigation, the data model, the key user flows, the device permissions, and (if applicable) the backend endpoints.',
      '2. Ask me up to 3 clarifying questions — ONLY about things that genuinely change the build (skip anything you can reasonably decide yourself).',
      '3. STOP and wait for my approval. Do NOT start coding until I reply to approve.',
      'Then once I approve: build fully autonomously and never loop. Compose from the mobile UI kit; crash-safe (root error boundary, loading/empty/error states).',
    );
    if (run !== 'pwa') {
      lines.push(
        'Native build steps after approval: create_expo_app → build the screens → ' +
          (backend !== 'none' ? 'add_app_backend → publish the backend → set API_BASE_URL → ' : '') +
          'verify the Expo WEB target boots clean → build_apk EXACTLY ONCE → give me the download link.',
      );
    }
    return lines.join('\n');
  }

  async function build() {
    if (!canBuild) return;
    setBusy(true);
    setErr('');
    try {
      const session = await api.createSession({ mode: 'code', model: MAX_MODEL });
      beginRun(session.id);
      await api.sendMessage(session.id, brief());
      setActive(session.id);
      onClose(); // hand off to the session view — plan, live progress + the APK appear there
    } catch (e: any) {
      setErr(e?.message || 'Could not start the build.');
      setBusy(false);
    }
  }

  return (
    <div className="android-surface">
      <header className="android-top">
        <button className="android-back" onClick={onClose} aria-label="Back">←</button>
        <div className="android-masthead">
          <span className="android-eyebrow">ANDROID APPS</span>
          <h1>Describe it once. Get a real, installable app.</h1>
          <p>A short guided setup, then ArksAI plans it with you, builds the app (and its backend), checks it works, and hands back an APK you can install.</p>
        </div>
      </header>

      <div className="android-wizard">
        <div className="aw-step">1 · The app</div>
        <label className="aw-field">
          <span className="aw-label">App name</span>
          <input className="aw-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Snap QR, Sparkmatch" maxLength={40} />
        </label>

        <label className="aw-field">
          <span className="aw-label">What should it do?</span>
          <textarea className="aw-input" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. A QR scanner that opens links and saves a history. Or: a dating app with a swipe deck, matches and chat. The more detail, the better the plan." />
        </label>

        <div className="aw-field">
          <span className="aw-label">What kind of app is it?</span>
          <div className="aw-grid">
            {TYPES.map((t) => (
              <button key={t.id} className={`aw-card ${type === t.id ? 'on' : ''}`} onClick={() => setType(t.id)} type="button">
                <strong>{t.label}</strong><span>{t.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="aw-step">2 · Look &amp; platform</div>
        <div className="aw-field">
          <span className="aw-label">Visual style</span>
          <p className="aw-sub">A starting design direction — ArksAI tailors it to your app.</p>
          <div className="aw-grid">
            {KITS.map((k) => (
              <button key={k.id} className={`aw-card ${kit === k.id ? 'on' : ''}`} onClick={() => setKit(k.id)} type="button">
                <span className="aw-kit-bar">{k.bars.map((c, i) => <i key={i} style={{ background: c, width: i === 0 ? 22 : 14 }} />)}</span>
                <strong>{k.label}</strong><span>{k.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="aw-field">
          <span className="aw-label">How should it run?</span>
          <div className="aw-segs">
            {([['native', 'Native APK', 'installs on Android'], ['pwa', 'Web app (PWA)', 'instant, no store'], ['both', 'Both', 'APK + web']] as const).map(([id, t, h]) => (
              <button key={id} className={`aw-seg ${run === id ? 'on' : ''}`} onClick={() => setRun(id)} type="button">
                <strong>{t}</strong><span>{h}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="aw-field">
          <span className="aw-label">Accent</span>
          <div className="aw-swatches">
            {ACCENTS.map((c) => (
              <button key={c} className={`aw-swatch ${accent === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setAccent(c)} type="button" aria-label={c} />
            ))}
          </div>
        </div>

        <div className="aw-step">3 · Capabilities &amp; data</div>
        <div className="aw-field">
          <span className="aw-label">Device features <em>(tap any it should use)</em></span>
          <div className="aw-chips">
            {FEATURES.map((f) => (
              <button key={f.id} className={`aw-chip ${features.includes(f.id) ? 'on' : ''}`} onClick={() => toggle(f.id)} type="button" title={f.hint}>{f.label}</button>
            ))}
          </div>
        </div>

        <div className="aw-field">
          <span className="aw-label">Does it need accounts or saved data?</span>
          <div className="aw-segs">
            <button className={`aw-seg ${backend === 'none' ? 'on' : ''}`} onClick={() => setBackend('none')} type="button"><strong>No</strong><span>local data only</span></button>
            <button className={`aw-seg ${backend === 'accounts' ? 'on' : ''}`} onClick={() => setBackend('accounts')} type="button"><strong>Accounts &amp; sync</strong><span>login, saved data</span></button>
            <button className={`aw-seg ${backend === 'realtime' ? 'on' : ''}`} onClick={() => setBackend('realtime')} type="button"><strong>Shared / live</strong><span>chat, feeds, realtime</span></button>
          </div>
          {backend !== 'none' && <p className="aw-note">The backend deploys to our infra automatically (zero-config) — nothing for you to host.</p>}
        </div>

        {run !== 'pwa' && isAdmin && orgId && <PlayPanel orgId={orgId} />}

        {err && <p className="aw-err">{err}</p>}

        <div className="aw-actions">
          <button className="aw-build" onClick={build} disabled={!canBuild}>{busy ? 'Starting…' : 'Plan & build my app'}</button>
          <p className="aw-time">
            {run === 'pwa'
              ? 'ArksAI will plan it with you, then a web app is ready in a couple of minutes.'
              : 'ArksAI plans it with you first, then native builds take a few minutes (compiled on a real build machine → an APK). You can watch the progress live.'}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Per-org Google Play connection (DORMANT scaffold). Admin-only. Each company connects its
 * OWN developer account (service-account JSON, encrypted server-side), so apps publish under
 * that company's identity + billing — never a shared ArksAI account. Until connected, native
 * builds still hand back a sideloadable APK; this just binds the account for the future
 * direct-to-Play pipeline.
 */
function PlayPanel({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<PlayAccount | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [sa, setSa] = useState('');
  const [devName, setDevName] = useState('');
  const [track, setTrack] = useState<PlayTrack>('internal');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let alive = true;
    api.getPlayAccount(orgId).then((a) => { if (alive) { setAccount(a); setLoaded(true); } }).catch(() => setLoaded(true));
    return () => { alive = false; };
  }, [orgId]);

  const connected = !!account?.hasCredentials;

  async function connect() {
    setBusy(true); setMsg('');
    try {
      const a = await api.savePlayAccount(orgId, { serviceAccountJson: sa.trim(), developerName: devName.trim() || undefined, defaultTrack: track });
      setAccount(a); setEditing(false); setSa(''); setMsg('Connected.');
    } catch (e: any) {
      setMsg(e?.message || 'Could not connect.');
    } finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true); setMsg('');
    try { await api.deletePlayAccount(orgId); setAccount(null); setMsg('Disconnected.'); }
    catch (e: any) { setMsg(e?.message || 'Could not disconnect.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="aw-play">
      <button className="aw-play-head" onClick={() => setOpen((o) => !o)} type="button">
        <span className="aw-play-title">Publish to Google Play <em style={{ fontWeight: 400, fontStyle: 'normal', color: 'var(--text-faint)' }}>(optional)</em></span>
        <span className="aw-play-state">
          <span className={`aw-dot ${connected ? 'ok' : ''}`} />
          {loaded ? (connected ? `Connected${account?.developerName ? ` · ${account.developerName}` : ''}` : 'Not connected') : '…'}
          <span style={{ marginLeft: 4 }}>{open ? '▾' : '▸'}</span>
        </span>
      </button>
      {open && (
        <div className="aw-play-body">
          <p className="aw-mini">Your company publishes under its <strong>own</strong> Google Play Developer account — your name on the listing, your billing. ArksAI uploads on your behalf with credentials you control.</p>
          {!connected && !editing && (
            <>
              <ol className="aw-steps">
                <li>Create a Google Play Developer account ($25 one-time) at play.google.com/console.</li>
                <li>In Google Cloud, create a <strong>service account</strong>, enable the <strong>Android Publisher API</strong>, and download its JSON key.</li>
                <li>In Play Console → Users &amp; permissions, invite that service account with release access.</li>
                <li>Paste the JSON key below.</li>
              </ol>
              <div className="aw-row"><button className="aw-mini-btn" onClick={() => setEditing(true)} type="button">Connect account</button></div>
            </>
          )}
          {editing && (
            <>
              <label className="aw-field">
                <span className="aw-label" style={{ fontSize: 12 }}>Developer / company name <em>(optional)</em></span>
                <input className="aw-input" value={devName} onChange={(e) => setDevName(e.target.value)} placeholder="Acme Mobile Ltd" />
              </label>
              <label className="aw-field">
                <span className="aw-label" style={{ fontSize: 12 }}>Service-account JSON key</span>
                <textarea className="aw-input" rows={4} value={sa} onChange={(e) => setSa(e.target.value)} placeholder='{ "type": "service_account", "project_id": "…", "private_key": "…", "client_email": "…" }' />
              </label>
              <div className="aw-field">
                <span className="aw-label" style={{ fontSize: 12 }}>Default release track</span>
                <div className="aw-segs">
                  {TRACKS.map((t) => (
                    <button key={t.id} className={`aw-seg ${track === t.id ? 'on' : ''}`} onClick={() => setTrack(t.id)} type="button"><strong style={{ fontSize: 13 }}>{t.label}</strong></button>
                  ))}
                </div>
              </div>
              <div className="aw-row">
                <button className="aw-mini-btn" onClick={connect} disabled={busy || sa.trim().length < 20} type="button">{busy ? 'Connecting…' : 'Save connection'}</button>
                <button className="aw-mini-btn" onClick={() => { setEditing(false); setSa(''); }} type="button">Cancel</button>
              </div>
            </>
          )}
          {connected && !editing && (
            <div className="aw-row">
              <span className="aw-mini">Service account: <strong>{account?.saEmail || '—'}</strong> · track: {account?.defaultTrack}</span>
              <button className="aw-mini-btn" onClick={() => setEditing(true)} type="button">Replace key</button>
              <button className="aw-mini-btn danger" onClick={disconnect} disabled={busy} type="button">Disconnect</button>
            </div>
          )}
          {msg && <p className="aw-mini" style={{ color: msg.includes('Connect') && !msg.includes('not') ? '#2ea043' : 'var(--text-muted)' }}>{msg}</p>}
          <p className="aw-mini">Direct-to-Play upload is coming next; for now a connected account is stored securely and native builds hand back a sideloadable APK.</p>
        </div>
      )}
    </div>
  );
}
