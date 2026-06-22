import { useEffect, useState } from 'react';
import { type Article, loadArticle, loadIndex, formatDate } from '../lib/research';

// Cross-page links do a real navigation (not SPA push) so the server injects the right
// per-route <title>/description/OpenGraph + JSON-LD — ideal for SEO and link previews.
const go = (href: string) => () => {
  window.location.href = href;
};

function Nav({ onSignIn }: { onSignIn: () => void }) {
  return (
    <header className="lnd-nav">
      <button className="lp-mark" onClick={go('/')} style={{ background: 'none', border: 0, cursor: 'pointer' }}>
        <span className="logo-mark sm" /> ARKSAI · STUDIO
      </button>
      <div className="lnd-nav-actions">
        <button className="lnd-link" onClick={go('/features')}>
          Features
        </button>
        <button className="lnd-link" onClick={go('/research')}>
          Research
        </button>
        <button className="lnd-link" onClick={go('/#get-access')}>
          Request access
        </button>
        <button className="lnd-signin" onClick={onSignIn}>
          Sign in
        </button>
      </div>
    </header>
  );
}

function Foot() {
  return (
    <footer className="lnd-footer">
      <button className="lp-mark" onClick={go('/')} style={{ background: 'none', border: 0, cursor: 'pointer' }}>
        <span className="logo-mark sm" /> ARKSAI · STUDIO
      </button>
      <span className="lnd-foot-tag">Notes from the frontier — written for operators, not researchers.</span>
      <div style={{ display: 'flex', gap: 16 }}>
        <button className="lnd-link" onClick={go('/features')}>
          Features
        </button>
        <button className="lnd-link" onClick={go('/research')}>
          Research
        </button>
      </div>
    </footer>
  );
}

export function ResearchHub({ onSignIn }: { onSignIn: () => void }) {
  const [list, setList] = useState<Article[] | null>(null);
  useEffect(() => {
    loadIndex().then(setList);
  }, []);

  return (
    <div className="landing research">
      <Nav onSignIn={onSignIn} />
      <section className="rsh-head">
        <div className="lp-kicker">ArksAI Research</div>
        <h1 className="lnd-h1">
          The frontier, <em>read for operators.</em>
        </h1>
        <p className="lnd-lede">
          Where AI, energy and economics meet — written plainly for the people who run businesses, not the people who
          write the papers. Sourced, cited, and built to be useful.
        </p>
      </section>

      <section className="rsh-list">
        {list == null ? (
          <div className="rsh-loading">Loading…</div>
        ) : (
          list.map((a, i) => (
            <a key={a.slug} className="rsh-card" href={`/research/${a.slug}`}>
              <div className="rsh-card-no">{String(i + 1).padStart(2, '0')}</div>
              <div className="rsh-card-main">
                <div className="rsh-card-eyebrow">{(a.tags && a.tags[0]) || 'Essay'}</div>
                <h2 className="rsh-card-title">{a.title}</h2>
                <p className="rsh-card-dek">{a.dek}</p>
                <div className="rsh-card-meta">
                  <span>{formatDate(a.date)}</span>
                  <span className="rsh-dot">·</span>
                  <span>{a.readingTimeMin} min read</span>
                  <span className="rsh-dot">·</span>
                  <span>{a.sources.length} sources</span>
                </div>
              </div>
              <span className="rsh-card-arrow">→</span>
            </a>
          ))
        )}
      </section>

      <section className="lnd-section lnd-getaccess rsh-cta">
        <div className="lnd-form-copy" style={{ textAlign: 'center', margin: '0 auto' }}>
          <div className="lp-kicker">Founding access</div>
          <h2 className="lnd-h2">Put these ideas to work.</h2>
          <p className="lnd-lede">
            ArksAI turns a sentence into a finished, verified deliverable for every team in your company. Join the
            founding cohort.
          </p>
          <button className="lnd-primary" onClick={go('/#get-access')} style={{ marginTop: 6 }}>
            Apply for founding access →
          </button>
        </div>
      </section>

      <Foot />
    </div>
  );
}

export function ResearchArticle({ slug, onSignIn }: { slug: string; onSignIn: () => void }) {
  const [a, setA] = useState<Article | null | 'missing'>(null);
  useEffect(() => {
    loadArticle(slug).then((res) => setA(res ?? 'missing'));
  }, [slug]);

  if (a === 'missing') {
    if (typeof window !== 'undefined') window.location.href = '/research';
    return null;
  }

  return (
    <div className="landing research">
      <Nav onSignIn={onSignIn} />
      {a == null ? (
        <div className="rsh-loading" style={{ padding: '120px 0' }}>
          Loading…
        </div>
      ) : (
        <article className="art">
          <header className="art-head">
            <button className="art-back" onClick={go('/research')}>
              ← ArksAI Research
            </button>
            <div className="lp-kicker">{a.heroEyebrow || 'ArksAI Research'}</div>
            <h1 className="art-title">{a.title}</h1>
            <p className="art-dek">{a.dek}</p>
            <div className="art-meta">
              <span>{formatDate(a.date)}</span>
              <span className="rsh-dot">·</span>
              <span>{a.readingTimeMin} min read</span>
              {a.tags?.length ? (
                <span className="art-tags">
                  {a.tags.map((t) => (
                    <span key={t} className="art-tag">
                      {t}
                    </span>
                  ))}
                </span>
              ) : null}
            </div>
          </header>

          {a.keyTakeaways?.length ? (
            <aside className="art-takeaways">
              <div className="art-takeaways-label">The short version</div>
              <ul>
                {a.keyTakeaways.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </aside>
          ) : null}

          <div className="art-body">
            {a.sections.map((s, i) => (
              <section key={i} className="art-sec">
                {s.heading ? <h2>{s.heading}</h2> : null}
                {s.body.map((p, j) => (
                  <p key={j}>{p}</p>
                ))}
                {s.list?.length ? (
                  <ul className="art-list">
                    {s.list.map((li, j) => (
                      <li key={j}>{li}</li>
                    ))}
                  </ul>
                ) : null}
                {s.pull ? <blockquote className="art-pull">{s.pull}</blockquote> : null}
              </section>
            ))}
          </div>

          {a.sources?.length ? (
            <section className="art-sources">
              <h2>Sources</h2>
              <ol>
                {a.sources.map((src, i) => (
                  <li key={i}>
                    <a href={src.url} target="_blank" rel="noopener noreferrer nofollow">
                      {src.title}
                    </a>
                    {src.publisher ? <span className="art-src-pub"> — {src.publisher}</span> : null}
                    {src.note ? <span className="art-src-note"> · {src.note}</span> : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <section className="art-cta">
            <div className="lp-kicker">Founding access</div>
            <h2>From idea to finished deliverable.</h2>
            <p>
              ArksAI gives every team in your company an AI that turns a sentence into a verified, ready-to-use
              result — apps, dashboards, reports, decks, creatives, and UAE-compliant filings.
            </p>
            <button className="lnd-primary" onClick={go('/#get-access')}>
              Apply for founding access →
            </button>
          </section>
        </article>
      )}
      <Foot />
    </div>
  );
}
