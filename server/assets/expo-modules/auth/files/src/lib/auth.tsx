// Auth provider: session restore on launch, login/signup/logout. Wrap the root layout's
// children with <AuthProvider> and gate screens on useAuth().user.
import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, setToken, getToken } from './api';

export interface User { id: string; email: string; name: string }
interface AuthState {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (fields: { email: string; password: string; name: string }) => Promise<void>;
  logout: () => Promise<void>;
}
const Ctx = createContext<AuthState>({ user: null, ready: false, login: async () => {}, signup: async () => {}, logout: async () => {} });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (await getToken()) {
          const d = await api.get('/auth/me');
          setUser(d.user);
        }
      } catch { await setToken(null); }
      finally { setReady(true); }
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const d = await api.post('/auth/login', { email, password });
    await setToken(d.token); setUser(d.user);
  };
  const signup = async (fields: { email: string; password: string; name: string }) => {
    const d = await api.post('/auth/signup', fields);
    await setToken(d.token); setUser(d.user);
  };
  const logout = async () => { await setToken(null); setUser(null); };

  return <Ctx.Provider value={{ user, ready, login, signup, logout }}>{children}</Ctx.Provider>;
}
