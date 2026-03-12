import * as claude from './adapters/claude.js';
import * as codex from './adapters/codex.js';
import * as opencode from './adapters/opencode.js';
import * as cursor from './adapters/cursor.js';
import { computeStats } from './stats.js';
import type { Adapter, AdapterResult, AggregatedData, DayData, ToolCapabilities, ToolPanel } from './types.js';

const adapters: Record<string, Adapter> = { claude, codex, opencode, cursor };

const CAPABILITIES: Record<string, ToolCapabilities> = {
  claude:   { hasAvgSession: false, hasPeakHour: true },
  codex:    { hasAvgSession: true,  hasPeakHour: true },
  opencode: { hasAvgSession: true,  hasPeakHour: true },
  cursor:   { hasAvgSession: false, hasPeakHour: true },
};

interface ModelTokenValue {
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Resolve a model usage value to a plain token number.
 * Claude adapter stores `{ inputTokens, outputTokens, ... }` objects;
 * other adapters store plain numbers.
 */
function resolveModelTokens(value: number | ModelTokenValue): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    return (value.inputTokens || 0) + (value.outputTokens || 0);
  }
  return 0;
}

/**
 * Convert a single adapter result to AggregatedData.
 */
function toAggregatedData(name: string, result: AdapterResult): AggregatedData {
  const days: DayData[] = result.days.map(day => {
    const models: Record<string, number> = {};
    if (day.models) {
      for (const [model, value] of Object.entries(day.models)) {
        models[model] = resolveModelTokens(value as number | ModelTokenValue);
      }
    }
    return { ...day, models };
  });
  days.sort((a, b) => a.date.localeCompare(b.date));

  const modelUsage: Record<string, number> = {};
  if (result.modelUsage) {
    for (const [model, value] of Object.entries(result.modelUsage)) {
      modelUsage[model] = resolveModelTokens(value as number | ModelTokenValue);
    }
  }

  return {
    days,
    sources: [name],
    hourCounts: result.hourCounts || {},
    totalSessions: result.totalSessions || 0,
    totalMessages: result.totalMessages || 0,
    firstSessionDate: result.firstSessionDate || null,
    modelUsage,
    avgSessionSeconds: result.avgSessionSeconds || 0,
  };
}

/**
 * Load data from each selected tool independently, returning a ToolPanel per tool.
 */
export async function aggregateMulti(opts: { tools?: string[]; year?: number } = {}): Promise<ToolPanel[]> {
  const { year } = opts;

  let adapterNames: string[];
  if (opts.tools && opts.tools.length > 0) {
    for (const t of opts.tools) {
      if (!adapters[t]) {
        throw new Error(`Unknown tool: ${t}. Valid tools: ${Object.keys(adapters).join(', ')}`);
      }
    }
    adapterNames = opts.tools;
  } else {
    adapterNames = Object.keys(adapters).filter(name => adapters[name].detect());
  }

  const explicit = opts.tools && opts.tools.length > 0;

  const results = await Promise.all(
    adapterNames.map(async (name) => {
      try {
        const result = await adapters[name].load(year ?? null);
        if (!result) return null;
        const data = toAggregatedData(name, result);
        const stats = computeStats(data);
        // Skip tools with no actual token data (unless explicitly requested)
        if (!explicit && stats.totalTokens === 0) return null;
        const capabilities = CAPABILITIES[name] || { hasAvgSession: false, hasPeakHour: false };
        return { tool: name, data, stats, capabilities } as ToolPanel;
      } catch {
        return null;
      }
    }),
  );

  return results.filter((r): r is ToolPanel => r !== null);
}
