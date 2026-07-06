import { api } from '../api/client';
import { useStore } from '../state/sessionStore';

/** Send a prefilled chat message, showing the run as live optimistically (same as PlanApprovalCard). */
function sendPrefilled(sessionId: string, msg: string) {
  const st = useStore.getState();
  st.addUserMessage(sessionId, msg);
  st.beginRun(sessionId);
  api.sendMessage(sessionId, msg).catch(() => {
    /* the optimistic running state clears on the next event */
  });
}

/**
 * In-chat video player card. Appears in the timeline when a run produced a video in videos/.
 * A DRAFT card offers "Render final" + "Tweak" (the draft→final ladder, made clickable); a
 * FINAL card offers Download. Buttons send a prefilled chat message (same pattern as the
 * completion card), so the agent continues the flow with no typing.
 */
export function VideoCard({ sessionId, relPath, draft, label }: { sessionId: string; relPath: string; draft: boolean; label?: string }) {
  const src = api.fileUrl(sessionId, relPath);
  const vertical = /9[:x]16|-9x16|reel|vertical/i.test(relPath + (label ?? ''));

  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 14,
        overflow: 'hidden',
        background: 'var(--surface)',
        maxWidth: vertical ? 300 : 460,
        boxShadow: '0 1px 2px rgba(20,20,18,.05), 0 8px 22px rgba(20,20,18,.07)',
      }}
    >
      <div style={{ position: 'relative', background: '#000' }}>
        <video
          src={src}
          controls
          playsInline
          preload="metadata"
          style={{ display: 'block', width: '100%', maxHeight: vertical ? 460 : 300, background: '#000' }}
        />
        <span
          style={{
            position: 'absolute', top: 8, left: 8, fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em',
            textTransform: 'uppercase', padding: '3px 8px', borderRadius: 20,
            background: draft ? 'rgba(20,20,18,.72)' : 'var(--accent)', color: '#fff',
          }}
        >
          {draft ? '● Draft (480p)' : '★ Final'}
        </span>
      </div>
      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {label && <div style={{ fontSize: 12.5, fontWeight: 600, flex: 1, minWidth: 120 }}>{label}</div>}
        {draft ? (
          <>
            <button
              className="send-btn"
              onClick={() => sendPrefilled(sessionId, `Render the final 1080p version of that video draft (${relPath}).`)}
            >
              Render final
            </button>
            <button
              className="ghost-btn"
              onClick={() => sendPrefilled(sessionId, 'Tweak that video draft: ')}
              title="Send an adjustment (pacing / camera / style / audio)"
            >
              Tweak
            </button>
          </>
        ) : (
          <a className="ghost-btn" href={api.fileUrl(sessionId, relPath).replace('?inline=1', '')} download style={{ textDecoration: 'none' }}>
            Download
          </a>
        )}
      </div>
    </div>
  );
}

/** Detect a produced video from a tool-result string; returns the card props or null. */
export function videoFromToolOutput(text: string): { relPath: string; draft: boolean; label?: string } | null {
  // Note the / in the class: motion/story outputs live in nested dirs (videos/motion-<id>/<subject>-final.mp4).
  const m = /videos\/[\w./\-]+\.(?:mp4|webm|mov)/i.exec(text || '');
  if (!m) return null;
  const relPath = m[0];
  const draft = /-draft\.[a-z0-9]+/i.test(relPath) || /\bdraft\b/i.test(text);
  return { relPath, draft };
}
