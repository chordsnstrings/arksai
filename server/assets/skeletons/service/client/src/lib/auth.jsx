import { createContext, useContext, useEffect, useState } from 'react';
import { api, setToken, getToken } from './api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) { setReady(true); return; }
    api.get('/auth/me').then((d) => setUser(d.user)).catch(() => setToken(null)).finally(() => setReady(true));
  }, []);

  async function login(email, password) {
    const d = await api.post('/auth/login', { email, password });
    setToken(d.token); setUser(d.user);
  }
  async function signup(fields) {
    const d = await api.post('/auth/signup', fields);
    setToken(d.token); setUser(d.user);
  }
  function logout() { setToken(null); setUser(null); }

  return <Ctx.Provider value={{ user, ready, login, signup, logout }}>{children}</Ctx.Provider>;
}
