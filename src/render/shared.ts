import { formatTokens } from '../stats.js';
import type { AggregatedData, Stats, DisplayStats, GridCell, GridResult, ToolPanel } from '../types.js';

export const TOOL_COLORS: Record<string, string> = {
  claude: '#F97316',
  codex: '#3B82F6',
  opencode: '#10B981',
  cursor: '#8B5CF6',
  other: '#6B7280',
};

export const MONTH_NAMES: string[] = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAY_LABELS: string[] = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];

export function getDateRange(year?: number): { start: Date; end: Date } {
  if (year) {
    const start = new Date(Date.UTC(year, 0, 1));
    const dow = start.getUTCDay();
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    start.setUTCDate(start.getUTCDate() + mondayOffset);
    const end = new Date(Date.UTC(year, 11, 31));
    return { start, end };
  }
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 364);
  const dow = start.getUTCDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  start.setUTCDate(start.getUTCDate() + mondayOffset);
  return { start, end };
}

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildGrid(data: AggregatedData, year?: number): GridResult {
  const { start, end } = getDateRange(year);

  const dayTokens = new Map<string, number>();
  for (const day of data.days) {
    const total = (day.inputTokens || 0) + (day.outputTokens || 0);
    dayTokens.set(day.date, total);
  }

  const grid: GridCell[][] = [[], [], [], [], [], [], []];
  const weekMonths: number[] = [];
  let maxTokens = 0;

  const cursor = new Date(start);
  let currentWeek = 0;
  let lastWeekTracked = -1;

  while (cursor <= end) {
    const dateStr = formatDate(cursor);
    const jsDay = cursor.getUTCDay();
    const row = jsDay === 0 ? 6 : jsDay - 1;
    const tokens = dayTokens.get(dateStr) || 0;

    if (tokens > maxTokens) maxTokens = tokens;

    if (row === 0 || currentWeek === 0) {
      if (lastWeekTracked < currentWeek) {
        weekMonths.push(cursor.getUTCMonth());
        lastWeekTracked = currentWeek;
      }
    }

    grid[row].push({ date: dateStr, tokens });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (row === 6) currentWeek++;
  }

  const numWeeks = grid[0].length;
  while (weekMonths.length < numWeeks) {
    weekMonths.push(weekMonths[weekMonths.length - 1] || 0);
  }

  return { grid, weekMonths, maxTokens, numWeeks };
}

export function extractDisplayStats(stats: Stats): DisplayStats {
  return {
    inputTotal: formatTokens(stats.inputTokens || 0),
    outputTotal: formatTokens(stats.outputTokens || 0),
    grandTotal: formatTokens(stats.totalTokens || 0),
    topModel: stats.mostUsedModel?.name || 'N/A',
    topModelTokens: stats.mostUsedModel?.tokens || 0,
    recentModelName: stats.recentModel?.name || 'N/A',
    recentModelTokens: stats.recentModel?.tokens || 0,
    longestStreak: stats.longestStreak || 0,
    currentStreak: stats.currentStreak || 0,
    peakHour: stats.peakHour?.hour || 'N/A',
    busiestDay: stats.busiestDay || 'N/A',
    avgSession: stats.avgSessionMinutes ? `${stats.avgSessionMinutes} min` : 'N/A',
  };
}

export function computeGlobalTotals(panels: ToolPanel[]): { inputTotal: string; outputTotal: string; grandTotal: string } {
  let input = 0;
  let output = 0;
  for (const p of panels) {
    input += p.stats.inputTokens || 0;
    output += p.stats.outputTokens || 0;
  }
  return {
    inputTotal: formatTokens(input),
    outputTotal: formatTokens(output),
    grandTotal: formatTokens(input + output),
  };
}
