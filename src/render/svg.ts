import { getTheme } from '../themes.js';
import { formatTokens } from '../stats.js';
import { MONTH_NAMES, DAY_LABELS, TOOL_COLORS, buildGrid, extractDisplayStats, computeGlobalTotals } from './shared.js';
import type { ToolPanel, Theme, GridResult, RenderOptions } from '../types.js';

const CELL_SIZE = 11;
const CELL_GAP = 2;
const CELL_RADIUS = 3;
const MARGIN = { left: 60, right: 20 };
const PANEL_GAP = 20;
const BOTTOM_PAD = 10;

const HEATMAP_GAMMA = 0.7;

function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getCellColor(tokens: number, maxTokens: number, theme: Theme): string {
  if (!tokens || tokens <= 0) return theme.empty;
  if (maxTokens <= 0) return theme.empty;
  const scaled = Math.pow(tokens / maxTokens, HEATMAP_GAMMA);
  const index = Math.ceil(scaled * (theme.scale.length - 1));
  return theme.scale[Math.min(Math.max(index, 0), theme.scale.length - 1)];
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '\u2026';
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  cursor: 'Cursor',
};

function renderPanel(
  parts: string[],
  panel: ToolPanel,
  gridResult: GridResult,
  yOffset: number,
  gridWidth: number,
  numWeeks: number,
  step: number,
  theme: Theme,
  isMultiTool: boolean,
  showMonthLabels: boolean = true,
): number {
  const { stats, capabilities, tool } = panel;
  const ds = extractDisplayStats(stats);
  const { grid, weekMonths, maxTokens } = gridResult;
  const gridHeight = 7 * step - CELL_GAP;

  let y = yOffset;

  if (isMultiTool) {
    const toolColor = TOOL_COLORS[tool] || TOOL_COLORS.other;
    const displayName = TOOL_DISPLAY_NAMES[tool] || tool;
    const dotX = MARGIN.left - 8;
    parts.push(`<circle cx="${dotX}" cy="${y + 6}" r="4" fill="${toolColor}" />`);
    parts.push(`<text x="${MARGIN.left}" y="${y + 10}" style="font-size: 13px; font-weight: 700; fill: ${theme.text}; letter-spacing: 0.3px;" dominant-baseline="auto">${escapeXml(displayName)}</text>`);
    y += 32;
  }

  if (showMonthLabels) {
    let lastMonth = -1;
    for (let w = 0; w < numWeeks; w++) {
      const m = weekMonths[w];
      if (m !== lastMonth) {
        const x = MARGIN.left + w * step;
        parts.push(`<text x="${x}" y="${y}" class="label">${escapeXml(MONTH_NAMES[m])}</text>`);
        lastMonth = m;
      }
    }
    y += 14;
  }

  for (let row = 0; row < 7; row++) {
    if (DAY_LABELS[row]) {
      const labelY = y + row * step + CELL_SIZE / 2;
      parts.push(`<text x="${MARGIN.left - 8}" y="${labelY}" class="label" text-anchor="end" dominant-baseline="middle">${escapeXml(DAY_LABELS[row])}</text>`);
    }
  }

  for (let row = 0; row < 7; row++) {
    for (let w = 0; w < grid[row].length; w++) {
      const cell = grid[row][w];
      const color = getCellColor(cell.tokens, maxTokens, theme);
      const cx = MARGIN.left + w * step;
      const cy = y + row * step;
      parts.push(`<rect x="${cx}" y="${cy}" width="${CELL_SIZE}" height="${CELL_SIZE}" rx="${CELL_RADIUS}" ry="${CELL_RADIUS}" fill="${color}"><title>${escapeXml(cell.date)}: ${cell.tokens.toLocaleString()} tokens</title></rect>`);
    }
  }
  y += gridHeight;

  y += 12;
  let legendX = MARGIN.left;
  const legendCenterY = y + CELL_SIZE / 2 + 1;
  parts.push(`<text x="${legendX}" y="${legendCenterY}" class="label" dominant-baseline="central">LESS</text>`);
  legendX += 35;
  const legendColors = [theme.empty, ...theme.scale];
  for (const color of legendColors) {
    parts.push(`<rect x="${legendX}" y="${y}" width="${CELL_SIZE}" height="${CELL_SIZE}" rx="${CELL_RADIUS}" ry="${CELL_RADIUS}" fill="${color}" />`);
    legendX += step;
  }
  parts.push(`<text x="${legendX + 4}" y="${legendCenterY}" class="label" dominant-baseline="central">MORE</text>`);
  y += CELL_SIZE;

  y += 10;
  parts.push(`<line x1="${MARGIN.left}" y1="${y}" x2="${MARGIN.left + gridWidth}" y2="${y}" stroke="${theme.label}" stroke-opacity="0.15" stroke-width="1" />`);
  y += 18;

  const colWidth = gridWidth / 4;
  const statsRow1 = [
    { label: 'MOST USED MODEL', value: truncate(ds.topModel, 20), sub: formatTokens(ds.topModelTokens) + ' tokens' },
    { label: 'RECENT (30D)', value: truncate(ds.recentModelName, 20), sub: formatTokens(ds.recentModelTokens) + ' tokens' },
    { label: 'LONGEST STREAK', value: `${ds.longestStreak} days`, sub: '' },
    { label: 'CURRENT STREAK', value: `${ds.currentStreak} days`, sub: '' },
  ];

  for (let i = 0; i < statsRow1.length; i++) {
    const x = MARGIN.left + i * colWidth;
    const s = statsRow1[i];
    parts.push(`<text x="${x}" y="${y}" class="small-label" dominant-baseline="hanging">${escapeXml(s.label)}</text>`);
    parts.push(`<text x="${x}" y="${y + 14}" class="value" dominant-baseline="hanging">${escapeXml(s.value)}</text>`);
    if (s.sub) {
      parts.push(`<text x="${x}" y="${y + 30}" class="stat-sub" dominant-baseline="hanging">${escapeXml(s.sub)}</text>`);
    }
  }
  y += 46;

  const row2: { label: string; value: string }[] = [];
  if (capabilities.hasPeakHour) row2.push({ label: 'PEAK HOUR', value: ds.peakHour });
  row2.push({ label: 'BUSIEST DAY', value: ds.busiestDay });
  if (capabilities.hasAvgSession && ds.avgSession !== 'N/A') row2.push({ label: 'AVG SESSION', value: ds.avgSession });

  if (row2.length > 0) {
    for (let i = 0; i < row2.length; i++) {
      const x = MARGIN.left + i * colWidth;
      const s = row2[i];
      parts.push(`<text x="${x}" y="${y}" class="small-label" dominant-baseline="hanging">${escapeXml(s.label)}</text>`);
      parts.push(`<text x="${x}" y="${y + 14}" class="value" dominant-baseline="hanging">${escapeXml(s.value)}</text>`);
    }
    y += 30;
  }

  return y - yOffset;
}

export function renderSVG(panels: ToolPanel[], opts: RenderOptions = {}): string {
  const theme = getTheme(opts.theme ?? 'green');
  const user = opts.user ? truncate(opts.user, 24) : null;
  const fontFamily = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  const isMultiTool = panels.length > 1;

  const step = CELL_SIZE + CELL_GAP;
  const panelGrids = panels.map(p => buildGrid(p.data, opts.year));
  const { numWeeks } = panelGrids[0];
  const gridWidth = numWeeks * step - CELL_GAP;
  const totalWidth = MARGIN.left + gridWidth + MARGIN.right;

  const parts: string[] = [];

  parts.push(`<style>
    text { font-family: ${fontFamily}; }
    .title { font-size: 20px; font-weight: 700; fill: ${theme.text}; }
    .subtitle { font-size: 13px; fill: ${theme.label}; }
    .small-label { font-size: 9px; font-weight: 600; fill: ${theme.label}; text-transform: uppercase; letter-spacing: 0.5px; }
    .value { font-size: 14px; font-weight: 600; fill: ${theme.text}; }
    .label { font-size: 10px; fill: ${theme.label}; }
    .stat-sub { font-size: 10px; fill: ${theme.label}; }
    .metric-label { font-size: 9px; font-weight: 600; fill: ${theme.label}; text-transform: uppercase; letter-spacing: 0.5px; }
    .metric-value { font-size: 16px; font-weight: 700; fill: ${theme.text}; }
  </style>`);

  let y = 0;
  parts.push(`<text x="${MARGIN.left}" y="26" class="title" dominant-baseline="auto">${escapeXml('tokenburn')}</text>`);
  if (user) {
    parts.push(`<text x="${MARGIN.left}" y="44" class="subtitle" dominant-baseline="auto">@${escapeXml(user)}</text>`);
    y = 64;
  } else {
    y = 50;
  }

  const { inputTotal, outputTotal, grandTotal } = isMultiTool
    ? computeGlobalTotals(panels)
    : extractDisplayStats(panels[0].stats);

  const metricColWidth = gridWidth / 3;
  parts.push(`<text x="${MARGIN.left}" y="${y}" class="metric-label" dominant-baseline="hanging">INPUT</text>`);
  parts.push(`<text x="${MARGIN.left}" y="${y + 13}" class="metric-value" dominant-baseline="hanging">${escapeXml(inputTotal)}</text>`);
  parts.push(`<text x="${MARGIN.left + metricColWidth}" y="${y}" class="metric-label" dominant-baseline="hanging">OUTPUT</text>`);
  parts.push(`<text x="${MARGIN.left + metricColWidth}" y="${y + 13}" class="metric-value" dominant-baseline="hanging">${escapeXml(outputTotal)}</text>`);
  parts.push(`<text x="${MARGIN.left + metricColWidth * 2}" y="${y}" class="metric-label" dominant-baseline="hanging">TOTAL</text>`);
  parts.push(`<text x="${MARGIN.left + metricColWidth * 2}" y="${y + 13}" class="metric-value" dominant-baseline="hanging">${escapeXml(grandTotal)}</text>`);
  y += 42;

  for (let i = 0; i < panels.length; i++) {
    if (i > 0) y += PANEL_GAP;
    const showMonths = i === 0;
    const panelHeight = renderPanel(parts, panels[i], panelGrids[i], y, gridWidth, numWeeks, step, theme, isMultiTool, showMonths);
    y += panelHeight;
  }

  y += BOTTOM_PAD;

  const now = new Date();
  const generatedAt = `Generated at ${now.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`;
  parts.push(`<text x="${MARGIN.left + gridWidth}" y="${y}" class="label" text-anchor="end" dominant-baseline="auto" opacity="0.5">${escapeXml(generatedAt)}</text>`);
  y += 14;

  const totalHeight = y;

  const header = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">`;
  const bg = `<rect x="-2" y="-2" width="${totalWidth + 4}" height="${totalHeight + 4}" rx="12" fill="${theme.bg}" />`;

  return [header, parts[0], bg, ...parts.slice(1), '</svg>'].join('\n');
}
