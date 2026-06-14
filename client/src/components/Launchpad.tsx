import { useState } from 'react';
import { AUTO_MODEL } from '@shared/types';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';

/** Curated, click-to-fill starting points so a newcomer never faces a blank box. */
const EXAMPLES = [
  {
    emoji: '🎨',
    title: 'A personal portfolio site',
    prompt: 'Build me a clean, modern personal portfolio website with an about section, a projects grid, and a contact form.',
  },
  {
    emoji: '✅',
    title: 'A habit-tracker web app',
    prompt: 'Build a habit-tracker web app where I can add daily habits, check them off, and see my weekly streak.',
  },
  {
    emoji: '📊',
    title: 'Turn data into a polished report',
    prompt: 'Turn my data into a polished, presentation-ready PDF report with charts and the key takeaways.',
  },
  {
    emoji: '💰',
    title: 'A budgeting spreadsheet',
    prompt: 'Create a budgeting spreadsheet with monthly income, categorized expenses, and a summary of what’s left over.',
  },
];

export function Launchpad({ onAdvanced }: { onAdvanced: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const upsertSession = useStore((s) => s.upsertSession);
  const setActive = useStore((s) => s.setActive);

  const go = async (value?: string) => {
    const prompt = (value ?? text).trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError('');
    try {
      // Smart defaults: code mode + ArksAI Auto (the orchestrator picks the best
      // engine per task). Send BEFORE activating so the loaded timeline already
      // contains the first message — no create/load race.
      const session = await api.createSession({ mode: 'code', model: AUTO_MODEL });
      await api.sendMessage(session.id, prompt);
      upsertSession(session);
      setActive(session.id);
    } catch (e: any) {
      setError(e?.message ?? 'Could not start — please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="launchpad">
      <div className="launchpad-inner">
        <div className="logo-mark" />
        <h1 className="launchpad-title">Describe what you want.</h1>
        <p className="launchpad-sub">
          Get one finished thing that looks perfect, works perfectly, and is ready to use.
        </p>

        <div className="launchpad-box">
          <textarea
            value={text}
            autoFocus
            placeholder="e.g. a website for my bakery with a menu and an order form"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void go();
              }
            }}
            disabled={busy}
          />
          <button className="launchpad-go" onClick={() => void go()} disabled={busy || !text.trim()}>
            {busy ? 'Starting…' : 'Make it →'}
          </button>
        </div>
        {error && <div className="launchpad-error">{error}</div>}

        <div className="launchpad-examples">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.title}
              className="example-card"
              onClick={() => setText(ex.prompt)}
              disabled={busy}
              title="Click to use this idea"
            >
              <span className="ex-emoji">{ex.emoji}</span>
              <span className="ex-title">{ex.title}</span>
            </button>
          ))}
        </div>

        <button className="launchpad-advanced" onClick={onAdvanced} disabled={busy}>
          Connect a GitHub repo or choose a mode →
        </button>
      </div>
    </div>
  );
}
