import { useState } from 'react';
import { MAX_MODEL } from '@shared/types';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';

/**
 * "Android Apps" — the dedicated full-page surface (reached from the Sidebar / /android),
 * mirroring Robots. It owns the mobile-app flow: a guided INTAKE wizard (what it does · how it
 * runs · backend? · device features · branding) that composes a precise brief and kicks off a
 * build, then hands off to the session view where the live progress + the installable APK appear.
 * Honest about timing — native builds take minutes.
 */

type RunMode = 'pwa' | 'native' | 'both';
type Feature = 'camera' | 'location' | 'notifications' | 'photos';

const FEATURES: { id: Feature; label: string; hint: string }[] = [
  { id: 'camera', label: 'Camera / QR', hint: 'scan codes, take photos' },
  { id: 'photos', label: 'Photo library', hint: 'pick & upload images' },
  { id: 'location', label: 'Location / maps', hint: 'GPS, nearby, maps' },
  { id: 'notifications', label: 'Notifications', hint: 'push / reminders' },
];

const ACCENTS = ['#e23744', '#0ea5a4', '#6d5efc', '#f59e0b', '#10b981', '#0f172a'];

export function AndroidConsole({ onClose }: { onClose: () => void }) {
  const setActive = useStore((s) => s.setActive);
  const beginRun = useStore((s) => s.beginRun);

  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [run, setRun] = useState<RunMode>('native');
  const [needsBackend, setNeedsBackend] = useState(false);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [accent, setAccent] = useState(ACCENTS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const toggle = (f: Feature) =>
    setFeatures((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));

  const canBuild = name.trim().length > 1 && desc.trim().length > 5 && !busy;

  function brief(): string {
    const appName = name.trim();
    const featLine = features.length
      ? `Device features needed: ${features.join(', ')} (use the right Expo modules; degrade gracefully on web).`
      : 'No special device features.';
    const lines: string[] = [
      `Build an Android app called "${appName}" (accent ${accent}). What it does: ${desc.trim()}`,
      'Work fully autonomously, never loop. Minimal, modern, classy — compose from the mobile UI kit; crash-safe (root error boundary, loading/empty/error states).',
      featLine,
    ];
    if (run === 'pwa') {
      lines.push(
        'RUN AS A PWA: build a real installable web app with add_ui_kit (manifest, service worker, app shell, add-to-home-screen, safe-area, offline). Publish it and give the install link. No native APK.',
      );
    } else {
      lines.push(
        'RUN AS A NATIVE ANDROID APP: (1) create_expo_app (name + accent); (2) build the screens with expo-router from the mobile UI kit; (3) verify the Expo WEB target boots clean; (4) THEN call build_apk EXACTLY ONCE and give the download link. One build only.',
      );
      if (run === 'both') lines.push('ALSO ship the PWA/web version alongside the APK.');
    }
    if (needsBackend) {
      lines.push(
        'NEEDS A BACKEND (accounts/data): add_app_backend (installs the Fastify+SQLite API into server/ AND the typed client into src/api/); expo install @react-native-async-storage/async-storage; extend the real data model + matching client calls (keep validation/JWT/error-envelope); publish_app the backend; set API_BASE_URL in src/api/config.ts to the live URL; wire the screens via src/api. Deploy the backend to our infra (zero-config).',
      );
    } else {
      lines.push('No backend — seed local data (AsyncStorage); no network.');
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
      // Send BEFORE handing off so the runner has the brief on the first run.
      await api.sendMessage(session.id, brief());
      setActive(session.id);
      onClose(); // hand off to the session view — live progress + the APK appear there
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
          <p>A guided setup, then ArksAI builds the app (and its backend), checks it works, and hands back an APK you can install.</p>
        </div>
      </header>

      <div className="android-wizard">
        <label className="aw-field">
          <span className="aw-label">App name</span>
          <input className="aw-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Snap QR, Sparkmatch" maxLength={40} />
        </label>

        <label className="aw-field">
          <span className="aw-label">What should it do?</span>
          <textarea className="aw-input" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. A QR scanner that opens links and saves a history. Or: a dating app with a swipe deck, matches and chat." />
        </label>

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
          <span className="aw-label">Does it need accounts or saved data?</span>
          <div className="aw-segs">
            <button className={`aw-seg ${needsBackend ? 'on' : ''}`} onClick={() => setNeedsBackend(true)} type="button"><strong>Yes — add a backend</strong><span>login, sync, shared data</span></button>
            <button className={`aw-seg ${!needsBackend ? 'on' : ''}`} onClick={() => setNeedsBackend(false)} type="button"><strong>No</strong><span>local data only</span></button>
          </div>
          {needsBackend && <p className="aw-note">The backend deploys to our infra automatically (zero-config) — nothing for you to host.</p>}
        </div>

        <div className="aw-field">
          <span className="aw-label">Device features <em>(optional)</em></span>
          <div className="aw-chips">
            {FEATURES.map((f) => (
              <button key={f.id} className={`aw-chip ${features.includes(f.id) ? 'on' : ''}`} onClick={() => toggle(f.id)} type="button" title={f.hint}>{f.label}</button>
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

        {err && <p className="aw-err">{err}</p>}

        <div className="aw-actions">
          <button className="aw-build" onClick={build} disabled={!canBuild}>{busy ? 'Starting…' : 'Build my app'}</button>
          <p className="aw-time">
            {run === 'pwa'
              ? 'A web app is ready in a couple of minutes.'
              : 'Native builds take a few minutes (the app is compiled on a real build machine, then you get an APK). You can watch the progress live.'}
          </p>
        </div>
      </div>
    </div>
  );
}
