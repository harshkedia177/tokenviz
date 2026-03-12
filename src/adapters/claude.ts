import { existsSync, readFileSync, readdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { claudePaths } from '../lib/paths.js';
import { poolMap } from '../lib/concurrency.js';
import type { DayData, AdapterResult } from '../types.js';

const FILE_CONCURRENCY = parseInt(process.env.BRAGGRID_CONCURRENCY ?? '', 10) || 32;

function findJsonlFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findJsonlFiles(fullPath));
      } else if (entry.name.endsWith('.jsonl')) {
        results.push(fullPath);
      }
    }
  } catch { /* permission errors etc */ }
  return results;
}

function loadJson(dirs: string[], filename: string): Record<string, unknown> | null {
  for (const dir of dirs) {
    const fp = join(dir, filename);
    if (existsSync(fp)) {
      try {
        return JSON.parse(readFileSync(fp, 'utf-8'));
      } catch { /* skip malformed */ }
    }
  }
  return null;
}

interface DayAccum {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  models: Record<string, number>;
  hours: Record<number, number>;
  sessions: Set<string>;
  messages: number;
}

export function detect(): boolean {
  const dirs = claudePaths();
  return dirs.some(d =>
    existsSync(join(d, 'projects')) ||
    existsSync(join(d, 'stats-cache.json')) ||
    existsSync(join(d, 'readout-cost-cache.json')),
  );
}

function extractHour(timestamp: string): number {
  // Match HH after the 'T' in ISO format: 2026-03-12T13:00:00...
  const tIdx = timestamp.indexOf('T');
  if (tIdx !== -1 && tIdx + 3 <= timestamp.length) {
    const h = parseInt(timestamp.slice(tIdx + 1, tIdx + 3), 10);
    if (h >= 0 && h <= 23) return h;
  }
  return new Date(timestamp).getHours();
}

interface ParsedRecord {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  model: string;
  hour: number;
  sessionId?: string;
}

/**
 * Parse a JSONL file, keeping only the last streaming snapshot per requestId.
 * Returns deduplicated records ready for accumulation.
 */
function parseLines(content: string, yearPrefix: string | null): Map<string, ParsedRecord> {
  // Map from requestId → last (most complete) parsed record
  const lastByRequest = new Map<string, ParsedRecord>();
  // Records without a requestId (can't dedup, accumulate directly)
  const anonymousRecords: ParsedRecord[] = [];

  let pos = 0;
  while (pos < content.length) {
    const nlIdx = content.indexOf('\n', pos);
    const line = nlIdx === -1 ? content.slice(pos) : content.slice(pos, nlIdx);
    pos = nlIdx === -1 ? content.length : nlIdx + 1;

    if (!line.includes('"usage"')) continue;

    try {
      const record = JSON.parse(line);
      const msg = record.message;
      const usage = msg?.usage;
      const timestamp = record.timestamp;
      if (!usage || !timestamp) continue;

      const model = msg.model;
      if (!model || model === '<synthetic>') continue;

      const date = timestamp.slice(0, 10);
      if (yearPrefix && !date.startsWith(yearPrefix)) continue;

      const inputTokens = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
      const outputTokens = usage.output_tokens || 0;
      const cacheReadTokens = usage.cache_read_input_tokens || 0;

      if (inputTokens + outputTokens + cacheReadTokens === 0) continue;

      const parsed: ParsedRecord = {
        date, inputTokens, outputTokens, cacheReadTokens, model,
        hour: extractHour(timestamp),
        sessionId: record.sessionId,
      };

      const reqId = record.requestId || '';
      if (reqId) {
        // Overwrite — last occurrence has final/complete usage
        lastByRequest.set(reqId, parsed);
      } else {
        anonymousRecords.push(parsed);
      }
    } catch { /* skip malformed lines */ }
  }

  // Combine: keyed records (deduped within file) + anonymous records (with synthetic keys)
  const result = new Map(lastByRequest);
  for (let i = 0; i < anonymousRecords.length; i++) {
    result.set(`_anon_${i}`, anonymousRecords[i]);
  }
  return result;
}

/**
 * Accumulate parsed records into a DayAccum map, skipping cross-file duplicates.
 */
function accumulateRecords(records: Map<string, ParsedRecord>, dayMap: Map<string, DayAccum>, seenRequests: Set<string>): void {
  for (const [key, rec] of records) {
    // Cross-file dedup: skip if this requestId was already counted from another file
    if (!key.startsWith('_anon_') && seenRequests.has(key)) continue;
    if (!key.startsWith('_anon_')) seenRequests.add(key);

    let entry = dayMap.get(rec.date);
    if (!entry) {
      entry = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, models: {}, hours: {}, sessions: new Set(), messages: 0 };
      dayMap.set(rec.date, entry);
    }
    entry.inputTokens += rec.inputTokens;
    entry.outputTokens += rec.outputTokens;
    entry.cacheReadTokens += rec.cacheReadTokens;

    const modelTotal = rec.inputTokens + rec.cacheReadTokens + rec.outputTokens;
    entry.models[rec.model] = (entry.models[rec.model] || 0) + modelTotal;
    entry.messages += 1;
    entry.hours[rec.hour] = (entry.hours[rec.hour] || 0) + 1;

    if (rec.sessionId) entry.sessions.add(rec.sessionId);
  }
}


async function loadFromJsonl(dirs: string[], yearFilter: number | null): Promise<AdapterResult | null> {
  const yearPrefix = yearFilter ? String(yearFilter) : null;

  const allFiles: string[] = [];
  for (const dir of dirs) {
    const projectsDir = join(dir, 'projects');
    if (!existsSync(projectsDir)) continue;
    allFiles.push(...findJsonlFiles(projectsDir));
  }

  if (allFiles.length === 0) return null;

  // Phase 1: Parse each file concurrently, keeping last record per requestId within each file
  const fileParsed = await poolMap(
    allFiles,
    async (file) => {
      try {
        const content = await readFile(file, 'utf-8');
        return parseLines(content, yearPrefix);
      } catch {
        return new Map<string, ParsedRecord>();
      }
    },
    FILE_CONCURRENCY,
  );

  // Phase 2: Accumulate into dayMap, deduping requestIds across files
  const dayMap = new Map<string, DayAccum>();
  const seenRequests = new Set<string>();
  for (const parsed of fileParsed) {
    if (parsed.size > 0) accumulateRecords(parsed, dayMap, seenRequests);
  }

  if (dayMap.size === 0) return null;

  const days: DayData[] = [];
  const hourCounts: Record<string, number> = {};
  const modelUsage: Record<string, number> = {};
  let totalSessions = 0;
  let totalMessages = 0;
  let firstDate: string | null = null;

  for (const [date, entry] of dayMap) {
    days.push({
      date,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheReadTokens: entry.cacheReadTokens,
      sessions: entry.sessions.size,
      messages: entry.messages,
      toolCalls: 0,
      models: entry.models,
    });

    totalSessions += entry.sessions.size;
    totalMessages += entry.messages;
    if (!firstDate || date < firstDate) firstDate = date;

    for (const [hour, count] of Object.entries(entry.hours)) {
      hourCounts[hour] = (hourCounts[hour] || 0) + count;
    }
    for (const [model, tokens] of Object.entries(entry.models)) {
      modelUsage[model] = (modelUsage[model] || 0) + tokens;
    }
  }

  return {
    tool: 'claude',
    days,
    hourCounts,
    totalSessions,
    totalMessages,
    firstSessionDate: firstDate,
    modelUsage,
    avgSessionSeconds: 0,
  };
}

function loadFromCache(dirs: string[], yearFilter: number | null): AdapterResult | null {
  const costCache = loadJson(dirs, 'readout-cost-cache.json') as Record<string, unknown> | null;
  if (!costCache) return null;

  const costDays = costCache.days as Record<string, Record<string, Record<string, number>>> | undefined;
  if (!costDays) return null;

  const days: DayData[] = [];
  const modelUsage: Record<string, number> = {};
  let firstDate: string | null = null;

  for (const [date, models] of Object.entries(costDays)) {
    if (yearFilter && !date.startsWith(String(yearFilter))) continue;

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    const dayModels: Record<string, number> = {};

    for (const [modelId, usage] of Object.entries(models)) {
      const input = usage.input || 0;
      const output = usage.output || 0;
      const cacheRead = usage.cacheRead || 0;
      const cacheWrite = usage.cacheWrite || 0;
      inputTokens += input + cacheWrite;
      outputTokens += output;
      cacheReadTokens += cacheRead;
      const modelTotal = input + cacheWrite + cacheRead + output;
      dayModels[modelId] = (dayModels[modelId] || 0) + modelTotal;
    }

    days.push({ date, inputTokens, outputTokens, cacheReadTokens, sessions: 0, messages: 0, toolCalls: 0, models: dayModels });
    if (!firstDate || date < firstDate) firstDate = date;

    for (const [model, tokens] of Object.entries(dayModels)) {
      modelUsage[model] = (modelUsage[model] || 0) + tokens;
    }
  }

  if (days.length === 0) return null;

  return {
    tool: 'claude',
    days,
    hourCounts: {},
    totalSessions: 0,
    totalMessages: 0,
    firstSessionDate: firstDate,
    modelUsage,
    avgSessionSeconds: 0,
  };
}

function loadFromStatsCache(dirs: string[], yearFilter: number | null): AdapterResult | null {
  const raw = loadJson(dirs, 'stats-cache.json');
  if (!raw) return null;

  const statsCache = raw.statsCache as Record<string, { models?: Record<string, Record<string, number>> }> | undefined;
  if (!statsCache) return null;

  const days: DayData[] = [];
  const modelUsage: Record<string, number> = {};
  let firstDate: string | null = null;

  for (const [date, entry] of Object.entries(statsCache)) {
    if (yearFilter && !date.startsWith(String(yearFilter))) continue;
    if (!entry.models) continue;

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    const dayModels: Record<string, number> = {};

    for (const [modelId, usage] of Object.entries(entry.models)) {
      const input = (usage.inputTokens || 0) + (usage.cacheCreationTokens || 0);
      const output = usage.outputTokens || 0;
      const cacheRead = usage.cacheReadTokens || 0;
      inputTokens += input;
      outputTokens += output;
      cacheReadTokens += cacheRead;
      const modelTotal = input + cacheRead + output;
      dayModels[modelId] = (dayModels[modelId] || 0) + modelTotal;
    }

    if (inputTokens + outputTokens + cacheReadTokens === 0) continue;

    days.push({ date, inputTokens, outputTokens, cacheReadTokens, sessions: 0, messages: 0, toolCalls: 0, models: dayModels });
    if (!firstDate || date < firstDate) firstDate = date;

    for (const [model, tokens] of Object.entries(dayModels)) {
      modelUsage[model] = (modelUsage[model] || 0) + tokens;
    }
  }

  if (days.length === 0) return null;

  return {
    tool: 'claude',
    days,
    hourCounts: {},
    totalSessions: 0,
    totalMessages: 0,
    firstSessionDate: firstDate,
    modelUsage,
    avgSessionSeconds: 0,
  };
}

export async function load(yearFilter: number | null): Promise<AdapterResult | null> {
  const dirs = claudePaths();
  if (!dirs.length) return null;

  const jsonlResult = await loadFromJsonl(dirs, yearFilter);
  if (jsonlResult) return jsonlResult;

  // Try stats-cache.json (more detailed than readout-cost-cache)
  const statsCacheResult = loadFromStatsCache(dirs, yearFilter);
  if (statsCacheResult) return statsCacheResult;

  // Fallback to readout-cost-cache.json
  return loadFromCache(dirs, yearFilter);
}
