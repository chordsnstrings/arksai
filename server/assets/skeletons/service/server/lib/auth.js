import jwt from 'jsonwebtoken';
// The secret is per-deployment: env when provided, else a stable file in data/ so restarts
// don't invalidate sessions (a random in-memory secret would log everyone out on redeploy).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const secretFile = path.join(__dirname, '..', '..', 'data', '.jwt-secret');
function secret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  try { return fs.readFileSync(secretFile, 'utf8'); } catch {}
  const s = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  try { fs.writeFileSync(secretFile, s); } catch {}
  return s;
}
export const signToken = (userId) => jwt.sign({ sub: userId }, secret(), { expiresIn: '30d' });
export function verifyToken(token) {
  try { return jwt.verify(token, secret()).sub; } catch { return null; }
}
