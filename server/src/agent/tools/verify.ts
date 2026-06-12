import { verifyProject } from '../verify';
import type { ToolDef } from './common';

export const verifyTool: ToolDef = {
  name: 'verify',
  description:
    "Detect the project's stack and run its checks (typecheck, lint, tests, build). " +
    'Returns pass/fail with output. Run this to confirm your changes actually work ' +
    'before reporting completion.',
  parameters: { type: 'object', properties: {} },
  modes: ['code'],
  summarize: () => 'project checks',
  async run(_args, ctx) {
    const report = await verifyProject(ctx.repoDir, ctx.signal);
    if (!report.ran) return report.summary;
    const detail = report.checks
      .map((c) => `${c.ok ? '✓' : '✗'} ${c.name}\n${c.output || '(no output)'}`)
      .join('\n\n');
    return `${report.summary}\n\n${detail}`;
  },
};
