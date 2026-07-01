import { config } from '../../config';
import { recordCheckpoint } from '../checkpoint';
import type { ToolDef } from './common';

export const checkpointTool: ToolDef = {
  name: 'checkpoint',
  description:
    'Save a durable CHECKPOINT after completing a discrete, working milestone in a LONG/complex build: ' +
    'it commits the current workspace state so the whole build is RESUMABLE if the run is interrupted, ' +
    'and records the milestone. Call it after each meaningful task that works (e.g. "data model + ' +
    'migrations", "auth API", "login screen") — NOT for tiny edits. This lets a big build proceed ' +
    'task-by-task and recover from an interruption without redoing finished work.',
  parameters: {
    type: 'object',
    properties: { task: { type: 'string', description: 'The milestone you just completed (e.g. "database schema + migrations").' } },
    required: ['task'],
  },
  modes: ['code'],
  available: () => config.checkpointBuilds,
  summarize: (args) => `checkpoint: ${String(args?.task ?? '').slice(0, 60)}`,
  async run(args, ctx) {
    const task = String(args?.task ?? '').trim();
    if (!task) return 'Error: describe the milestone you completed (e.g. "auth API done").';
    const r = await recordCheckpoint(ctx.repoDir, task);
    return r.ok
      ? `Checkpoint saved: "${task}" (${r.sha}). The build is resumable from here — continue with the next task.`
      : `Checkpoint had trouble committing: ${r.output.slice(0, 200)}`;
  },
};
