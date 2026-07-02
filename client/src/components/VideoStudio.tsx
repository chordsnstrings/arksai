import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';
import { VideoCard } from './VideoCard';

/**
 * "Video" — the dedicated full-page studio surface (Sidebar 🎬 / /video), mirroring Android/Robots.
 * It owns the text-to-video flow end to end: a brief composer on the left (scene + optional spoken
 * dialogue + look), model + format + duration controls, and a DRAFT-first ladder (a cheap 480p draft
 * you approve, then render final). Below sits the library of everything produced across recent
 * sessions — each a playable card with the same draft→final actions as in chat.
 *
 * Powered by Seedance (ArksAI Video 1.5 / 2.0) with native audio. Honest about timing: a draft is
 * ~1 min, a final a few minutes.
 */

type ModelChoice = 'auto' | 'arksai-video-15' | 'arksai-video-20';

const MODELS: { id: ModelChoice; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', hint: 'we pick the right one' },
  { id: 'arksai-video-15', label: 'ArksAI Video 1.5', hint: 'fast · draft mode · native audio' },
  { id: 'arksai-video-20', label: 'ArksAI Video 2.0', hint: 'highest fidelity · references' },
];

/** Aspect ratios → the platform they suit, mirroring how creatives are framed. */
const RATIOS: { id: string; label: string; hint: string; box: [number, number] }[] = [
  { id: '9:16', label: 'Vertical', hint: 'Reels · TikTok · Shorts', box: [15, 26] },
  { id: '16:9', label: 'Landscape', hint: 'YouTube · web · ads', box: [26, 15] },
  { id: '1:1', label: 'Square', hint: 'feed · grid', box: [20, 20] },
];

const DURATIONS = [4, 6, 8, 10];

const STYLES: { id: string; label: string; brief: string }[] = [
  { id: 'cinematic', label: 'Cinematic', brief: 'cinematic, shallow depth of field, filmic color, smooth camera move' },
  { id: 'product', label: 'Product', brief: 'clean product shot, soft studio light, slow rotating/tracking camera' },
  { id: 'ugc', label: 'UGC / handheld', brief: 'authentic handheld UGC look, natural light, casual energy' },
  { id: 'anime', label: 'Animated', brief: 'stylised animation, bold color, expressive motion' },
  { id: 'none', label: 'No preset', brief: '' },
];

export function VideoStudio({ onClose }: { onClose: () => void }) {
  const setActive = useStore((s) => s.setActive);
  const beginRun = useStore((s) => s.beginRun);
  const addUserMessage = useStore((s) => s.addUserMessage);
  const sessions = useStore((s) => s.sessions);

  const [scene, setScene] = useState('');
  const [dialogue, setDialogue] = useState('');
  const [model, setModel] = useState<ModelChoice>('auto');
  const [ratio, setRatio] = useState('9:16');
  const [duration, setDuration] = useState(8);
  const [style, setStyle] = useState('cinematic');
  const [audio, setAudio] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const canBuild = scene.trim().length > 5 && !busy;

  function brief(): string {
    const styleObj = STYLES.find((s) => s.id === style)!;
    const lines: string[] = [
      `Generate a ${duration}s ${RATIOS.find((r) => r.id === ratio)?.label.toLowerCase()} (${ratio}) video.`,
      `Scene: ${scene.trim()}`,
    ];
    if (styleObj.brief) lines.push(`Look: ${styleObj.brief}.`);
    if (dialogue.trim()) lines.push(`Spoken dialogue (say it verbatim, lip-synced): "${dialogue.trim()}"`);
    lines.push(audio ? 'Include native audio (ambience + any dialogue).' : 'No audio — silent clip.');
    if (model !== 'auto') lines.push(`Use ${MODELS.find((m) => m.id === model)?.label}.`);
    lines.push(
      '',
      'Make a DRAFT first (fast 480p) so I can approve the direction, then I\'ll ask for the final. Use the generate_video tool.',
    );
    return lines.join('\n');
  }

  async function build() {
    if (!canBuild) return;
    setBusy(true);
    setErr('');
    try {
      const session = await api.createSession({ mode: 'chat', task: 'marketing' });
      const msg = brief();
      addUserMessage(session.id, msg);
      beginRun(session.id);
      await api.sendMessage(session.id, msg);
      setActive(session.id);
      onClose(); // hand off to the session view — the draft + final appear there as playable cards
    } catch (e: any) {
      setErr(e?.message || 'Could not start the video.');
      setBusy(false);
    }
  }

  return (
    <div className="android-surface">
      <header className="android-top">
        <button className="android-back" onClick={onClose} aria-label="Back">←</button>
        <div className="android-masthead">
          <span className="android-eyebrow">VIDEO</span>
          <h1>Describe a shot. Get a real video.</h1>
          <p>Write the scene (and any spoken lines), pick the format, and ArksAI generates it with native audio — a quick draft first, then the polished final.</p>
        </div>
      </header>

      <div className="android-wizard">
        <div className="aw-step">1 · The shot</div>
        <label className="aw-field">
          <span className="aw-label">What happens in the video?</span>
          <textarea
            className="aw-input"
            rows={3}
            value={scene}
            onChange={(e) => setScene(e.target.value)}
            placeholder="e.g. A barista pours latte art in a sunlit café, slow push-in on the cup. Or: a sleek phone rotates on a pedestal, studio light sweeping across the glass."
          />
        </label>

        <label className="aw-field">
          <span className="aw-label">Spoken dialogue <em>(optional — it will be said out loud)</em></span>
          <input
            className="aw-input"
            value={dialogue}
            onChange={(e) => setDialogue(e.target.value)}
            placeholder='e.g. "Your morning, perfected."'
            maxLength={160}
          />
        </label>

        <div className="aw-field">
          <span className="aw-label">Look</span>
          <div className="aw-grid">
            {STYLES.map((s) => (
              <button key={s.id} className={`aw-card ${style === s.id ? 'on' : ''}`} onClick={() => setStyle(s.id)} type="button">
                <strong>{s.label}</strong>
              </button>
            ))}
          </div>
        </div>

        <div className="aw-step">2 · Format</div>
        <div className="aw-field">
          <span className="aw-label">Aspect ratio</span>
          <div className="aw-grid">
            {RATIOS.map((r) => (
              <button key={r.id} className={`aw-card ${ratio === r.id ? 'on' : ''}`} onClick={() => setRatio(r.id)} type="button">
                <span className="aw-kit-bar" style={{ alignItems: 'center' }}>
                  <i style={{ background: 'var(--accent)', width: r.box[0], height: r.box[1], borderRadius: 3 }} />
                </span>
                <strong>{r.label}</strong><span>{r.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="aw-field">
          <span className="aw-label">Duration</span>
          <div className="aw-segs">
            {DURATIONS.map((d) => (
              <button key={d} className={`aw-seg ${duration === d ? 'on' : ''}`} onClick={() => setDuration(d)} type="button">
                <strong>{d}s</strong>
              </button>
            ))}
          </div>
        </div>

        <div className="aw-field">
          <span className="aw-label">Model</span>
          <div className="aw-grid">
            {MODELS.map((m) => (
              <button key={m.id} className={`aw-card ${model === m.id ? 'on' : ''}`} onClick={() => setModel(m.id)} type="button">
                <strong>{m.label}</strong><span>{m.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="aw-field">
          <label className="aw-toggle">
            <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} />
            <span>Native audio (ambience + spoken dialogue)</span>
          </label>
        </div>

        {err && <p className="aw-err">{err}</p>}

        <div className="aw-actions">
          <button className="aw-build" onClick={build} disabled={!canBuild}>{busy ? 'Starting…' : 'Generate video'}</button>
          <p className="aw-time">A draft (480p) is about a minute; the final render takes a few minutes. You can watch progress live and get a playable card.</p>
        </div>

        <VideoLibrary sessions={sessions.map((s) => s.id)} onOpen={(id) => { setActive(id); onClose(); }} />
      </div>
    </div>
  );
}

type LibVideo = { sessionId: string; relPath: string; draft: boolean; ts: number };

/** The cross-session library — merges videos from the most recent sessions, newest first. */
function VideoLibrary({ sessions, onOpen }: { sessions: string[]; onOpen: (sessionId: string) => void }) {
  const [videos, setVideos] = useState<LibVideo[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    // Scan the 20 most recent sessions for produced videos (each request is cheap; 404s are ignored).
    const recent = sessions.slice(0, 20);
    Promise.all(
      recent.map((id) =>
        api
          .listVideos(id)
          .then((r) => r.videos.map((v) => ({ sessionId: id, relPath: v.path, draft: v.draft, ts: v.ts })))
          .catch(() => [] as LibVideo[]),
      ),
    ).then((lists) => {
      if (!alive) return;
      const all = lists.flat().sort((a, b) => b.ts - a.ts);
      setVideos(all);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [sessions.join(',')]);

  if (!loaded || videos.length === 0) {
    return (
      <div className="vs-library">
        <div className="aw-step">Your videos</div>
        <p className="aw-sub">{loaded ? 'Nothing yet — generate your first video above.' : 'Loading…'}</p>
      </div>
    );
  }

  return (
    <div className="vs-library">
      <div className="aw-step">Your videos <em style={{ fontWeight: 400, fontStyle: 'normal', color: 'var(--text-faint)' }}>· {videos.length}</em></div>
      <div className="vs-grid">
        {videos.map((v, i) => (
          <div key={v.sessionId + v.relPath + i} className="vs-item">
            <VideoCard sessionId={v.sessionId} relPath={v.relPath} draft={v.draft} />
            <button className="vs-open" onClick={() => onOpen(v.sessionId)} type="button">Open chat →</button>
          </div>
        ))}
      </div>
    </div>
  );
}
