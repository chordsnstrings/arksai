import { detectStartCommand, verifyProject } from '../verify';
import { probeApp } from '../runtimeCheck';
import { processRegistry } from '../processes';
import type { ToolDef } from './common';

export const verifyTool: ToolDef = {
  name: 'verify',
  description:
    "Verify the project end-to-end: run its checks (typecheck, lint, tests, build) AND, if it's " +
    'a runnable app, boot it, seed real data into its endpoints, and confirm a create→read-back ' +
    'flow works. Run this to prove your changes actually work before reporting completion.',
  parameters: { type: 'object', properties: {} },
  modes: ['code'],
  summarize: () => 'project + runtime checks',
  async run(_args, ctx) {
    const report = await verifyProject(ctx.repoDir, ctx.signal);
    const parts: string[] = [];
    if (report.ran) {
      const detail = report.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.name}\n${c.output || '(no output)'}`).join('\n\n');
      parts.push(`Static checks: ${report.summary}\n\n${detail}`);
      if (!report.ok) return parts.join('\n\n'); // fix static first
    } else {
      parts.push(report.summary);
    }

    const startCmd = detectStartCommand(ctx.repoDir);
    if (startCmd) {
      processRegistry.killAllForSession(ctx.session.id);
      const probe = await probeApp(ctx.session.id, ctx.repoDir, startCmd, ctx.signal);
      parts.push(`Runtime check:\n${probe.detail}`);
    }
    return parts.join('\n\n');
  },
};
