import { useEffect, useState } from 'react';
import { api, type EmailAccount, type EmailAccountForm, type EmailVerifyResult } from '../api/client';

/**
 * Connect an organization's (or a robot's) mailbox: SMTP (outbound) + IMAP (inbound).
 *
 * Quick mode (default for a new mailbox): the user gives just an email + password and we
 * auto-detect the SMTP/IMAP host/port/security (built-in providers → MX lookup → Mozilla
 * ISPDB), verify the login, and save — no server settings to know. If detection or the
 * login fails, it falls back to the manual form, pre-filled with whatever we found.
 *
 * Passwords are write-only — stored encrypted, never sent back (the field shows a "saved"
 * placeholder and a blank value keeps the existing password).
 */
export function EmailSettings({ orgId, robotId }: { orgId: string; robotId?: string }) {
  const [form, setForm] = useState<EmailAccountForm>({ fromEmail: '', smtpHost: '', smtpPort: 587, imapPort: 993, imapSecure: true });
  const [account, setAccount] = useState<EmailAccount | null>(null);
  const [mode, setMode] = useState<'quick' | 'manual'>('quick');
  const [quick, setQuick] = useState({ fromName: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [test, setTest] = useState<EmailVerifyResult | null>(null);

  // Bind to either the org mailbox or a specific robot's mailbox.
  const calls = robotId
    ? {
        get: () => api.getRobotEmail(orgId, robotId),
        save: (b: EmailAccountForm) => api.saveRobotEmail(orgId, robotId, b),
        test: (b: EmailAccountForm) => api.testRobotEmail(orgId, robotId, b),
        autoconfig: (email: string) => api.autoconfigRobotEmail(orgId, robotId, email),
        del: () => api.deleteRobotEmail(orgId, robotId),
      }
    : {
        get: () => api.getEmailAccount(orgId),
        save: (b: EmailAccountForm) => api.saveEmailAccount(orgId, b),
        test: (b: EmailAccountForm) => api.testEmailAccount(orgId, b),
        autoconfig: (email: string) => api.autoconfigEmail(orgId, email),
        del: () => api.deleteEmailAccount(orgId),
      };

  useEffect(() => {
    setError(''); setNote(''); setTest(null);
    if (!orgId) return;
    calls.get().then((a) => {
      setAccount(a);
      if (a) {
        setMode('manual'); // an existing mailbox → show its settings to edit
        setForm({
          fromName: a.fromName ?? '', fromEmail: a.fromEmail,
          smtpHost: a.smtpHost, smtpPort: a.smtpPort, smtpSecure: a.smtpSecure, smtpUser: a.smtpUser ?? '',
          imapHost: a.imapHost ?? '', imapPort: a.imapPort, imapSecure: a.imapSecure, imapUser: a.imapUser ?? '',
          enabled: a.enabled, autoReply: a.autoReply,
        });
      } else {
        setMode('quick');
        setForm({ fromEmail: '', smtpHost: '', smtpPort: 587, imapPort: 993, imapSecure: true });
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, robotId]);

  const set = (patch: Partial<EmailAccountForm>) => setForm((f) => ({ ...f, ...patch }));

  const valid = !!form.fromEmail.trim() && !!form.smtpHost.trim();

  // Quick connect: detect → fill → verify → save. Falls back to manual on any miss.
  const connectQuick = async () => {
    const email = quick.email.trim();
    if (!email.includes('@') || !quick.password) {
      setError('Enter the mailbox email address and its password.');
      return;
    }
    setBusy(true); setError(''); setNote(''); setTest(null);
    try {
      setNote('Detecting your mail server…');
      const cfg = await calls.autoconfig(email);
      if (!cfg) {
        setForm((f) => ({ ...f, fromName: quick.fromName || f.fromName, fromEmail: email, smtpUser: email, imapUser: email, smtpPass: quick.password, imapPass: quick.password }));
        setNote('');
        setError("We couldn't detect your mail server automatically. Please enter the details below — your email provider's help pages list the IMAP and SMTP host and port.");
        setMode('manual');
        return;
      }
      const filled: EmailAccountForm = {
        fromName: quick.fromName || null, fromEmail: email,
        smtpHost: cfg.smtpHost, smtpPort: cfg.smtpPort, smtpSecure: cfg.smtpSecure, smtpUser: email, smtpPass: quick.password,
        imapHost: cfg.imapHost, imapPort: cfg.imapPort, imapSecure: cfg.imapSecure, imapUser: email, imapPass: quick.password,
        enabled: true, autoReply: !!form.autoReply,
      };
      setForm(filled);
      setNote('Verifying the connection…');
      const r = await calls.test(filled);
      setTest(r);
      if (r.smtp.ok && (r.imap.ok || r.imap.skipped)) {
        const a = await calls.save(filled);
        setAccount(a);
        setQuick((q) => ({ ...q, password: '' }));
        setNote('Connected ✓ Your mailbox is ready.');
      } else {
        setNote('');
        setError('We found your mail server, but the sign-in failed. Check the password below — Gmail and Outlook accounts with 2-step verification need an app password, not your normal one.');
        setMode('manual');
      }
    } catch (e: any) {
      setError(e?.message || 'Could not connect.'); setNote('');
    } finally { setBusy(false); }
  };

  const doTest = async () => {
    setBusy(true); setError(''); setNote(''); setTest(null);
    try {
      const r = await calls.test(form);
      setTest(r);
    } catch (e: any) {
      setError(e?.message || 'Test failed.');
    } finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true); setError(''); setNote('');
    try {
      const a = await calls.save(form);
      setAccount(a);
      set({ smtpPass: '', imapPass: '' });
      setNote('Saved.');
    } catch (e: any) {
      setError(e?.message || 'Could not save.');
    } finally { setBusy(false); }
  };

  const disconnect = async () => {
    setBusy(true); setError('');
    try {
      await calls.del();
      setAccount(null);
      setForm({ fromEmail: '', smtpHost: '', smtpPort: 587, imapPort: 993, imapSecure: true });
      setQuick({ fromName: '', email: '', password: '' });
      setMode('quick');
      setNote('Mailbox disconnected.');
    } catch (e: any) {
      setError(e?.message || 'Could not disconnect.');
    } finally { setBusy(false); }
  };

  const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: 'var(--accent)', font: 'inherit', fontSize: 13, cursor: 'pointer', padding: 0 };

  // ---- Quick connect ----
  if (mode === 'quick') {
    return (
      <div className="email-settings">
        <p className="an-sub" style={{ marginTop: 4 }}>
          {robotId
            ? 'Connect this robot’s own mailbox — it sends and reads email from this address. Just enter the email and password; we’ll find the rest.'
            : 'Connect a mailbox so this organization’s agents can send and read email. Just enter the email and password; we’ll find the server settings for you.'}
        </p>

        <label style={{ marginTop: 12 }}>Display name <span className="email-opt">(optional)</span></label>
        <input placeholder="e.g. Acme Support" value={quick.fromName} onChange={(e) => setQuick((q) => ({ ...q, fromName: e.target.value }))} />

        <label style={{ marginTop: 14 }}>Email address</label>
        <input type="email" autoComplete="off" placeholder="you@yourcompany.com" value={quick.email} onChange={(e) => setQuick((q) => ({ ...q, email: e.target.value }))} />

        <label style={{ marginTop: 14 }}>Password</label>
        <input type="password" autoComplete="new-password" placeholder="Mailbox password" value={quick.password} onChange={(e) => setQuick((q) => ({ ...q, password: e.target.value }))} />
        <p className="an-sub" style={{ marginTop: 7, fontSize: 12 }}>
          Gmail, Outlook and other accounts with 2-step verification need an <strong>app password</strong> (created in your mail account’s security settings), not your normal login.
        </p>

        {note && <div className="email-note" style={{ marginTop: 12 }}>{note}</div>}
        {error && <div className="form-error" style={{ marginTop: 10 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          <button className="send-btn" onClick={connectQuick} disabled={busy || !quick.email.trim() || !quick.password}>
            {busy ? 'Connecting…' : 'Connect & verify'}
          </button>
          <button style={linkBtn} onClick={() => { setMode('manual'); setError(''); setNote(''); set({ fromEmail: quick.email || form.fromEmail, fromName: quick.fromName || form.fromName }); }}>
            Enter server details manually
          </button>
        </div>
      </div>
    );
  }

  // ---- Manual / advanced ----
  const inp = { width: '100%', boxSizing: 'border-box' as const };
  void inp;
  return (
    <div className="email-settings">
      <p className="an-sub" style={{ marginTop: 4 }}>
        {robotId
          ? 'Connect this robot’s own mailbox — it sends and reads email from this address (SMTP + IMAP). Each robot has its own.'
          : 'Connect a mailbox so this organization’s agents can send email (SMTP) and read replies (IMAP).'}{' '}
        Works with any provider — a Gmail app‑password, a company mail server, or a transactional SMTP host.
      </p>
      {!account && (
        <p className="an-sub" style={{ marginTop: 6, fontSize: 12 }}>
          <button style={linkBtn} onClick={() => { setMode('quick'); setError(''); setNote(''); setTest(null); }}>← Back to quick setup (just email + password)</button>
        </p>
      )}

      <label style={{ marginTop: 12 }}>From</label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input placeholder="Display name (e.g. Acme Support)" value={form.fromName ?? ''} onChange={(e) => set({ fromName: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
        <input placeholder="from@yourcompany.com" value={form.fromEmail} onChange={(e) => set({ fromEmail: e.target.value })} style={{ flex: 1, minWidth: 180 }} />
      </div>

      <label style={{ marginTop: 14 }}>Outbound · SMTP</label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input placeholder="smtp.host.com" value={form.smtpHost} onChange={(e) => set({ smtpHost: e.target.value })} style={{ flex: 2, minWidth: 180 }} />
        <input type="number" placeholder="587" value={form.smtpPort ?? 587} onChange={(e) => set({ smtpPort: Number(e.target.value) })} style={{ width: 90 }} />
        <label className="email-chk" title="Use TLS on connect (port 465). Leave off for 587/STARTTLS.">
          <input type="checkbox" checked={!!form.smtpSecure} onChange={(e) => set({ smtpSecure: e.target.checked })} /> SSL
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <input placeholder="SMTP username" value={form.smtpUser ?? ''} onChange={(e) => set({ smtpUser: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
        <input type="password" autoComplete="new-password" placeholder={account?.hasSmtpPass ? '•••••••• (saved)' : 'SMTP password'} value={form.smtpPass ?? ''} onChange={(e) => set({ smtpPass: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
      </div>

      <label style={{ marginTop: 14 }}>Inbound · IMAP <span className="email-opt">(for reading replies / auto‑reply)</span></label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input placeholder="imap.host.com" value={form.imapHost ?? ''} onChange={(e) => set({ imapHost: e.target.value })} style={{ flex: 2, minWidth: 180 }} />
        <input type="number" placeholder="993" value={form.imapPort ?? 993} onChange={(e) => set({ imapPort: Number(e.target.value) })} style={{ width: 90 }} />
        <label className="email-chk" title="Use TLS (port 993).">
          <input type="checkbox" checked={form.imapSecure !== false} onChange={(e) => set({ imapSecure: e.target.checked })} /> SSL
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <input placeholder="IMAP username (defaults to SMTP user)" value={form.imapUser ?? ''} onChange={(e) => set({ imapUser: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
        <input type="password" autoComplete="new-password" placeholder={account?.hasImapPass ? '•••••••• (saved)' : 'IMAP password'} value={form.imapPass ?? ''} onChange={(e) => set({ imapPass: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
      </div>

      <div style={{ display: 'flex', gap: 16, marginTop: 14, flexWrap: 'wrap' }}>
        <label className="email-chk"><input type="checkbox" checked={form.enabled !== false} onChange={(e) => set({ enabled: e.target.checked })} /> Enabled</label>
        <label className="email-chk" title="Stage 2: draft knowledge-base-grounded replies to inbound mail for one-tap approval."><input type="checkbox" checked={!!form.autoReply} onChange={(e) => set({ autoReply: e.target.checked })} /> Draft auto‑replies (beta)</label>
      </div>

      {test && (
        <div className="email-test">
          <div className={test.smtp.ok ? 'ok' : 'bad'}>SMTP: {test.smtp.ok ? 'connected ✓' : `failed — ${test.smtp.error}`}</div>
          <div className={test.imap.skipped ? 'muted' : test.imap.ok ? 'ok' : 'bad'}>
            IMAP: {test.imap.skipped ? 'not configured' : test.imap.ok ? 'connected ✓' : `failed — ${test.imap.error}`}
          </div>
        </div>
      )}
      {error && <div className="form-error" style={{ marginTop: 10 }}>{error}</div>}
      {note && <div className="email-note">{note}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button className="cancel" onClick={doTest} disabled={busy || !valid}>Test connection</button>
        <button className="send-btn" onClick={save} disabled={busy || !valid}>Save mailbox</button>
        {account && <button className="kb-del" onClick={disconnect} disabled={busy} style={{ marginLeft: 'auto' }}>Disconnect</button>}
      </div>
    </div>
  );
}
