import { useEffect, useState } from 'react';
import type { MemoryEntry, SessionMeta } from '@shared/types';
import { api } from '../api/client';

export function MemoryDialog({ meta, onClose }: { meta: SessionMeta | null; onClose: () => void }) {
  const repoScope = meta?.repoName ?? null;
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [text, setText] = useState('');
  const [scope, setScope] = useState<string>('global');
  const [busy, setBusy] = useState(false);

  const refresh = () => api.listMemory(repoScope ?? undefined).then(setEntries).catch(() => {});
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoScope]);

  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.addMemory(scope, text.trim());
      setText('');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await api.deleteMemory(id);
    await refresh();
  };

  const global = entries.filter((e) => e.scope === 'global');
  const project = entries.filter((e) => e.scope !== 'global');

  const Section = ({ title, list }: { title: string; list: MemoryEntry[] }) => (
    <div>
      <label>{title}</label>
      <div className="mem-list">
        {list.length === 0 && <div className="muted" style={{ fontSize: 12.5, padding: '4px 2px' }}>Nothing yet.</div>}
        {list.map((e) => (
          <div key={e.id} className="mem-row">
            <span className="mem-text">{e.text}</span>
            <button className="del" onClick={() => remove(e.id)} title="Forget">
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <h2>Memory</h2>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 12.5 }}>
          ArksAI reads this at the start of every run. <b>Global</b> applies to all chats; <b>project</b> applies
          only to the connected repo.
        </p>

        <Section title="Global — every session" list={global} />
        {repoScope && <Section title={`Project — ${repoScope}`} list={project} />}

        <div className="mem-add">
          <textarea
            className="tmpl"
            rows={2}
            placeholder="e.g. I deploy on DigitalOcean and prefer Tailwind + shadcn."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="row" style={{ alignItems: 'center', gap: 10 }}>
            {repoScope && (
              <select value={scope} onChange={(e) => setScope(e.target.value)} style={{ maxWidth: 220 }}>
                <option value="global">Global (all chats)</option>
                <option value={repoScope}>Project ({repoScope})</option>
              </select>
            )}
            <span className="spacer" style={{ flex: 1 }} />
            <button className="cancel" onClick={onClose}>
              Close
            </button>
            <button className="send-btn" disabled={busy || !text.trim()} onClick={add}>
              Remember
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
