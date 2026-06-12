import { useEffect, useState } from 'react';
import type { CustomCommand } from '@shared/types';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';

export function CommandsDialog({ onClose }: { onClose: () => void }) {
  const commands = useStore((s) => s.commands);
  const setCommands = useStore((s) => s.setCommands);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [template, setTemplate] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.listCommands().then(setCommands).catch(() => {});
  }, [setCommands]);

  const edit = (c: CustomCommand) => {
    setName(c.name);
    setDescription(c.description);
    setTemplate(c.template);
    setError('');
  };

  const reset = () => {
    setName('');
    setDescription('');
    setTemplate('');
    setError('');
  };

  const save = async () => {
    setError('');
    try {
      await api.putCommand(name.trim().toLowerCase(), description, template);
      setCommands(await api.listCommands());
      reset();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save');
    }
  };

  const remove = async (n: string) => {
    await api.deleteCommand(n);
    setCommands(await api.listCommands());
    if (name === n) reset();
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <h2>Custom commands</h2>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 12.5 }}>
          Saved prompt templates. Use <code>$ARGUMENTS</code> for everything after the command, or{' '}
          <code>$1</code>, <code>$2</code> for positional args. Run them from the <code>/</code> menu.
        </p>

        {commands.length > 0 && (
          <div className="cmd-saved">
            {commands.map((c) => (
              <div key={c.name} className="cmd-saved-row">
                <button className="link" onClick={() => edit(c)}>
                  /{c.name}
                </button>
                <span className="muted">{c.description}</span>
                <button className="del" onClick={() => remove(c.name)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="row">
          <div style={{ flex: '0 0 160px' }}>
            <label>Name</label>
            <input placeholder="review" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label>Description</label>
            <input
              placeholder="Review the current diff"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label>Template</label>
          <textarea
            className="tmpl"
            rows={5}
            placeholder={'Do a security + quality review of the current git diff. $ARGUMENTS'}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          />
        </div>
        {error && <div style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div>}
        <div className="actions">
          {name && (
            <button className="cancel" onClick={reset}>
              New
            </button>
          )}
          <button className="cancel" onClick={onClose}>
            Close
          </button>
          <button className="send-btn" disabled={!name.trim() || !template.trim()} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
