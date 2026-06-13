import type { SessionMode } from '../../../../shared/types';
import type { ToolDef } from './common';
import { bashTool } from './bash';
import { bashBackgroundTool, bashOutputTool, killProcessTool } from './background';
import { editFileTool, globTool, grepTool, readFileTool, writeFileTool } from './files';
import { gitCommitTool, gitDiffStatTool, gitPushTool } from './git';
import { webFetchTool, webSearchTool } from './web';
import { verifyTool } from './verify';
import { generateMusicTool } from './music';
import { generateImageTool, generateVideoTool, seeImageTool, textToSpeechTool } from './minimax';
import { renderReportTool } from './report';
import { addFontsTool } from './fonts';
import { addUiKitTool } from './ui-kit';

export const ALL_TOOLS: ToolDef[] = [
  webSearchTool,
  webFetchTool,
  generateMusicTool,
  seeImageTool,
  generateImageTool,
  textToSpeechTool,
  generateVideoTool,
  bashTool,
  bashBackgroundTool,
  bashOutputTool,
  killProcessTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  globTool,
  grepTool,
  verifyTool,
  gitDiffStatTool,
  gitCommitTool,
  gitPushTool,
  renderReportTool,
  addFontsTool,
  addUiKitTool,
];

// Report mode gets a curated toolset: read/synthesize data, research, render,
// and (when keyed) generate/inspect visuals — but no git/verify/code plumbing.
const REPORT_TOOLS = new Set([
  'read_file',
  'write_file',
  'edit_file',
  'glob',
  'grep',
  'bash',
  'web_search',
  'web_fetch',
  'see_image',
  'generate_image',
  'add_fonts',
  'render_report',
]);

export interface ToolSet {
  schemas: {
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }[];
  map: Map<string, ToolDef>;
}

/**
 * Plan mode tools are a read-only subset — write tools are absent from the
 * schema list entirely, so the model can't even attempt them.
 */
export function getToolsForMode(mode: SessionMode): ToolSet {
  const tools = ALL_TOOLS.filter(
    (t) =>
      (mode === 'report' ? REPORT_TOOLS.has(t.name) : t.modes.includes(mode)) &&
      (!t.available || t.available()),
  );
  return {
    schemas: tools.map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    })),
    map: new Map(tools.map((t) => [t.name, t])),
  };
}
