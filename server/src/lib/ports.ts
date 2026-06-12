import fs from 'node:fs';

/**
 * Listening TCP ports from /proc/net/tcp{,6} (no ss/netstat needed).
 * State 0A = LISTEN; local address is hex IP:PORT.
 */
export function listeningPorts(exclude: number[] = []): number[] {
  const skip = new Set(exclude);
  const ports = new Set<number>();
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 4 || cols[3] !== '0A') continue;
      const port = parseInt(cols[1].split(':')[1], 16);
      if (port > 0 && port < 65536 && !skip.has(port)) ports.add(port);
    }
  }
  return [...ports].sort((a, b) => a - b);
}
