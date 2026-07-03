import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Screen, AppText, Button, Field, Banner, useTheme } from '../src/ui/components';
import { useAuth } from '../src/lib/auth';

// Sign in / create account — complete flow with validation + error surfacing.
export default function SignIn() {
  const t = useTheme();
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setErr('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setErr('Enter a valid email address.');
    if (password.length < 6) return setErr('Password must be at least 6 characters.');
    if (mode === 'signup' && !name.trim()) return setErr('Enter your name.');
    setBusy(true);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await signup({ email: email.trim(), password, name: name.trim() });
      router.replace('/');
    } catch (e: any) { setErr(e?.message ?? 'Something went wrong — try again.'); }
    finally { setBusy(false); }
  }

  return (
    <Screen scroll>
      <View style={{ gap: t.space.lg, paddingTop: t.space.xxl }}>
        <View style={{ gap: t.space.xs }}>
          <AppText variant="display">{mode === 'login' ? 'Welcome back' : 'Create your account'}</AppText>
          <AppText muted>{mode === 'login' ? 'Sign in to continue.' : 'A minute to set up.'}</AppText>
        </View>
        {mode === 'signup' ? <Field label="Name" value={name} onChangeText={setName} /> : null}
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry />
        {err ? <Banner kind="danger">{err}</Banner> : null}
        <Button title={busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create account'} onPress={submit} loading={busy} />
        <Button
          variant="ghost"
          title={mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
          onPress={() => { setErr(''); setMode(mode === 'login' ? 'signup' : 'login'); }}
        />
      </View>
    </Screen>
  );
}
