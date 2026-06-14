import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';

type Tab = 'preview' | 'files' | 'doc';

// Ports we recognise as dev servers, in priority order. The agent defaults its
// own apps to PORT=4000 (see server childEnv), so that wins; then the common
// Vite/Next/Flask/etc. defaults. This keeps the canvas from auto-loading
// sandbox-noise ports (e.g. 2024) that just happen to be the lowest number.
const DEV_PORTS = [4000, 5173, 5174, 3000, 3001, 4200, 8080, 8000, 5000, 4173, 8888, 9000];

function pickPreviewPort(ports: number[]): number | undefined {
  for (const p of DEV_PORTS) if (ports.includes(p)) return p;
  // No well-known dev port: only auto-pick if there's a single plausible
  // app-range port. Otherwise let the user choose to avoid loading noise.
  const candidates = ports.filter((p) => p >= 3000 && p <= 9999);
  if (candidates.length === 1) return candidates[0];
  return undefined;
}

// Show recognised dev ports first, then the rest ascending.
function orderPorts(ports: number[]): number[] {
  return [...ports].sort((a, b) => {
    const ai = DEV_PORTS.indexOf(a);
    const bi = DEV_PORTS.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a - b;
  });
}

const TEXT_EXT = /\.(txt|md|json|js|jsx|ts|tsx|css|html|py|go|rs|java|rb|sh|yml|yaml|toml|sql|env|csv|xml|c|cpp|h)$/i;
const IMG_EXT = /\.(png|jpe?g|gif|svg|webp|avif)$/i;
const PDF_EXT = /\.pdf$/i;

export function Canvas({ sessionId }: { sessionId: string }) {
  const toggleCanvas = useStore((s) => s.toggleCanvas);
  const [tab, setTab] = useState<Tab>('preview');

  // preview
  const [port, setPort] = useState('');
  const [detectedPorts, setDetectedPorts] = useState<number[]>([]);
  const [previewSrc, setPreviewSrc] = useState('');
  const [nonce, setNonce] = useState(0);
  // Delivery-moment loading states: while booting we show a confident spinner,
  // not a blank iframe; if the boot genuinely never comes up, a friendly retry.
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [booting, setBooting] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  // Mirror previewSrc in a ref so the poll loop sees the latest value (and a
  // manual port pick) without re-subscribing the effect.
  const previewSrcRef = useRef('');
  useEffect(() => {
    previewSrcRef.current = previewSrc;
  }, [previewSrc]);

  const loadPreview = (p?: string) => {
    const usePort = p ?? port;
    if (!usePort) return;
    setPort(usePort);
    setPreviewLoaded(false);
    setPreviewFailed(false);
    previewSrcRef.current = `loading:${usePort}`;
    setPreviewSrc(`/api/sessions/${sessionId}/preview/${usePort}/?_=${Date.now()}`);
  };

  const retryPreview = () => {
    setPreviewFailed(false);
    setBooting(true);
    previewSrcRef.current = '';
    setPreviewSrc('');
    setNonce((n) => n + 1);
    detectPorts();
  };

  // Auto-detect dev-server ports so the user doesn't have to guess. A preview
  // server started on run-completion may still be binding when the canvas
  // opens, so poll a few times until a recognised port shows up.
  const currentPort = (): number | null => {
    const m = previewSrcRef.current.match(/\/preview\/(\d+)\//);
    return m ? Number(m[1]) : null;
  };
  const detectPorts = async () => {
    try {
      const ports = await api.ports(sessionId);
      setDetectedPorts(orderPorts(ports));
      // If what we're previewing is no longer listening (the app moved ports,
      // e.g. 4200 → 4000, or was restarted), drop the dead iframe and re-pick
      // instead of leaving the user staring at a broken page.
      const cur = currentPort();
      if (cur && !ports.includes(cur)) {
        previewSrcRef.current = '';
        setPreviewSrc('');
      }
      const pick = pickPreviewPort(ports);
      if (pick && !previewSrcRef.current) loadPreview(String(pick));
      return !!previewSrcRef.current;
    } catch {
      setDetectedPorts([]);
      return false;
    }
  };
  useEffect(() => {
    if (tab !== 'preview') return;
    let cancelled = false;
    let tries = 0;
    const MAX_TRIES = 12; // ~15s — a freshly-built app may still be binding its port
    const tick = async () => {
      if (cancelled || previewSrcRef.current) return;
      const found = await detectPorts();
      if (cancelled || found || previewSrcRef.current) return;
      if (++tries < MAX_TRIES) setTimeout(tick, 1200);
      else if (booting) {
        // It never came up — surface a friendly retry instead of a silent blank.
        setBooting(false);
        setPreviewFailed(true);
      }
    };
    tick();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, sessionId, nonce]);

  // files
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [fileText, setFileText] = useState<string>('');

  const refreshFiles = () => api.tree(sessionId).then((r) => setFiles(r.files)).catch(() => setFiles([]));
  useEffect(() => {
    if (tab === 'files') refreshFiles();
  }, [tab, sessionId]);

  const openFile = async (path: string) => {
    setSelected(path);
    setFileText('');
    if (TEXT_EXT.test(path) || !IMG_EXT.test(path) && !PDF_EXT.test(path)) {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/files/${path.split('/').map(encodeURIComponent).join('/')}?inline=1`, {
          credentials: 'same-origin',
        });
        setFileText(await res.text());
      } catch {
        setFileText('(could not read file)');
      }
    }
  };

  const rawUrl = (path: string) =>
    `/api/sessions/${sessionId}/files/${path.split('/').map(encodeURIComponent).join('/')}?inline=1`;

  // Auto-load the finished artifact when a run completes (open_canvas event):
  // an app preview (exact port), or a document (PDF / spreadsheet / doc).
  const canvasTarget = useStore((s) => s.canvasTarget);
  const [docSrc, setDocSrc] = useState('');
  const [docName, setDocName] = useState('');
  const [docLoaded, setDocLoaded] = useState(false);
  useEffect(() => {
    if (!canvasTarget) return;
    const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');
    if (canvasTarget.kind === 'app' || canvasTarget.port) {
      setDocSrc('');
      setTab('preview');
      // We're expecting a freshly-built app — show the "Booting…" state until the
      // preview iframe actually loads, rather than a bare blank.
      setBooting(true);
      setPreviewFailed(false);
      if (canvasTarget.port) loadPreview(String(canvasTarget.port));
    } else if (canvasTarget.file) {
      const f = canvasTarget.file;
      const base =
        canvasTarget.kind === 'pdf'
          ? `/api/sessions/${sessionId}/files/${enc(f)}?inline=1`
          : `/api/sessions/${sessionId}/docview/${enc(f)}`;
      setDocName(f.split('/').pop() || f);
      setDocLoaded(false);
      setDocSrc(`${base}${base.includes('?') ? '&' : '?'}_=${Date.now()}`);
      setTab('doc');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasTarget?.at]);

  return (
    <div className="canvas">
      <div className="canvas-head">
        <div className="canvas-tabs">
          <button className={tab === 'preview' ? 'on' : ''} onClick={() => setTab('preview')}>
            Preview
          </button>
          <button className={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}>
            Files
          </button>
          {docSrc && (
            <button className={tab === 'doc' ? 'on' : ''} onClick={() => setTab('doc')} title={docName}>
              📄 {docName.length > 18 ? docName.slice(0, 16) + '…' : docName}
            </button>
          )}
        </div>
        <span className="spacer" />
        {tab === 'preview' && (
          <>
            {detectedPorts.map((p) => (
              <button
                key={p}
                className={`canvas-btn port ${String(p) === port ? 'on' : ''}`}
                onClick={() => loadPreview(String(p))}
              >
                :{p}
              </button>
            ))}
            <input
              className="canvas-port"
              placeholder="port"
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && loadPreview()}
            />
            <button className="canvas-btn" onClick={() => loadPreview()}>
              Load
            </button>
            <button className="canvas-btn" onClick={() => { detectPorts(); setNonce((n) => n + 1); }} title="Refresh">
              ↻
            </button>
          </>
        )}
        {tab === 'files' && (
          <button className="canvas-btn" onClick={refreshFiles}>
            ↻
          </button>
        )}
        <button className="canvas-btn" onClick={() => toggleCanvas(false)} title="Close">
          ✕
        </button>
      </div>

      {tab === 'doc' ? (
        docSrc ? (
          <div className="canvas-host">
            <iframe
              className="canvas-frame"
              src={docSrc}
              title={docName || 'document'}
              onLoad={() => setDocLoaded(true)}
            />
            {!docLoaded && (
              <div className="canvas-loading">
                <span className="spinner" /> Opening your {docName ? `“${docName}”` : 'document'}…
              </div>
            )}
          </div>
        ) : (
          <div className="canvas-empty">No document loaded yet.</div>
        )
      ) : tab === 'preview' ? (
        previewSrc ? (
          <div className="canvas-host">
            <iframe
              key={nonce}
              className="canvas-frame"
              src={previewSrc}
              title="preview"
              onLoad={() => {
                setPreviewLoaded(true);
                setBooting(false);
                setPreviewFailed(false);
              }}
            />
            {!previewLoaded && (
              <div className="canvas-loading">
                <span className="spinner" /> Booting your live app…
              </div>
            )}
          </div>
        ) : booting ? (
          <div className="canvas-loading big">
            <span className="spinner" /> Booting your live app…
          </div>
        ) : previewFailed ? (
          <div className="canvas-empty">
            Couldn’t load the preview just yet.
            <br />
            <button className="canvas-btn" style={{ marginTop: 10 }} onClick={retryPreview}>
              ↻ Retry
            </button>{' '}
            or open the <b>Files</b> tab to browse the result.
          </div>
        ) : (
          <div className="canvas-empty">
            {detectedPorts.length === 0 ? (
              <>
                No running dev server detected.
                <br />
                Ask the agent to start one in the background (e.g. "run the dev server"), then press ↻.
              </>
            ) : (
              <>Pick a detected port above, or type one and press <b>Load</b>.</>
            )}
          </div>
        )
      ) : (
        <div className="canvas-files">
          <div className="canvas-tree">
            {files.length === 0 && <div className="muted">No files yet.</div>}
            {files.map((f) => (
              <button key={f} className={`tree-item ${selected === f ? 'on' : ''}`} onClick={() => openFile(f)}>
                {f}
              </button>
            ))}
          </div>
          <div className="canvas-view">
            {!selected && <div className="muted">Select a file.</div>}
            {selected && IMG_EXT.test(selected) && <img className="canvas-img" src={rawUrl(selected)} alt={selected} />}
            {selected && PDF_EXT.test(selected) && <iframe className="canvas-frame" src={rawUrl(selected)} title={selected} />}
            {selected && !IMG_EXT.test(selected) && !PDF_EXT.test(selected) && <pre className="canvas-code">{fileText}</pre>}
          </div>
        </div>
      )}
    </div>
  );
}
