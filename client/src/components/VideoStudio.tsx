import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';
import { VideoCard } from './VideoCard';
import { PresetIcon } from './VideoPresetIcon';

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
/** A staged image: the File + a preview object-URL. */
type Pick2 = { file: File; url: string };

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

// Duration options by model — the API's verified ranges: 1.5 = 4–12s, 2.0 = 4–15s.
// Auto assumes the 1.5 default (12s ceiling); picking 2.0 unlocks 15s.
const DURATIONS_BY_MODEL: Record<ModelChoice, number[]> = {
  auto: [4, 6, 8, 10, 12],
  'arksai-video-15': [4, 6, 8, 10, 12],
  'arksai-video-20': [4, 6, 8, 10, 12, 15],
};

const STYLES: { id: string; label: string; brief: string }[] = [
  { id: 'cinematic', label: 'Cinematic', brief: 'cinematic, shallow depth of field, filmic color, smooth camera move' },
  { id: 'product', label: 'Product', brief: 'clean product shot, soft studio light, slow rotating/tracking camera' },
  { id: 'ugc', label: 'UGC / handheld', brief: 'authentic handheld UGC look, natural light, casual energy' },
  { id: 'anime', label: 'Animated', brief: 'stylised animation, bold color, expressive motion' },
  { id: 'documentary', label: 'Documentary', brief: 'observational documentary realism, natural light, unstaged' },
  { id: 'vintage', label: 'Vintage film', brief: 'vintage 16mm film, warm faded tones, visible grain' },
  { id: 'noir', label: 'Noir B&W', brief: 'high-contrast black-and-white film noir, hard shadows' },
  { id: 'dreamy', label: 'Dreamy', brief: 'dreamy soft-focus, ethereal glow, gentle bloom' },
  { id: 'vibrant', label: 'Vibrant', brief: 'vibrant saturated bold color, high energy' },
  { id: 'luxury', label: 'Luxury', brief: 'luxury editorial, glossy premium finish, elegant' },
  { id: 'none', label: 'No preset', brief: '' },
];

// Camera-move presets — the 8 official Seedance moves + Auto. "Auto" lets the server prompt
// compiler pick the best single move for the subject (push-in for people, orbit for products,
// aerial for landscapes). Picking one injects that exact move so exactly ONE is ever directed.
const CAMERAS: { id: string; label: string; phrase: string }[] = [
  { id: 'auto', label: 'Auto', phrase: '' },
  { id: 'push', label: 'Push-in', phrase: 'slow push-in toward the subject' },
  { id: 'pull', label: 'Pull-out', phrase: 'slow pull-out revealing the wider scene' },
  { id: 'pan', label: 'Pan', phrase: 'smooth lateral pan' },
  { id: 'track', label: 'Tracking', phrase: 'tracking shot that follows the subject' },
  { id: 'orbit', label: 'Orbit', phrase: 'slow orbit around the subject' },
  { id: 'aerial', label: 'Aerial', phrase: 'aerial drone shot descending over the scene' },
  { id: 'craneup', label: 'Crane up', phrase: 'slow crane / boom up rising above the subject' },
  { id: 'cranedown', label: 'Crane down', phrase: 'slow crane / boom down toward the subject' },
  { id: 'zoom', label: 'Zoom in', phrase: 'slow lens zoom in' },
  { id: 'dollyzoom', label: 'Dolly zoom', phrase: 'dolly zoom (vertigo effect), background warps while the subject stays fixed' },
  { id: 'whip', label: 'Whip pan', phrase: 'fast whip pan with motion blur' },
  { id: 'fpv', label: 'FPV fly-through', phrase: 'dynamic FPV drone fly-through' },
  { id: 'handheld', label: 'Handheld', phrase: 'handheld with subtle natural shake' },
  { id: 'fixed', label: 'Fixed', phrase: 'fixed locked-off shot, no camera movement' },
];

// Lighting presets — the highest-impact lever. "Auto" defers to the compiler's tasteful default.
const LIGHTS: { id: string; label: string; phrase: string }[] = [
  { id: 'auto', label: 'Auto', phrase: '' },
  { id: 'golden', label: 'Golden hour', phrase: 'golden hour, warm directional light' },
  { id: 'bluehour', label: 'Blue hour', phrase: 'blue-hour twilight, cool ambient tones' },
  { id: 'daylight', label: 'Soft daylight', phrase: 'soft natural daylight, bright and even' },
  { id: 'hardsun', label: 'Hard sun', phrase: 'hard direct sunlight, crisp defined shadows' },
  { id: 'studio', label: 'Studio', phrase: 'clean studio softbox lighting, even and flattering' },
  { id: 'rim', label: 'Rim light', phrase: 'dramatic rim light on a dark background' },
  { id: 'spotlight', label: 'Spotlight', phrase: 'a single dramatic spotlight on the subject' },
  { id: 'neon', label: 'Neon', phrase: 'neon-lit with a colourful glow' },
  { id: 'backlit', label: 'Backlit', phrase: 'backlit with a soft glow halo' },
  { id: 'candle', label: 'Candlelight', phrase: 'warm flickering candlelight glow' },
  { id: 'overcast', label: 'Overcast', phrase: 'soft overcast diffused light' },
  { id: 'moody', label: 'Moody', phrase: 'moody low-key light with deep shadows' },
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
  const [camera, setCamera] = useState('auto');
  const [light, setLight] = useState('auto');
  const [audio, setAudio] = useState(true);
  // Image inputs (all optional): a start frame the clip opens on, an end frame it lands on
  // (start+end = a controlled transition), and reference images whose subject/style are kept.
  const [startFrame, setStartFrame] = useState<Pick2 | null>(null);
  const [endFrame, setEndFrame] = useState<Pick2 | null>(null);
  const [refs, setRefs] = useState<Pick2[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const canBuild = scene.trim().length > 5 && !busy;

  function brief(img: { startPath?: string; endPath?: string; refPaths: string[] }): string {
    const styleObj = STYLES.find((s) => s.id === style)!;
    const lines: string[] = [
      `Generate a ${duration}s ${RATIOS.find((r) => r.id === ratio)?.label.toLowerCase()} (${ratio}) video.`,
      `Scene: ${scene.trim()}`,
    ];
    if (styleObj.brief) lines.push(`Look: ${styleObj.brief}.`);
    const cam = CAMERAS.find((c) => c.id === camera)?.phrase;
    if (cam) lines.push(`Camera: ${cam} (one steady move).`);
    const lit = LIGHTS.find((l) => l.id === light)?.phrase;
    if (lit) lines.push(`Lighting: ${lit}.`);
    if (dialogue.trim()) lines.push(`Spoken dialogue (say it verbatim, lip-synced): "${dialogue.trim()}"`);
    lines.push(audio ? 'Include native audio (ambience + any dialogue).' : 'No audio — silent clip.');
    // Image inputs → explicit generate_video params.
    if (img.startPath) lines.push(`Start the video on this exact image — pass it as first_frame_image: ${img.startPath}`);
    if (img.endPath) lines.push(`End the video on this exact image — pass it as last_frame_image: ${img.endPath}${img.startPath ? ' (so it animates the start frame INTO the end frame).' : '.'}`);
    if (img.refPaths.length) {
      lines.push(`Keep the subject/style from these reference images consistent — pass them as reference_images: ${img.refPaths.join(', ')}`);
      if (model === 'auto') lines.push('Reference images work best on Video 2.0 — use it.');
    }
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
      // Upload any staged frames/references first so the runner + tool can resolve their paths.
      const up = async (p: Pick2 | null | Pick2[]): Promise<string[]> => {
        const list = Array.isArray(p) ? p : p ? [p] : [];
        if (!list.length) return [];
        const r = await api.uploadSessionFiles(session.id, list.map((x) => x.file));
        return r.files.map((f) => `uploads/${f.name}`);
      };
      const startPath = (await up(startFrame))[0];
      const endPath = (await up(endFrame))[0];
      const refPaths = await up(refs);
      const msg = brief({ startPath, endPath, refPaths });
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
          <span className="aw-label">Frames &amp; references <em>(optional — start on / end on a photo, or keep a subject consistent)</em></span>
          <div className="vs-frames">
            <FrameTile label="Start frame" hint="clip opens on this" pick={startFrame} onPick={(p) => setStartFrame(p)} />
            <FrameTile label="End frame" hint="clip lands on this" pick={endFrame} onPick={(p) => setEndFrame(p)} />
            <RefTile picks={refs} onChange={setRefs} />
          </div>
          {(startFrame || endFrame) && (
            <p className="aw-note">
              {startFrame && endFrame ? 'The video will animate from your start frame into your end frame.' : startFrame ? 'The video starts on your image and moves from there.' : 'The video builds toward your end frame.'}
            </p>
          )}
        </div>

        <div className="aw-step">2 · Direction <em style={{ fontWeight: 400, fontStyle: 'normal', color: 'var(--text-faint)' }}>· Auto is smart — override only if you want</em></div>
        <div className="aw-field">
          <span className="aw-label">Look</span>
          <div className="aw-grid">
            {STYLES.map((s) => (
              <button key={s.id} className={`aw-card ${style === s.id ? 'on' : ''}`} onClick={() => setStyle(s.id)} type="button">
                <span className="aw-card-head"><PresetIcon group="look" id={s.id} size={16} /><strong>{s.label}</strong></span>
              </button>
            ))}
          </div>
        </div>

        <div className="aw-field">
          <span className="aw-label">Camera move <em>(one steady move — the pro rule)</em></span>
          <div className="aw-chips">
            {CAMERAS.map((c) => (
              <button key={c.id} className={`aw-chip ${camera === c.id ? 'on' : ''}`} onClick={() => setCamera(c.id)} type="button">
                <PresetIcon group="camera" id={c.id} /> {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="aw-field">
          <span className="aw-label">Lighting</span>
          <div className="aw-chips">
            {LIGHTS.map((l) => (
              <button key={l.id} className={`aw-chip ${light === l.id ? 'on' : ''}`} onClick={() => setLight(l.id)} type="button">
                <PresetIcon group="light" id={l.id} /> {l.label}
              </button>
            ))}
          </div>
        </div>

        <div className="aw-step">3 · Format</div>
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
            {DURATIONS_BY_MODEL[model].map((d) => (
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
              <button
                key={m.id}
                className={`aw-card ${model === m.id ? 'on' : ''}`}
                onClick={() => {
                  setModel(m.id);
                  const allowed = DURATIONS_BY_MODEL[m.id];
                  if (!allowed.includes(duration)) setDuration(Math.min(...allowed.filter((d) => d >= duration).concat(allowed[allowed.length - 1])));
                }}
                type="button"
              >
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

/** A single-image drop tile (Start / End frame). Shows a thumbnail once picked, with a remove ×. */
function FrameTile({ label, hint, pick, onPick }: { label: string; hint: string; pick: Pick2 | null; onPick: (p: Pick2 | null) => void }) {
  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (pick) URL.revokeObjectURL(pick.url);
    onPick({ file: f, url: URL.createObjectURL(f) });
  };
  return (
    <div className="vs-frame">
      <span className="vs-frame-label">{label}</span>
      {pick ? (
        <div className="vs-frame-box has">
          <img src={pick.url} alt={label} />
          <button className="vs-frame-x" type="button" onClick={() => { URL.revokeObjectURL(pick.url); onPick(null); }} aria-label="Remove">×</button>
        </div>
      ) : (
        <label className="vs-frame-box">
          <input type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          <span className="vs-frame-plus">+</span>
          <span className="vs-frame-hint">{hint}</span>
        </label>
      )}
    </div>
  );
}

/** Multi-image reference tile — up to 4 subject/style references. */
function RefTile({ picks, onChange }: { picks: Pick2[]; onChange: (p: Pick2[]) => void }) {
  const add = (files: FileList | null) => {
    if (!files) return;
    const room = 4 - picks.length;
    const next = Array.from(files).slice(0, room).map((f) => ({ file: f, url: URL.createObjectURL(f) }));
    onChange([...picks, ...next]);
  };
  const remove = (i: number) => {
    URL.revokeObjectURL(picks[i].url);
    onChange(picks.filter((_, j) => j !== i));
  };
  return (
    <div className="vs-frame vs-frame-refs">
      <span className="vs-frame-label">References <em>(up to 4)</em></span>
      <div className="vs-refs-row">
        {picks.map((p, i) => (
          <div key={i} className="vs-frame-box has sm">
            <img src={p.url} alt={`Reference ${i + 1}`} />
            <button className="vs-frame-x" type="button" onClick={() => remove(i)} aria-label="Remove">×</button>
          </div>
        ))}
        {picks.length < 4 && (
          <label className="vs-frame-box sm">
            <input type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />
            <span className="vs-frame-plus">+</span>
          </label>
        )}
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
