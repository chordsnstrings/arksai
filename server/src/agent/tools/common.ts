import fs from 'node:fs';
import path from 'node:path';
import type { SessionMeta, SessionMode } from '../../../../shared/types';
import { config } from '../../config';

export interface ToolCtx {
  session: SessionMeta;
  repoDir: string;
  mode: SessionMode;
  signal: AbortSignal;
  /** Report external-engine spend (e.g. Suno) so it's added to the session cost. */
  addCost: (usd: number) => void;
  /** Switch this session's mode mid-run (the runner reloads tools/prompt/engine). */
  requestModeSwitch?: (mode: SessionMode) => void;
  /** Plan mode: hand the build plan to the user for Approve/Revise — ends the turn. */
  submitPlan?: () => void;
  /** True when THIS run is the user's response to a pending plan (lets plan→code through). */
  planResolved?: boolean;
  /** True when THIS run is the user's "Approve & build" → build now, don't re-submit the plan. */
  planApproved?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema
  modes: SessionMode[];
  /** Optional gate — e.g. an engine tool only available when its key is set. */
  available?: () => boolean;
  /** Appended to the "tool arguments were not valid JSON" error — the recovery move for
   *  THIS tool. Models mangle JSON exactly when a payload is too big; tell them the small
   *  alternative instead of letting them retry the same giant payload or abandon the tool
   *  (live: 3× bad-JSON generate_spreadsheet calls → the agent fell back to openpyxl). */
  badJsonHint?: string;
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
