import type { SessionMode } from '../../../../shared/types';
import type { ToolDef } from './common';
import { bashTool } from './bash';
import { bashBackgroundTool, bashOutputTool, killProcessTool } from './background';
import { editFileTool, globTool, grepTool, readFileTool, writeFileTool } from './files';
import { gitCommitTool, gitDiffStatTool, gitPushTool } from './git';
import { webFetchTool, webSearchTool } from './web';
import { verifyTool } from './verify';
import { generateMusicTool, extendMusicTool, generateLyricsTool, coverAudioTool } from './music';
import { generateImageTool, generateVideoTool, seeImageTool, textToSpeechTool } from './minimax';
import { generateCreativeTool } from './creative';
import { renderReportTool } from './report';
import { renderChartTool } from './chart';
import { addFontsTool } from './fonts';
import { addUiKitTool } from './ui-kit';
import { publishAppTool } from './publish';
import { generateSpreadsheetTool } from './excel';
import { generateDocTool } from './docx';
import { generatePptxTool } from './pptx';
import { switchModeTool, submitPlanTool } from './mode';
import { fetchDataTool } from './data';
import { fetchAdsTool } from './ads';
import { sendWebhookTool } from './outbound';
import { generateComplianceFileTool } from './compliance';
import { extractPaletteTool } from './palette';
import { validatePaletteTool } from './validatePalette';
import { computeFinancialsTool } from './computeFinancials';

export const ALL_TOOLS: ToolDef[] = [
  webSearchTool,
  webFetchTool,
  generateMusicTool,
  extendMusicTool,
  generateLyricsTool,
  coverAudioTool,
  seeImageTool,
  generateImageTool,
  generateCreativeTool,
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
  renderChartTool,
  addFontsTool,
  addUiKitTool,
  publishAppTool,
  generateSpreadsheetTool,
  generateDocTool,
  generatePptxTool,
  switchModeTool,
  submitPlanTool,
  fetchDataTool,
  fetchAdsTool,
  sendWebhookTool,
  generateComplianceFileTool,
  extractPaletteTool,
  validatePaletteTool,
  computeFinancialsTool,
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
  'generate_creative',
  'add_fonts',
  'render_report',
  'render_chart',
  'generate_spreadsheet',
  'generate_doc',
  'generate_pptx',
  'extract_palette',
  'validate_palette',
  'compute_financials',
  'switch_mode',
  'fetch_data',
  'send_webhook',
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
