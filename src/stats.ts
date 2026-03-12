import type { AggregatedData, Stats } from './types.js';

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatHour(hour: number): string {
  if (hour === 0) return '12:00 AM';
  if (hour === 12) return '12:00 PM';
  if (hour < 12) return `${hour}:00 AM`;
  return `${hour - 12}:00 PM`;
}

function computeStreaks(activeDates: Set<string>): { currentStreak: number; longestStreak: number } {
  if (activeDates.size === 0) return { currentStreak: 0, longestStreak: 0 };

  // Current streak: count backward from today
  // Use local date to match how adapter dates are stored (YYYY-MM-DD local)
  const today = new Date();
  let currentStreak = 0;
  for (let i = 0; ; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (activeDates.has(dateStr)) {
      currentStreak++;
    } else {
      break;
    }
  }

  // Longest streak: sort all dates and scan for max consecutive run
  const sorted = [...activeDates].sort();
  let longestStreak = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diffMs = curr.getTime() - prev.getTime();
    const diffDays = Math.round(diffMs / 86_400_000);
    if (diffDays === 1) {
      run++;
      if (run > longestStreak) longestStreak = run;
    } else {
      run = 1;
    }
  }

  return { currentStreak, longestStreak };
}

export function computeStats(data: AggregatedData): Stats {
  const { days, hourCounts, modelUsage, totalSessions, totalMessages, avgSessionSeconds } = data;

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  const dowCounts: number[] = [0, 0, 0, 0, 0, 0, 0];
  const activeDates = new Set<string>();

  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentCutoff = thirtyDaysAgo.toISOString().slice(0, 10);
  const allTimeModelTokens: Record<string, number> = {};
  const recentModelTokens: Record<string, number> = {};

  for (const day of days) {
    inputTokens += day.inputTokens || 0;
    outputTokens += day.outputTokens || 0;
    cacheReadTokens += day.cacheReadTokens || 0;

    const dayTotal = (day.inputTokens || 0) + (day.outputTokens || 0);
    if (dayTotal > 0) {
      activeDates.add(day.date);
    }

    const d = new Date(day.date + 'T00:00:00');
    if (!isNaN(d.getTime())) {
      dowCounts[d.getDay()] += dayTotal;
    }

    if (day.models) {
      for (const [model, tokens] of Object.entries(day.models)) {
        allTimeModelTokens[model] = (allTimeModelTokens[model] || 0) + tokens;
        if (day.date >= recentCutoff) {
          recentModelTokens[model] = (recentModelTokens[model] || 0) + tokens;
        }
      }
    }
  }

  const effectiveInput = inputTokens + cacheReadTokens;
  const totalTokens = effectiveInput + outputTokens;

  // Compute most used model from daily data so it's consistent with totalTokens
  let mostUsedModel: { name: string; tokens: number } | null = null;
  for (const [name, tokens] of Object.entries(allTimeModelTokens)) {
    if (tokens > 0 && (!mostUsedModel || tokens > mostUsedModel.tokens)) {
      mostUsedModel = { name, tokens };
    }
  }

  let recentModel: { name: string; tokens: number } | null = null;
  for (const [name, tokens] of Object.entries(recentModelTokens)) {
    if (tokens > 0 && (!recentModel || tokens > recentModel.tokens)) {
      recentModel = { name, tokens };
    }
  }

  const { currentStreak, longestStreak } = computeStreaks(activeDates);

  let peakHour: { hour: string; count: number } | null = null;
  if (hourCounts) {
    for (const [hour, count] of Object.entries(hourCounts)) {
      if (count > 0 && (!peakHour || count > peakHour.count)) {
        peakHour = { hour: formatHour(Number(hour)), count };
      }
    }
  }

  const maxDow = Math.max(...dowCounts);
  let busiestDay: string | null = null;
  if (maxDow > 0) {
    const busiestDayIdx = dowCounts.indexOf(maxDow);
    busiestDay = WEEKDAY_NAMES[busiestDayIdx];
  }

  const avgSessionMinutes = avgSessionSeconds ? Math.round(avgSessionSeconds / 60) : 0;

  return {
    inputTokens: effectiveInput,
    outputTokens,
    cacheReadTokens,
    totalTokens,
    mostUsedModel,
    recentModel,
    currentStreak,
    longestStreak,
    totalSessions,
    totalMessages,
    peakHour,
    busiestDay,
    dowCounts,
    avgSessionMinutes,
  };
}
