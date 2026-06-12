import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';

type Tab = 'preview' | 'files';

// Ports we recognise as dev servers, in priority order. The agent defaults its
// own apps to PORT=4000 (see server childEnv), so that wins; then the common
// Vite/Next/Flask/etc. defaults. This keeps the canvas from auto-loading
// sandbox-noise ports (e.g. 2024) that just happen to be the lowest number.
const DEV_PORTS = [4000, 5173, 5174, 3000, 3001, 8080, 8000, 5000, 4173, 8888, 9000];

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
  const loadPreview = (p?: string) => {
    const usePort = p ?? port;
    if (!usePort) return;
    setPort(usePort);
    setPreviewSrc(`/api/sessions/${sessionId}/preview/${usePort}/?_=${Date.now()}`);
  };

  // Auto-detect dev-server ports so the user doesn't have to guess.
  const detectPorts = async () => {
    try {
      const ports = await api.ports(sessionId);
      setDetectedPorts(orderPorts(ports));
      const pick = pickPreviewPort(ports);
      if (pick && !previewSrc) loadPreview(String(pick));
    } catch {
      setDetectedPorts([]);
    }
  };
  useEffect(() => {
    if (tab === 'preview') detectPorts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, sessionId]);

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

      {tab === 'preview' ? (
        previewSrc ? (
          <iframe key={nonce} className="canvas-frame" src={previewSrc} title="preview" />
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
