import { setTimeout as delay } from 'node:timers/promises';
import { processRegistry } from '../processes';
import { protectedCommand } from './bash';
import type { ToolDef } from './common';

export const bashBackgroundTool: ToolDef = {
  name: 'bash_background',
  description:
    'Start a long-running command (dev server, watcher, build daemon) in the background. ' +
    'Unlike bash, it keeps running across tool calls and messages. Returns a process id — ' +
    'check its logs with bash_output and stop it with kill_process. Use this to start a ' +
    'server, then verify it with normal bash (e.g. curl).',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command to run in the background' },
      name: { type: 'string', description: 'Optional short label, e.g. "dev server"' },
    },
    required: ['command'],
  },
  modes: ['code'],
  summarize: (args) => String(args.command ?? '').slice(0, 120),
  async run(args, ctx) {
    const command = String(args.command ?? '');
    if (!command.trim()) return 'Error: empty command';
    const blocked = protectedCommand(command);
    if (blocked) return blocked;
    let proc;
    try {
      proc = processRegistry.start(ctx.session.id, command, ctx.repoDir, args.name);
    } catch (err: any) {
      return `Error: ${err.message}`;
    }
    // Give it a moment so the model sees startup output (or an instant crash).
    await delay(1500);
    const status = processRegistry.describe(proc);
    const logs = processRegistry.tail(proc.id, 30);
    return `Started ${status}\nInitial output:\n${logs || '(no output yet)'}`;
  },
};

export const bashOutputTool: ToolDef = {
  name: 'bash_output',
  description:
    'Get the status and recent log output of a background process started with bash_background.',
  parameters: {
    type: 'object',
    properties: {
      process_id: { type: 'string', description: 'The process id, e.g. "p1"' },
      lines: { type: 'number', description: 'How many log lines to return (default 50)' },
    },
    required: ['process_id'],
  },
  modes: ['plan', 'code'],
  summarize: (args) => String(args.process_id ?? ''),
  async run(args, ctx) {
    const proc = processRegistry.get(String(args.process_id ?? ''));
    if (!proc || proc.sessionId !== ctx.session.id) {
      const list = processRegistry
        .listForSession(ctx.session.id)
        .map((p) => processRegistry.describe(p));
      return `Error: unknown process. ${list.length ? `Known: \n${list.join('\n')}` : 'No background processes in this session.'}`;
    }
    const logs = processRegistry.tail(proc.id, Number(args.lines) || 50);
    return `${processRegistry.describe(proc)}\n---\n${logs || '(no output)'}`;
  },
};

export const killProcessTool: ToolDef = {
  name: 'kill_process',
  description: 'Stop a background process started with bash_background.',
  parameters: {
    type: 'object',
    properties: {
      process_id: { type: 'string', description: 'The process id, e.g. "p1"' },
    },
    required: ['process_id'],
  },
  modes: ['code'],
  summarize: (args) => String(args.process_id ?? ''),
  async run(args, ctx) {
    const proc = processRegistry.get(String(args.process_id ?? ''));
    if (!proc || proc.sessionId !== ctx.session.id) return 'Error: unknown process id';
    if (proc.exited) return `${processRegistry.describe(proc)} — already exited.`;
    processRegistry.kill(proc.id);
    return `Killed [${proc.id}] ${proc.name}.`;
  },
};
