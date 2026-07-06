import { useEffect, useState } from 'react';
import type { RobotChannel, RobotChannelKind, RobotCommander, RobotKbDoc, RobotPersona, RobotTask } from '@shared/types';
import { api } from '../api/client';

/**
 * Robot office panels for the multichannel arc: connect Telegram/WhatsApp/SMS, pick a
 * persona, manage the knowledge base, list trusted commanders, and see the build tasks the
 * robot ran on command. All backed by the org-gated /api/orgs/:id/robots/:rid/* routes.
 */

const KIND_META: Record<RobotChannelKind, { label: string; blurb: string }> = {
  telegram: {
    label: 'Telegram',
    blurb: 'Create a bot with @BotFather (2 minutes), paste its token — the robot replies in that bot\'s chats. No server setup needed.',
  },
  whatsapp: {
    label: 'WhatsApp',
    blurb: 'Uses the official WhatsApp Cloud API (Meta business app). Paste the phone number ID + permanent access token, choose a verify token, and set the webhook in Meta to the URL shown below.',
  },
  sms: {
    label: 'SMS',
    blurb: 'Uses SMSALA. Paste your API ID + password and registered sender ID. For replies to incoming SMS, set the inbound URL below in your SMSALA panel — and whitelist the ArksAI server IP in your SMSALA account.',
  },
};

function ChannelForm({ orgId, robotId, kind, channel, onSaved }: {
  orgId: string;
  robotId: string;
  kind: RobotChannelKind;
  channel: RobotChannel | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const meta = channel?.meta ?? {};

  const save = async () => {
    setBusy('save');
    setMsg(null);
    try {
      await api.saveRobotChannel(orgId, robotId, kind, form);
      setForm({});
      setMsg({ ok: true, text: 'Saved.' });
      onSaved();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Could not save.' });
    } finally {
      setBusy(null);
    }
  };
  const test = async () => {
    setBusy('test');
    setMsg(null);
    try {
      const r = await api.testRobotChannel(orgId, robotId, kind);
      setMsg({ ok: r.ok, text: r.detail });
      if (r.ok) onSaved();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Test failed.' });
    } finally {
      setBusy(null);
    }
  };
  const disconnect = async () => {
    setBusy('del');
    try {
      await api.deleteRobotChannel(orgId, robotId, kind);
      onSaved();
    } finally {
      setBusy(null);
    }
  };

  const hookBase = window.location.origin;

  return (
    <div className="rb-chan">
      <div className="rb-chan-head">
        <strong>{KIND_META[kind].label}</strong>
        {channel ? (
          <span className="rb-status" style={{ ['--tone' as any]: channel.verifiedAt ? '#2f7d5b' : '#a8842c' }}>
            {channel.verifiedAt ? 'connected ✓' : 'saved — test it'}
          </span>
        ) : (
          <span className="rb-status" style={{ ['--tone' as any]: '#8a8577' }}>not connected</span>
        )}
      </div>
      <p className="rb-mini-empty" style={{ marginBottom: 8 }}>{KIND_META[kind].blurb}</p>

      {kind === 'telegram' && (
        <div className="rb-chan-grid">
          <input placeholder={channel?.hasSecrets ? 'Bot token (saved — paste to replace)' : 'Bot token from @BotFather'} value={form.botToken ?? ''} onChange={set('botToken')} />
        </div>
      )}
      {kind === 'whatsapp' && (
        <div className="rb-chan-grid">
          <input placeholder={meta.phoneNumberId ? `Phone number ID (${meta.phoneNumberId})` : 'Phone number ID'} value={form.phoneNumberId ?? ''} onChange={set('phoneNumberId')} />
          <input placeholder={channel?.hasSecrets ? 'Access token (saved — paste to replace)' : 'Permanent access token'} value={form.accessToken ?? ''} onChange={set('accessToken')} />
          <input placeholder={meta.verifyToken ? `Verify token (${meta.verifyToken})` : 'Verify token (you choose it)'} value={form.verifyToken ?? ''} onChange={set('verifyToken')} />
          <input placeholder="App secret (optional, enables signature checks)" value={form.appSecret ?? ''} onChange={set('appSecret')} />
          <div className="rb-hook">Webhook URL for Meta: <code>{hookBase}/api/hooks/whatsapp</code></div>
        </div>
      )}
      {kind === 'sms' && (
        <div className="rb-chan-grid">
          <input placeholder={channel?.hasSecrets ? 'API ID (saved — paste to replace)' : 'SMSALA API ID'} value={form.apiId ?? ''} onChange={set('apiId')} />
          <input placeholder="SMSALA API password" type="password" value={form.apiPassword ?? ''} onChange={set('apiPassword')} />
          <input placeholder={meta.senderId ? `Sender ID (${meta.senderId})` : 'Registered sender ID'} value={form.senderId ?? ''} onChange={set('senderId')} />
          <input placeholder={meta.channelNumber ? `Two-way number (${meta.channelNumber})` : 'Two-way channel number (optional)'} value={form.channelNumber ?? ''} onChange={set('channelNumber')} />
          {meta.hookKey && (
            <div className="rb-hook">Inbound URL for SMSALA: <code>{hookBase}/api/hooks/sms/{meta.hookKey}</code></div>
          )}
        </div>
      )}

      <div className="rb-panel-actions">
        <button className="rb-save" onClick={save} disabled={busy != null || Object.values(form).every((v) => !v.trim())}>
          {busy === 'save' ? 'Saving…' : channel ? 'Update' : 'Connect'}
        </button>
        {channel && (
          <>
            <button className="rb-ghost-btn" onClick={test} disabled={busy != null}>
              {busy === 'test' ? 'Testing…' : 'Test connection'}
            </button>
            <button className="rb-danger-btn" onClick={disconnect} disabled={busy != null}>Disconnect</button>
          </>
        )}
      </div>
      {msg && <div className="rb-check-msg" style={{ color: msg.ok ? '#2f7d5b' : '#b23f2e' }}>{msg.text}</div>}
    </div>
  );
}

export function ChannelsPanel({ orgId, robotId }: { orgId: string; robotId: string }) {
  const [channels, setChannels] = useState<RobotChannel[] | null>(null);
  const [voiceReplies, setVoiceReplies] = useState<string>('mirror');
  const load = () => {
    api.listRobotChannels(orgId, robotId).then(setChannels).catch(() => setChannels([]));
  };
  useEffect(load, [orgId, robotId]);
  useEffect(() => {
    api.getRobot(orgId, robotId).then((r) => setVoiceReplies(r.config?.voiceReplies ?? 'mirror')).catch(() => {});
  }, [orgId, robotId]);
  // Read-merge-write (never clobber the rest of the config).
  const setVoice = async (v: string) => {
    setVoiceReplies(v);
    try {
      const backend = await api.getRobot(orgId, robotId);
      await api.updateRobot(orgId, robotId, { config: { ...(backend.config || {}), voiceReplies: v as any } });
    } catch {
      /* retried on next change */
    }
  };
  const byKind = (k: RobotChannelKind) => (channels ?? []).find((c) => c.kind === k) ?? null;
  return (
    <>
      <h3>Chat & SMS channels</h3>
      <p className="rb-mini-empty" style={{ marginBottom: 8 }}>
        Beyond email, this robot can answer on Telegram, WhatsApp and SMS — same brain, same approval rules,
        replies always locked to the person who wrote in. Voice notes people send are transcribed and
        understood; the robot can answer with a voice note of its own too.
      </p>
      <div className="rb-persona-row" style={{ marginBottom: 10 }}>
        <span className="rb-rule-when" style={{ alignSelf: 'center' }}>Voice replies:</span>
        <select value={voiceReplies} onChange={(e) => void setVoice(e.target.value)}>
          <option value="mirror">Match the sender (speak when they speak)</option>
          <option value="always">Always add a voice note</option>
          <option value="off">Text only</option>
        </select>
      </div>
      {(['telegram', 'whatsapp', 'sms'] as RobotChannelKind[]).map((k) => (
        <ChannelForm key={k} orgId={orgId} robotId={robotId} kind={k} channel={byKind(k)} onSaved={load} />
      ))}
    </>
  );
}

export function PersonaPanel({ orgId, robotId }: { orgId: string; robotId: string }) {
  const [personas, setPersonas] = useState<RobotPersona[] | null>(null);
  const [personaId, setPersonaId] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', voice: '', language: '', signature: '' });
  const load = () => {
    api.listPersonas(orgId).then(setPersonas).catch(() => setPersonas([]));
  };
  useEffect(load, [orgId]);
  useEffect(() => {
    api.getRobot(orgId, robotId).then((r) => setPersonaId(r.config?.personaId)).catch(() => {});
  }, [orgId, robotId]);
  // Read-merge-write: picking a persona must never clobber the rest of the robot's config.
  const onPick = async (pid: string | undefined) => {
    setPersonaId(pid);
    try {
      const backend = await api.getRobot(orgId, robotId);
      await api.updateRobot(orgId, robotId, { config: { ...(backend.config || {}), personaId: pid } });
    } catch {
      /* offline — retried on next pick */
    }
  };
  const create = async () => {
    if (!draft.name.trim() || !draft.voice.trim()) return;
    const p = await api.createPersona(orgId, {
      name: draft.name.trim(),
      voice: draft.voice.trim(),
      language: draft.language.trim() || undefined,
      signature: draft.signature.trim() || undefined,
    });
    setCreating(false);
    setDraft({ name: '', voice: '', language: '', signature: '' });
    load();
    onPick(p.id);
  };
  return (
    <>
      <h3>Persona</h3>
      <p className="rb-mini-empty" style={{ marginBottom: 8 }}>
        A saved voice this robot speaks with — reusable across robots. Its own free-text persona (if set in
        the mandate) still wins.
      </p>
      <div className="rb-persona-row">
        <select value={personaId ?? ''} onChange={(e) => onPick(e.target.value || undefined)}>
          <option value="">No persona (default voice)</option>
          {(personas ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.name}{p.language ? ` · ${p.language}` : ''}</option>
          ))}
        </select>
        <button className="rb-ghost-btn" onClick={() => setCreating((v) => !v)}>{creating ? 'Cancel' : '+ New persona'}</button>
        {personaId && (
          <button
            className="rb-danger-btn"
            onClick={async () => {
              await api.deletePersona(orgId, personaId).catch(() => {});
              onPick(undefined);
              load();
            }}
          >
            Delete persona
          </button>
        )}
      </div>
      {creating && (
        <div className="rb-chan-grid" style={{ marginTop: 8 }}>
          <input placeholder="Name (e.g. Concierge, Legal counsel)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <textarea rows={3} placeholder="Voice & behavior — how it speaks, what tone, what it emphasizes" value={draft.voice} onChange={(e) => setDraft({ ...draft, voice: e.target.value })} />
          <input placeholder="Language (optional — e.g. Arabic, formal English)" value={draft.language} onChange={(e) => setDraft({ ...draft, language: e.target.value })} />
          <input placeholder="Email signature (optional)" value={draft.signature} onChange={(e) => setDraft({ ...draft, signature: e.target.value })} />
          <div className="rb-panel-actions">
            <button className="rb-save" onClick={create} disabled={!draft.name.trim() || !draft.voice.trim()}>Save persona</button>
          </div>
        </div>
      )}
    </>
  );
}

export function KnowledgePanel({ orgId, robotId }: { orgId: string; robotId: string }) {
  const [docs, setDocs] = useState<RobotKbDoc[] | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasteName, setPasteName] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = () => {
    api.listRobotKb(orgId, robotId).then(setDocs).catch(() => setDocs([]));
  };
  useEffect(load, [orgId, robotId]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setErr(null);
    try {
      await api.uploadRobotKbFiles(orgId, robotId, Array.from(files));
      load();
    } catch (e: any) {
      setErr(e?.message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };
  const paste = async () => {
    if (!pasteText.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.addRobotKbText(orgId, robotId, pasteName.trim() || 'Pasted notes', pasteText.trim());
      setPasting(false);
      setPasteName('');
      setPasteText('');
      load();
    } catch (e: any) {
      setErr(e?.message || 'Could not add that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3>Knowledge base {docs && docs.length > 0 && <span className="rb-count">{docs.length}</span>}</h3>
      <p className="rb-mini-empty" style={{ marginBottom: 8 }}>
        Documents the robot answers FROM — price lists, policies, FAQs, product sheets. Only the parts
        relevant to each message reach the reply; anything not covered escalates to you.
      </p>
      {docs === null ? (
        <div className="rb-mini-empty">Loading…</div>
      ) : (
        <ul className="rb-rules">
          {docs.map((d) => (
            <li key={d.id} className="rb-rule">
              <div className="rb-rule-main">
                <span className="rb-rule-when">{d.name}</span>
                <span className="rb-rule-then">{(d.chars / 1000).toFixed(1)}k characters</span>
              </div>
              <button
                className="rb-rule-x"
                onClick={async () => {
                  await api.deleteRobotKbDoc(orgId, robotId, d.id).catch(() => {});
                  load();
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="rb-panel-actions">
        <label className="rb-ghost-btn" style={{ cursor: 'pointer' }}>
          {busy ? 'Working…' : 'Upload file'}
          <input type="file" multiple accept=".txt,.md,.csv,.pdf,.docx" style={{ display: 'none' }} onChange={(e) => void upload(e.target.files)} />
        </label>
        <button className="rb-ghost-btn" onClick={() => setPasting((v) => !v)}>{pasting ? 'Cancel' : 'Paste text'}</button>
      </div>
      {pasting && (
        <div className="rb-chan-grid" style={{ marginTop: 8 }}>
          <input placeholder="Name (e.g. Price list)" value={pasteName} onChange={(e) => setPasteName(e.target.value)} />
          <textarea rows={5} placeholder="Paste the knowledge text here" value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
          <div className="rb-panel-actions">
            <button className="rb-save" onClick={paste} disabled={busy || !pasteText.trim()}>Add</button>
          </div>
        </div>
      )}
      {err && <div className="rb-check-msg" style={{ color: '#b23f2e' }}>{err}</div>}
    </>
  );
}

export function CommandersPanel({ orgId, robotId }: { orgId: string; robotId: string }) {
  const [commanders, setCommanders] = useState<RobotCommander[] | null>(null);
  const [channel, setChannel] = useState('telegram');
  const [address, setAddress] = useState('');
  const [notifyLevel, setNotifyLevel] = useState<string>('escalations');
  const [toolsLevel, setToolsLevel] = useState<string>('commanders');
  const load = () => {
    api.listCommanders(orgId, robotId).then(setCommanders).catch(() => setCommanders([]));
  };
  useEffect(load, [orgId, robotId]);
  useEffect(() => {
    api.getRobot(orgId, robotId).then((r) => {
      setNotifyLevel(r.config?.notify ?? 'escalations');
      setToolsLevel((r.config as any)?.replyTools ?? 'commanders');
    }).catch(() => {});
  }, [orgId, robotId]);
  const add = async () => {
    if (!address.trim()) return;
    await api.addCommander(orgId, robotId, { channel, address: address.trim() }).catch(() => {});
    setAddress('');
    load();
  };
  // Read-merge-write so a setting never clobbers the rest of the robot's config.
  const patchConfig = async (patch: Record<string, unknown>) => {
    try {
      const backend = await api.getRobot(orgId, robotId);
      await api.updateRobot(orgId, robotId, { config: { ...(backend.config || {}), ...patch } as any });
    } catch {
      /* retried on next change */
    }
  };
  const setLevel = async (level: string) => {
    setNotifyLevel(level);
    await patchConfig({ notify: level });
  };
  const setTools = async (level: string) => {
    setToolsLevel(level);
    await patchConfig({ replyTools: level });
  };
  return (
    <>
      <h3>Your addresses (commands + alerts) {commanders && commanders.length > 0 && <span className="rb-count">{commanders.length}</span>}</h3>
      <p className="rb-mini-empty" style={{ marginBottom: 8 }}>
        YOUR OWN addresses. From them you can order builds by message (“make me a landing page and email it
        to X”), check status, cancel, or revise — and the robot pings you HERE when something needs you:
        reply APPROVE to send its draft, IGNORE to drop it, or just tell it how to respond. Only these
        senders have that power; everyone else just gets replies. (Telegram uses your numeric chat id —
        message the bot once and check the robot timeline to find it.)
      </p>
      <div className="rb-persona-row" style={{ marginBottom: 8 }}>
        <span className="rb-rule-when" style={{ alignSelf: 'center' }}>Ping me about:</span>
        <select value={notifyLevel} onChange={(e) => void setLevel(e.target.value)}>
          <option value="escalations">Escalations only</option>
          <option value="all">Everything awaiting approval</option>
          <option value="off">Nothing (console only)</option>
        </select>
      </div>
      <div className="rb-persona-row" style={{ marginBottom: 8 }}>
        <span className="rb-rule-when" style={{ alignSelf: 'center' }}>Studio tools:</span>
        <select value={toolsLevel} onChange={(e) => void setTools(e.target.value)} title="Make an image, ad creative, document, spreadsheet or chart, or find stock photos — right in a conversation, delivered on the same channel. Big builds (websites, videos, music) always go through your build commands.">
          <option value="commanders">My addresses only (default)</option>
          <option value="everyone">Everyone it talks to</option>
          <option value="off">Off</option>
        </select>
      </div>
      {commanders === null ? (
        <div className="rb-mini-empty">Loading…</div>
      ) : (
        <ul className="rb-rules">
          {commanders.map((c) => (
            <li key={c.id} className="rb-rule">
              <div className="rb-rule-main">
                <span className="rb-rule-when">{c.channel}</span>
                <span className="rb-rule-then">{c.address}{c.label ? ` · ${c.label}` : ''}</span>
              </div>
              <button
                className="rb-rule-x"
                onClick={async () => {
                  await api.deleteCommander(orgId, robotId, c.id).catch(() => {});
                  load();
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="rb-persona-row" style={{ marginTop: 8 }}>
        <select value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="telegram">Telegram</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="email">Email</option>
          <option value="sms">SMS</option>
        </select>
        <input placeholder={channel === 'email' ? 'you@company.com' : channel === 'telegram' ? 'Your chat id (e.g. 123456789)' : 'Your number (e.g. 9715xxxxxxxx)'} value={address} onChange={(e) => setAddress(e.target.value)} />
        <button className="rb-save" onClick={add} disabled={!address.trim()}>Add</button>
      </div>
    </>
  );
}

const TASK_TONE: Record<string, string> = {
  running: '#a8842c',
  delivering: '#a8842c',
  delivered: '#2f7d5b',
  error: '#b23f2e',
};

export function TasksPanel({ orgId, robotId }: { orgId: string; robotId: string }) {
  const [tasks, setTasks] = useState<RobotTask[] | null>(null);
  useEffect(() => {
    api.listRobotTasks(orgId, robotId).then(setTasks).catch(() => setTasks([]));
  }, [orgId, robotId]);
  if (!tasks?.length) return null; // quiet until the robot has actually built something
  return (
    <>
      <h3>Builds on command {tasks.length > 0 && <span className="rb-count">{tasks.length}</span>}</h3>
      <ul className="rb-rules">
        {tasks.map((t) => (
          <li key={t.id} className="rb-rule">
            <div className="rb-rule-main">
              <span className="rb-rule-when">{t.request.slice(0, 90)}{t.request.length > 90 ? '…' : ''}</span>
              <span className="rb-rule-then">
                via {t.channel}{t.artifacts.length ? ` → ${t.artifacts.slice(0, 3).join(', ')}` : ''}{t.error ? ` — ${t.error}` : ''}
              </span>
            </div>
            <span className="rb-status" style={{ ['--tone' as any]: TASK_TONE[t.status] || '#8a8577' }}>{t.status}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
