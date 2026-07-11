import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';

/**
 * Campaign bot brief — the "tell it exactly what you want" form. Every field maps 1:1 to a
 * `social_campaigns.brief` field the autonomous engine consumes: outcome (goal), destination,
 * audience, budget + duration, creative-pool size (with a live generation-cost estimate), the
 * per-campaign reply instructions (what Loop 2 injects into ad-originated comments/DMs), and the
 * launch decision (autopilot within caps vs ask first).
 *
 * THE BRAIN LINE: as the user types, the engine classifies the business, prices the outcome
 * for the SELECTED COUNTRIES (never US numbers for a UAE audience), prefers the account's own
 * past results over any industry estimate, and translates it all into their budget ("expect
 * roughly 4–10 leads"). One tap fixes a wrong detection; the target price is pre-suggested
 * and becomes the optimizer's North Star.
 */

const GOALS = [
  { id: 'leads', label: 'Leads', blurb: 'Collect names + numbers with an Instant Form (no website needed).' },
  { id: 'messages', label: 'Messages', blurb: 'Start chats — replies are answered by this robot, ad-aware.' },
  { id: 'traffic', label: 'Website visits', blurb: 'Send people to your site.' },
  { id: 'sales', label: 'Sales', blurb: 'Needs a Meta Pixel on your site — runs as traffic/leads until then.' },
] as const;

/** Common ad markets for the location chips (GCC-first — the operator's audience). */
const MARKETS: { code: string; label: string }[] = [
  { code: 'AE', label: 'UAE' }, { code: 'SA', label: 'Saudi Arabia' }, { code: 'QA', label: 'Qatar' },
  { code: 'KW', label: 'Kuwait' }, { code: 'BH', label: 'Bahrain' }, { code: 'OM', label: 'Oman' },
  { code: 'EG', label: 'Egypt' }, { code: 'IN', label: 'India' }, { code: 'PK', label: 'Pakistan' },
  { code: 'GB', label: 'UK' }, { code: 'US', label: 'USA' },
];

/** Plain-named business types for the "Not right?" corrector (mirrors verticals.ts). */
const VERTICAL_CHOICES: { id: string; label: string }[] = [
  { id: 'restaurant', label: 'Restaurant / café' }, { id: 'dental', label: 'Dental clinic' },
  { id: 'clinic', label: 'Health clinic' }, { id: 'fitness', label: 'Fitness / gym' },
  { id: 'beauty', label: 'Beauty & salon' }, { id: 'realestate', label: 'Real estate' },
  { id: 'legal', label: 'Legal services' }, { id: 'education', label: 'Education / courses' },
  { id: 'homeservices', label: 'Home services' }, { id: 'ecom_fashion', label: 'Clothing & fashion shop' },
  { id: 'ecom_other', label: 'Online store (other)' }, { id: 'generic', label: 'Something else' },
];

type Preview = Awaited<ReturnType<typeof api.classifyCampaignPreview>>;

const RESULT_NOUN: Record<string, [string, string]> = { lead: ['lead', 'leads'], sale: ['sale', 'sales'], click: ['visit', 'visits'] };

// Mirror of the server's estimate: 1 background composites 3 headline variants ≈ $0.09/background.
const genEstimate = (images: number) => Math.round(Math.ceil(Math.max(0, images) / 3) * 0.09 * 100) / 100;

export function CampaignBrief({ orgId, robotId, dailyCapUsd, defaultVertical, onStarted, onCancel }: {
  orgId: string;
  robotId: string;
  dailyCapUsd: number;
  /** The robot's remembered business type (set on first confirmed campaign). */
  defaultVertical?: string;
  onStarted: () => void;
  onCancel?: () => void;
}) {
  const [product, setProduct] = useState('');
  const [name, setName] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const [topicDraft, setTopicDraft] = useState('');
  const [goal, setGoal] = useState<(typeof GOALS)[number]['id']>('leads');
  const [destination, setDestination] = useState('');
  const [dmSurface, setDmSurface] = useState<'messenger' | 'instagram_direct'>('messenger');
  const [cta, setCta] = useState('');
  const [countries, setCountries] = useState<string[]>(['AE']);
  const [countryDraft, setCountryDraft] = useState('');
  const [showCountryOther, setShowCountryOther] = useState(false);
  const [ageMin, setAgeMin] = useState('18');
  const [ageMax, setAgeMax] = useState('65');
  const [broad, setBroad] = useState(true);
  const [budgetModel, setBudgetModel] = useState<'daily' | 'lifetime'>('daily');
  const [budget, setBudget] = useState('10');
  const [days, setDays] = useState('14');
  const [images, setImages] = useState('30');
  const [say, setSay] = useState('');
  const [doNotSay, setDoNotSay] = useState('');
  const [escalateIf, setEscalateIf] = useState('');
  const [autoLaunch, setAutoLaunch] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // The brain line: detected business type + country-priced expectations + target suggestion.
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [verticalOverride, setVerticalOverride] = useState<string | null>(defaultVertical ?? null);
  const [showCorrector, setShowCorrector] = useState(false);
  const [target, setTarget] = useState(''); // user-set target cost per result (USD)
  const [targetTouched, setTargetTouched] = useState(false);
  const previewSeq = useRef(0);

  useEffect(() => {
    const text = `${product} ${topics.join(' ')}`.trim();
    if (text.length < 8) { setPreview(null); return; }
    const seq = ++previewSeq.current;
    setPreviewBusy(true);
    const t = setTimeout(() => {
      api.classifyCampaignPreview(orgId, robotId, {
        product, topics, countries,
        vertical_override: verticalOverride ?? undefined,
        target_cpr_usd: Number(target) > 0 ? Number(target) : undefined,
      }).then((p) => {
        if (seq !== previewSeq.current) return;
        setPreview(p);
        // Pre-suggest the target once (own history → country-adjusted midpoint); edits stick.
        if (!targetTouched && p.suggestedTargetUsd) setTarget(String(p.suggestedTargetUsd));
      }).catch(() => {}).finally(() => { if (seq === previewSeq.current) setPreviewBusy(false); });
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, topics.join('|'), countries.join('|'), verticalOverride, target, orgId, robotId]);

  const budgetN = Number(budget) || 0;
  const daysN = Math.max(1, Number(days) || 1);
  const perDay = budgetModel === 'daily' ? budgetN : budgetN / daysN;
  const total = budgetModel === 'daily' ? budgetN * daysN : budgetN;
  const overCap = dailyCapUsd > 0 && perDay > dailyCapUsd;
  const genCost = useMemo(() => genEstimate(Number(images) || 0), [images]);
  const needsUrl = goal === 'traffic' || goal === 'sales';

  // Expected results from the country-adjusted band, translated into THEIR budget.
  const expected = useMemo(() => {
    const b = preview?.benchmark;
    if (!b || total <= 0) return null;
    const lo = Math.floor(total / b.highUsd);
    const hi = Math.max(1, Math.ceil(total / b.lowUsd));
    return { lo, hi, noun: RESULT_NOUN[b.metric] ?? RESULT_NOUN.lead };
  }, [preview, total]);

  const addTopic = () => {
    const t = topicDraft.trim();
    if (t && !topics.includes(t)) setTopics((ts) => [...ts, t]);
    setTopicDraft('');
  };
  const toggleCountry = (code: string) =>
    setCountries((cs) => (cs.includes(code) ? cs.filter((c) => c !== code) : [...cs, code]));
  const addCustomCountry = () => {
    const c = countryDraft.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(c) && !countries.includes(c)) setCountries((cs) => [...cs, c]);
    setCountryDraft('');
    setShowCountryOther(false);
  };

  const launch = async () => {
    setErr(null);
    if (!product.trim()) return setErr('Say what you are promoting.');
    if (needsUrl && !/^https?:\/\//.test(destination.trim())) return setErr('This goal needs a website URL (https://…).');
    if (!(budgetN > 0)) return setErr('Set a positive budget.');
    if (!countries.length) return setErr('Pick at least one country to run the ads in.');
    if (overCap) return setErr(`That works out to $${perDay.toFixed(2)}/day — over the robot's $${dailyCapUsd}/day cap. Raise the cap in Settings or lower the budget.`);
    setBusy(true);
    try {
      await api.createSocialCampaign(orgId, robotId, {
        name: name.trim() || product.trim().slice(0, 60),
        product: product.trim(),
        topics,
        objective: goal,
        destination: goal === 'messages' ? dmSurface : needsUrl ? destination.trim() : undefined,
        cta: cta.trim() || undefined,
        audience: {
          countries,
          ageMin: Number(ageMin) || 18,
          ageMax: Number(ageMax) || 65,
          broad,
        },
        budget_model: budgetModel,
        budget_usd: budgetN,
        duration_days: budgetModel === 'lifetime' ? daysN : Number(days) || undefined,
        image_count: Number(images) || 30,
        engage_say: say.trim() || undefined,
        engage_do_not_say: doNotSay.trim() || undefined,
        engage_escalate_if: escalateIf.trim() || undefined,
        autonomy_level: autoLaunch ? 85 : 30,
        vertical: preview?.verticalId ?? verticalOverride ?? undefined,
        target_cpr_usd: Number(target) > 0 ? Number(target) : undefined,
      });
      onStarted();
    } catch (e: any) {
      setErr(e?.message || 'Could not start the campaign.');
    } finally {
      setBusy(false);
    }
  };

  // The brain line, assembled in plain sentences (never jargon, never scary).
  const brainLine = () => {
    if (!preview) return null;
    const b = preview.benchmark;
    const noun = b ? (RESULT_NOUN[b.metric] ?? RESULT_NOUN.lead) : RESULT_NOUN.lead;
    const ARTICLED = new Set(['AE', 'US', 'GB', 'UK']); // "the UAE", "the USA", "the UK"
    const where = countries.length === 1
      ? `${ARTICLED.has(countries[0]) ? 'the ' : ''}${MARKETS.find((m) => m.code === countries[0])?.label ?? countries[0]}`
      : countries.length > 1 ? 'your selected countries' : null;
    const money = (n: number) => (n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10));
    const range = b
      ? `$${money(b.lowUsd)}–${money(b.highUsd)}${b.local ? ` (≈ ${b.local.code} ${b.local.low}–${b.local.high})` : ''}`
      : null;
    return (
      <div className={`soc-note soc-brain ${previewBusy ? 'thinking' : ''}`} role="status">
        <p>
          {preview.confidence >= 0.6 ? <>Sounds like a <strong>{preview.label.toLowerCase()}</strong>. </>
            : preview.verticalId === 'generic' ? <>No industry match — the robot will judge results against this campaign's own history. </>
              : <>Best guess: <strong>{preview.label.toLowerCase()}</strong> — tap below if that's off. </>}
          {b && range && (
            b.basis === 'your-own-results'
              ? <>Based on <strong>your own past campaign</strong>, each {noun[0]} costs around {range}{expected && <> — at ${perDay.toFixed(0)}/day × {daysN} days expect roughly <strong>{expected.lo === 0 ? `up to ${expected.hi}` : `${expected.lo}–${expected.hi}`} {noun[1]}</strong></>}. </>
              : <>{where ? <>In <strong>{where}</strong>, </> : <></>}{noun[1]} in this industry typically run <strong>{range}</strong>{b.global ? ' (global estimate)' : ''}{expected && <> — at ${perDay.toFixed(0)}/day × {daysN} days expect roughly <strong>{expected.lo === 0 ? `up to ${expected.hi}` : `${expected.lo}–${expected.hi}`} {noun[1]}</strong></>}. </>
          )}
          {expected && expected.hi <= 1 && <>Budgets this size rarely produce results in this industry — consider a longer run or higher daily amount. </>}
          {preview.complianceNote && <>{preview.complianceNote} </>}
          {preview.verticalId !== 'generic' && (
            <button className="soc-brain-fix" onClick={() => setShowCorrector((s) => !s)}>
              Not {/^[aeiou]/i.test(preview.label) ? 'an' : 'a'} {preview.label.toLowerCase()}?
            </button>
          )}
        </p>
        {showCorrector && (
          <div className="soc-chip-row" style={{ marginTop: 8 }}>
            {VERTICAL_CHOICES.map((v) => (
              <button
                key={v.id}
                className={`soc-chip soc-chip-btn ${preview.verticalId === v.id ? 'on' : ''}`}
                onClick={() => { setVerticalOverride(v.id); setShowCorrector(false); setTargetTouched(false); }}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="soc-brief">
      <div className="soc-grid2">
        <label>Campaign name (optional)
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring lead drive" />
        </label>
        <label>What you're promoting *
          <input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="e.g. Home deep-cleaning service in Dubai" />
        </label>
      </div>

      <label className="soc-field">Topics / angles the ads should hit
        <div className="soc-chip-row">
          {topics.map((t) => (
            <span key={t} className="soc-chip">{t}
              <button onClick={() => setTopics((ts) => ts.filter((x) => x !== t))} aria-label={`Remove ${t}`}>×</button>
            </span>
          ))}
          <input
            value={topicDraft}
            onChange={(e) => setTopicDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTopic(); } }}
            onBlur={addTopic}
            placeholder={topics.length ? 'Add another…' : 'e.g. move-out cleaning, same-day booking'}
          />
        </div>
      </label>

      {brainLine()}

      <div className="soc-field">
        <span className="soc-lab">Goal — what should this campaign produce?</span>
        <div className="soc-seg" role="radiogroup" aria-label="Campaign goal">
          {GOALS.map((g) => (
            <button key={g.id} className={goal === g.id ? 'on' : ''} onClick={() => setGoal(g.id)} role="radio" aria-checked={goal === g.id}>
              {g.label}
            </button>
          ))}
        </div>
        <p className="soc-sub" style={{ margin: '6px 0 0' }}>{GOALS.find((g) => g.id === goal)!.blurb}</p>
      </div>

      {goal === 'leads' && (
        <p className="soc-note">An Instant Form (name + phone + email) is created automatically — leads land in the Campaigns view and ping you the moment they arrive.</p>
      )}
      {goal === 'messages' && (
        <div className="soc-grid2">
          <label>Where chats open
            <select value={dmSurface} onChange={(e) => setDmSurface(e.target.value as any)}>
              <option value="messenger">Messenger</option>
              <option value="instagram_direct">Instagram Direct</option>
            </select>
          </label>
          <label>Call-to-action text (optional)
            <input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Message us for a quote" />
          </label>
        </div>
      )}
      {needsUrl && (
        <div className="soc-grid2">
          <label>Website URL *
            <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="https://yoursite.com/offer" />
          </label>
          <label>Call-to-action text (optional)
            <input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Book now" />
          </label>
        </div>
      )}

      <div className="soc-field">
        <span className="soc-lab">Where the ads run</span>
        <div className="soc-chip-row soc-markets" role="group" aria-label="Ad countries">
          {MARKETS.map((m) => (
            <button key={m.code} className={`soc-chip soc-chip-btn ${countries.includes(m.code) ? 'on' : ''}`} onClick={() => toggleCountry(m.code)} aria-pressed={countries.includes(m.code)}>
              {m.label}
            </button>
          ))}
          {countries.filter((c) => !MARKETS.some((m) => m.code === c)).map((c) => (
            <span key={c} className="soc-chip">{c}
              <button onClick={() => toggleCountry(c)} aria-label={`Remove ${c}`}>×</button>
            </span>
          ))}
          {showCountryOther ? (
            <input
              autoFocus value={countryDraft} maxLength={2}
              onChange={(e) => setCountryDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomCountry(); } }}
              onBlur={addCustomCountry}
              placeholder="Code (e.g. FR)" style={{ width: 110, flex: 'none' }}
            />
          ) : (
            <button className="soc-chip soc-chip-btn" onClick={() => setShowCountryOther(true)}>Other…</button>
          )}
        </div>
        <div className="soc-grid2" style={{ marginTop: 8 }}>
          <label>Age range
            <span className="soc-age">
              <input type="number" min={13} max={65} value={ageMin} onChange={(e) => setAgeMin(e.target.value)} aria-label="Minimum age" />
              <span>–</span>
              <input type="number" min={13} max={65} value={ageMax} onChange={(e) => setAgeMax(e.target.value)} aria-label="Maximum age" />
            </span>
          </label>
        </div>
        <label className="soc-check">
          <input type="checkbox" checked={broad} onChange={(e) => setBroad(e.target.checked)} />
          Let Meta find the audience (Advantage+ broad — usually wins)
        </label>
      </div>

      <div className="soc-field">
        <span className="soc-lab">Budget</span>
        <div className="soc-seg soc-seg-sm" role="radiogroup" aria-label="Budget model">
          <button className={budgetModel === 'daily' ? 'on' : ''} onClick={() => setBudgetModel('daily')} role="radio" aria-checked={budgetModel === 'daily'}>Per day</button>
          <button className={budgetModel === 'lifetime' ? 'on' : ''} onClick={() => setBudgetModel('lifetime')} role="radio" aria-checked={budgetModel === 'lifetime'}>Total</button>
        </div>
        <div className="soc-grid2" style={{ marginTop: 8 }}>
          <label>{budgetModel === 'daily' ? 'Amount per day (USD)' : 'Total amount (USD)'}
            <input type="number" min={1} value={budget} onChange={(e) => setBudget(e.target.value)} />
          </label>
          <label>Duration (days)
            <input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
        </div>
        <p className={`soc-readout ${overCap ? 'bad' : ''}`}>
          ≈ ${perDay.toFixed(2)}/day × {daysN} days = ${total.toFixed(2)} total
          {dailyCapUsd > 0 && <> · robot cap ${dailyCapUsd}/day{overCap && ' — OVER CAP'}</>}
        </p>
        <div className="soc-grid2" style={{ marginTop: 8 }}>
          <label>Target cost per {preview?.benchmark ? (RESULT_NOUN[preview.benchmark.metric]?.[0] ?? 'result') : 'result'} (USD, optional)
            <input
              type="number" min={0} step="0.5" value={target}
              onChange={(e) => { setTarget(e.target.value); setTargetTouched(true); }}
              placeholder={preview?.suggestedTargetUsd ? String(preview.suggestedTargetUsd) : 'e.g. 15'}
            />
          </label>
          <span className="soc-readout" style={{ alignSelf: 'end' }}>
            {preview?.targetAmbition === 'ambitious' && Number(target) > 0
              ? <span className="soc-warn">Ambitious — the robot will chase it, but expect fewer results.</span>
              : preview?.suggestedTargetUsd
                ? <>Suggested: ${preview.suggestedTargetUsd}{preview.benchmark?.basis === 'your-own-results' ? ' (from your last campaign)' : ''}</>
                : <>The robot steers every 48h toward this price.</>}
          </span>
        </div>
      </div>

      <div className="soc-field">
        <span className="soc-lab">Creatives</span>
        <div className="soc-grid2">
          <label>Ad images to generate (pool for rotation)
            <input type="number" min={3} max={50} value={images} onChange={(e) => setImages(e.target.value)} />
          </label>
          <span className="soc-readout" style={{ alignSelf: 'end' }}>≈ ${genCost.toFixed(2)} one-time generation cost</span>
        </div>
        <p className="soc-sub" style={{ margin: '6px 0 0' }}>
          Mobile + web formats automatically. 3–5 run at a time; tired ones are swapped for fresh pool creatives every 48h.
        </p>
      </div>

      <div className="soc-field">
        <span className="soc-lab">When people comment or DM about this ad…</span>
        <div className="soc-grid2">
          <label>Say / emphasise
            <input value={say} onChange={(e) => setSay(e.target.value)} placeholder="Mention the 20% opening offer, book via the link" />
          </label>
          <label>Never say
            <input value={doNotSay} onChange={(e) => setDoNotSay(e.target.value)} placeholder="Prices for commercial jobs" />
          </label>
        </div>
        <label className="soc-field" style={{ marginTop: 6 }}>Escalate to me if
          <input value={escalateIf} onChange={(e) => setEscalateIf(e.target.value)} placeholder="They ask for a refund or mention a complaint" />
        </label>
      </div>

      <label className="soc-check" style={{ marginTop: 2 }}>
        <input type="checkbox" checked={autoLaunch} onChange={(e) => setAutoLaunch(e.target.checked)} />
        Launch automatically within my cap (untick to review before it goes live)
      </label>

      {err && <p className="soc-msg bad">{err}</p>}
      <div className="soc-actions">
        <button className="soc-btn" disabled={busy} onClick={launch}>
          {busy ? 'Starting…' : autoLaunch ? 'Generate & launch' : 'Generate & review'}
        </button>
        {onCancel && <button className="soc-btn ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}
