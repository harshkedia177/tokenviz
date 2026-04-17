import chalk from 'chalk';
import { getTheme, isDark } from '../themes.js';
import { formatTokens } from '../stats.js';
import { computeCostSummary, formatCost } from '../pricing.js';
import { MONTH_NAMES, DAY_LABELS, TOOL_COLORS, buildGrid, extractDisplayStats, computeGlobalTotals } from './shared.js';
import type { ToolPanel, Theme, RenderOptions } from '../types.js';

function termText(theme: Theme, themeName: string) {
  if (isDark(themeName)) return chalk.hex(theme.text);
  return chalk.white;
}

function termLabel(theme: Theme, themeName: string) {
  if (isDark(themeName)) return chalk.hex(theme.label);
  return chalk.gray;
}

function getCellColor(tokens: number, maxTokens: number, theme: Theme): string {
  if (!tokens || tokens <= 0) return theme.empty;
  if (maxTokens <= 0) return theme.empty;
  const ratio = tokens / maxTokens;
  if (ratio <= 0.25) return theme.scale[0];
  if (ratio <= 0.50) return theme.scale[1];
  if (ratio <= 0.75) return theme.scale[2];
  return theme.scale[3];
}

const TERMINAL_DAY_LABELS: string[] = DAY_LABELS.map(l => l || '   ');
const BLOCK = '\u2588\u2588';

export function renderTerminal(panels: ToolPanel[], opts: RenderOptions = {}): void {
  const themeName = opts.theme ?? 'green';
  const theme = getTheme(themeName);
  const txt = termText(theme, themeName);
  const lbl = termLabel(theme, themeName);
  const lines: string[] = [];
  const isMultiTool = panels.length > 1;

  lines.push(txt.bold(' tokenviz'));
  if (opts.user) {
    lines.push(lbl(` @${opts.user}`));
  }
  lines.push('');

  if (isMultiTool) {
    const { inputTotal, outputTotal, grandTotal } = computeGlobalTotals(panels);
    lines.push(lbl(` ${inputTotal} in / ${outputTotal} out / ${grandTotal} total`));
    lines.push('');
  }

  for (let p = 0; p < panels.length; p++) {
    const panel = panels[p];
    const { data, stats, capabilities, tool } = panel;
    const ds = extractDisplayStats(stats);
    const { grid, weekMonths, maxTokens, numWeeks } = buildGrid(data, opts.year);
    const toolColor = TOOL_COLORS[tool] || TOOL_COLORS.other;

    if (isMultiTool) {
      lines.push(chalk.hex(toolColor).bold(` \u25CF ${tool.toUpperCase()}`) +
        lbl(`  ${ds.inputTotal} in / ${ds.outputTotal} out`));
    } else {
      lines.push(lbl(` ${ds.inputTotal} in / ${ds.outputTotal} out / ${ds.grandTotal} total`));
    }
    lines.push('');

    if (p === 0) {
      const PREFIX_LEN = 5;
      let monthLine = ' '.repeat(PREFIX_LEN);
      let lastMonth = -1;
      for (let w = 0; w < numWeeks; w++) {
        const expectedPos = PREFIX_LEN + w * 2;
        const m = weekMonths[w];
        if (m !== lastMonth) {
          if (monthLine.length < expectedPos) {
            monthLine += ' '.repeat(expectedPos - monthLine.length);
          }
          monthLine += MONTH_NAMES[m];
          lastMonth = m;
        } else {
          const targetPos = expectedPos + 2;
          if (monthLine.length < targetPos) {
            monthLine += ' '.repeat(targetPos - monthLine.length);
          }
        }
      }
      lines.push(lbl(monthLine));
    }

    for (let row = 0; row < 7; row++) {
      let line = lbl(TERMINAL_DAY_LABELS[row] + ' ');
      for (let w = 0; w < grid[row].length; w++) {
        const cell = grid[row][w];
        const color = getCellColor(cell.tokens, maxTokens, theme);
        line += chalk.hex(color)(BLOCK);
      }
      lines.push(line);
    }
    lines.push('');

    let legend = '     ' + lbl('LESS ');
    legend += chalk.hex(theme.empty)(BLOCK);
    for (const c of theme.scale) {
      legend += chalk.hex(c)(BLOCK);
    }
    legend += lbl(' MORE');
    lines.push(legend);
    lines.push('');

    const gridCharWidth = 5 + numWeeks * 2;
    lines.push(lbl.dim(' ' + '\u2500'.repeat(Math.min(gridCharWidth, 100))));
    lines.push('');

    const COL = 26;
    const statLabel = (s: string): string => lbl(s.padEnd(COL));
    const statValue = (s: string): string => txt.bold(String(s).padEnd(COL));
    const statSub = (s: string): string => lbl(s.padEnd(COL));

    lines.push(
      ' ' +
      statLabel('MOST USED MODEL') +
      statLabel('RECENT (30D)') +
      statLabel('LONGEST STREAK') +
      statLabel('CURRENT STREAK'),
    );
    lines.push(
      ' ' +
      statValue(ds.topModel) +
      statValue(ds.recentModelName) +
      statValue(`${ds.longestStreak} days`) +
      statValue(`${ds.currentStreak} days`),
    );
    lines.push(
      ' ' +
      statSub(`(${formatTokens(ds.topModelTokens)} tokens)`) +
      statSub(`(${formatTokens(ds.recentModelTokens)} tokens)`),
    );
    lines.push('');

    const row2Labels: string[] = [];
    const row2Values: string[] = [];
    if (capabilities.hasPeakHour) {
      row2Labels.push('PEAK HOUR');
      row2Values.push(ds.peakHour);
    }
    row2Labels.push('BUSIEST DAY');
    row2Values.push(ds.busiestDay);
    if (capabilities.hasAvgSession && ds.avgSession !== 'N/A') {
      row2Labels.push('AVG SESSION');
      row2Values.push(ds.avgSession);
    }

    if (row2Labels.length > 0) {
      lines.push(' ' + row2Labels.map(l => statLabel(l)).join(''));
      lines.push(' ' + row2Values.map(v => statValue(v)).join(''));
    }
    lines.push('');

    // Cost breakdown (when --cost flag is used)
    if (opts.showCost) {
      const costSummary = computeCostSummary(data.detailedModelUsage);

      if (costSummary.modelCosts.length > 0) {
        lines.push(lbl.dim(' ' + '\u2500'.repeat(Math.min(gridCharWidth, 100))));
        lines.push('');
        lines.push(txt.bold('  \uD83D\uDCB0 ESTIMATED COST'));
        lines.push('');

        const MODEL_COL = 30;
        const COST_COL = 14;

        lines.push(
          '  ' +
          lbl('MODEL'.padEnd(MODEL_COL)) +
          lbl('INPUT'.padEnd(COST_COL)) +
          lbl('OUTPUT'.padEnd(COST_COL)) +
          lbl('CACHE READ'.padEnd(COST_COL)) +
          lbl('CACHE WRITE'.padEnd(COST_COL)) +
          lbl('TOTAL'),
        );

        for (const mc of costSummary.modelCosts) {
          const modelName = mc.model.length > MODEL_COL - 2
            ? mc.model.slice(0, MODEL_COL - 3) + '\u2026'
            : mc.model;
          lines.push(
            '  ' +
            txt(modelName.padEnd(MODEL_COL)) +
            txt(formatCost(mc.inputCost).padEnd(COST_COL)) +
            txt(formatCost(mc.outputCost).padEnd(COST_COL)) +
            txt(formatCost(mc.cacheReadCost).padEnd(COST_COL)) +
            txt(formatCost(mc.cacheWriteCost).padEnd(COST_COL)) +
            txt.bold(formatCost(mc.totalCost)),
          );
        }

        lines.push('');
        lines.push('  ' + lbl('TOTAL'.padEnd(MODEL_COL)) +
          ''.padEnd(COST_COL * 4) +
          chalk.greenBright.bold(formatCost(costSummary.totalCost)));
        lines.push('');

        lines.push(lbl.dim('  * Estimates based on public API pricing. Actual costs may vary.'));
        lines.push('');
      }
    }

    if (p < panels.length - 1) {
      lines.push('');
    }
  }

  process.stdout.write(lines.join('\n') + '\n');
}
