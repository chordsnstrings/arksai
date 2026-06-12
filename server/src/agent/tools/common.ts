import fs from 'node:fs';
import path from 'node:path';
import type { SessionMeta, SessionMode } from '../../../../shared/types';
import { config } from '../../config';

export interface ToolCtx {
  session: SessionMeta;
  repoDir: string;
  mode: SessionMode;
  signal: AbortSignal;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema
  modes: SessionMode[];
  summarize(args: any): string;
  run(args: any, ctx: ToolCtx): Promise<string>;
}

export class ToolError extends Error {}

/**
 * Resolve a user/model-supplied path strictly inside the workspace repo dir.
 * Blocks `..` traversal and symlink escapes.
 */
export function resolveInWorkspace(repoDir: string, p: string): string {
  // Unrestricted mode: resolve relative paths against the repo but allow
  // anywhere (absolute paths, .. escapes) for open-ended operation.
  if (config.agentUnrestricted) {
    return path.resolve(repoDir, p);
  }
  const realRoot = fs.existsSync(repoDir) ? fs.realpathSync(repoDir) : path.resolve(repoDir);
  const abs = path.resolve(realRoot, p);

  // realpath the deepest existing ancestor so symlinks can't smuggle us out
  let probe = abs;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const realProbe = fs.realpathSync(probe);
  const resolved = path.join(realProbe, path.relative(probe, abs));

  if (resolved !== realRoot && !resolved.startsWith(realRoot + path.sep)) {
    throw new ToolError(`Path "${p}" is outside the workspace. Use paths relative to the repo root.`);
  }
  return resolved;
}
