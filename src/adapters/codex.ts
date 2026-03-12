import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { codexPaths } from '../lib/paths.js';
import { streamJsonl } from '../lib/jsonl-stream.js';
import { openDb } from '../lib/db-snapshot.js';
import { poolMap } from '../lib/concurrency.js';
import type { DayData, AdapterResult } from '../types.js';

export function detect(): boolean {
  const { sessions, db } = codexPaths();
  return existsSync(sessions) || existsSync(db);
}

function findJsonlFiles(dir: string, yearFilter: number | null): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];

  function walk(current: string): void {
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.jsonl')) {
        files.push(full);
      }
    }
  }

  // If yearFilter, only descend into matching year dirs
  if (yearFilter) {
    const yearDir = join(dir, String(yearFilter));
    if (existsSync(yearDir)) {
      walk(yearDir);
    }
  } else {
    walk(dir);
  }
  return files;
}

function dateFromPath(filePath: string): string | null {
  const match = filePath.match(/sessions\/(\d{4})\/(\d{2})\/(\d{2})\//);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

interface SessionData {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  model: string | null;
}

interface TokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
}

interface ThreadRow {
  created_at: string | number | null;
  updated_at: string | number | null;
  tokens_used?: number | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function normalizeEvent(raw: unknown): { type: string | null; payload: Record<string, unknown> | null } {
  const obj = asRecord(raw);
  if (!obj) return { type: null, payload: null };

  const payload = asRecord(obj.payload);
  if (obj.type === 'event_msg' && payload && typeof payload.type === 'string') {
    return { type: payload.type, payload };
  }

  return {
    type: typeof obj.type === 'string' ? obj.type : null,
    payload,
  };
}

function parseTokenUsage(payload: Record<string, unknown> | null): TokenUsage | null {
  if (!payload) return null;
  const info = asRecord(payload.info);
  const usage = asRecord(info?.total_token_usage);
  return usage as TokenUsage | null;
}

function parseLastTokenUsage(payload: Record<string, unknown> | null): TokenUsage | null {
  if (!payload) return null;
  const info = asRecord(payload.info);
  const usage = asRecord(info?.last_token_usage);
  return usage as TokenUsage | null;
}

function subtractUsage(current: TokenUsage, previous: TokenUsage | null): TokenUsage {
  if (!previous) return current;
  return {
    input_tokens: Math.max(0, (current.input_tokens ?? 0) - (previous.input_tokens ?? 0)),
    cached_input_tokens: Math.max(0, (current.cached_input_tokens ?? 0) - (previous.cached_input_tokens ?? 0)),
    cache_read_input_tokens: Math.max(0, (current.cache_read_input_tokens ?? 0) - (previous.cache_read_input_tokens ?? 0)),
    output_tokens: Math.max(0, (current.output_tokens ?? 0) - (previous.output_tokens ?? 0)),
    reasoning_output_tokens: Math.max(0, (current.reasoning_output_tokens ?? 0) - (previous.reasoning_output_tokens ?? 0)),
  };
}

function parseTimestamp(value: string | number | null): Date | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim() !== '') {
      const ms = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
      const d = new Date(ms);
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function execToRows(db: Awaited<ReturnType<typeof openDb>>, sql: string): ThreadRow[] {
  const result = db.exec(sql);
  if (!result.length) return [];
  const cols = result[0].columns;
  return result[0].values.map(row => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < cols.length; i++) obj[cols[i]] = row[i];
    return obj as unknown as ThreadRow;
  });
}

async function loadThreadRows(dbPath: string): Promise<ThreadRow[]> {
  const db = await openDb(dbPath);
  try {
    try {
      return execToRows(db, 'SELECT created_at, updated_at, tokens_used FROM threads');
    } catch {
      return execToRows(db, 'SELECT created_at, last_active_at AS updated_at, tokens_used FROM threads');
    }
  } finally {
    db.close();
  }
}

async function parseSessionFile(filePath: string): Promise<SessionData> {
  let previousTotals: TokenUsage | null = null;
  let sumInput = 0;
  let sumCached = 0;
  let sumOutput = 0;
  let model: string | null = null;

  const preFilter = (line: string): boolean =>
    line.includes('"token_count"') || line.includes('"turn_context"');

  for await (const raw of streamJsonl(filePath, preFilter)) {
    const { type, payload } = normalizeEvent(raw);
    if (type === 'token_count') {
      const totalUsage = parseTokenUsage(payload);
      const lastUsage = parseLastTokenUsage(payload);

      let delta: TokenUsage | null = null;

      if (totalUsage) {
        const rolledBack = previousTotals && (
          (totalUsage.input_tokens ?? 0) < (previousTotals.input_tokens ?? 0) ||
          (totalUsage.cached_input_tokens ?? 0) < (previousTotals.cached_input_tokens ?? 0) ||
          (totalUsage.output_tokens ?? 0) < (previousTotals.output_tokens ?? 0)
        );

        if (rolledBack) {
          delta = lastUsage ?? totalUsage;
        } else {
          delta = subtractUsage(totalUsage, previousTotals);
        }
        previousTotals = totalUsage;
      } else if (lastUsage) {
        delta = lastUsage;
        // Accumulate into previousTotals
        if (previousTotals) {
          previousTotals = {
            input_tokens: (previousTotals.input_tokens ?? 0) + (lastUsage.input_tokens ?? 0),
            cached_input_tokens: (previousTotals.cached_input_tokens ?? 0) + (lastUsage.cached_input_tokens ?? 0),
            cache_read_input_tokens: (previousTotals.cache_read_input_tokens ?? 0) + (lastUsage.cache_read_input_tokens ?? 0),
            output_tokens: (previousTotals.output_tokens ?? 0) + (lastUsage.output_tokens ?? 0),
            reasoning_output_tokens: (previousTotals.reasoning_output_tokens ?? 0) + (lastUsage.reasoning_output_tokens ?? 0),
          };
        } else {
          previousTotals = { ...lastUsage };
        }
      }

      if (delta) {
        sumInput += (delta.input_tokens ?? 0);
        sumCached += (delta.cached_input_tokens ?? delta.cache_read_input_tokens ?? 0);
        sumOutput += (delta.output_tokens ?? 0) + (delta.reasoning_output_tokens ?? 0);
      }
    } else if (type === 'turn_context' && typeof payload?.model === 'string') {
      model = payload.model;
    }
  }

  return {
    inputTokens: sumInput,
    cachedTokens: sumCached,
    outputTokens: sumOutput,
    model,
  };
}

interface DayEntry {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  sessions: number;
  messages: number;
  models: Record<string, number>;
}

export async function load(yearFilter: number | null): Promise<AdapterResult | null> {
  const { sessions, db } = codexPaths();
  const jsonlFiles = findJsonlFiles(sessions, yearFilter);

  const dayMap = new Map<string, DayEntry>();
  const hourCounts: Record<string, number> = {};
  const modelUsage: Record<string, number> = {};
  let totalSessions = 0;
  let totalMessages = 0;
  let firstDate: string | null = null;
  const sessionDurations: number[] = [];

  if (jsonlFiles.length > 0) {
    const results = await poolMap(jsonlFiles, async (fp: string) => {
      const date = dateFromPath(fp);
      const data = await parseSessionFile(fp);
      return { date, ...data };
    });

    for (const r of results) {
      if (!r.date) continue;
      if (yearFilter && !r.date.startsWith(String(yearFilter))) continue;

      const totalTokens = r.inputTokens + r.cachedTokens + r.outputTokens;
      if (totalTokens === 0 && !r.model) continue;

      if (!dayMap.has(r.date)) {
        dayMap.set(r.date, {
          inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
          sessions: 0, messages: 0, models: {},
        });
      }
      const day = dayMap.get(r.date)!;
      day.inputTokens += r.inputTokens;
      day.outputTokens += r.outputTokens;
      day.cacheReadTokens += r.cachedTokens;
      day.sessions += 1;
      day.messages += 1; // Each file is roughly one session/turn

      if (r.model) {
        day.models[r.model] = (day.models[r.model] || 0) + totalTokens;
        modelUsage[r.model] = (modelUsage[r.model] || 0) + totalTokens;
      }

      totalSessions++;
      totalMessages++;
      if (!firstDate || r.date < firstDate) firstDate = r.date;
    }

    // Supplemental: SQLite for hour distribution + session timing
    if (existsSync(db)) {
      try {
        const rows = await loadThreadRows(db);
        for (const row of rows) {
          const start = parseTimestamp(row.created_at);
          const end = parseTimestamp(row.updated_at);
          if (start) {
            const h = String(start.getHours());
            hourCounts[h] = (hourCounts[h] || 0) + 1;
          }
          if (start && end && end.getTime() > start.getTime()) {
            sessionDurations.push((end.getTime() - start.getTime()) / 1000);
          }
        }
      } catch { /* SQLite unavailable, skip */ }
    }
  } else if (existsSync(db)) {
    // Fallback: SQLite-only mode
    try {
      const rows = await loadThreadRows(db);
      for (const row of rows) {
        const d = parseTimestamp(row.created_at);
        if (!d) continue;
        const date = d.toISOString().slice(0, 10);
        if (yearFilter && !date.startsWith(String(yearFilter))) continue;

        const tokens = row.tokens_used || 0;
        const inputTokens = tokens;
        const outputTokens = 0;

        if (!dayMap.has(date)) {
          dayMap.set(date, {
            inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
            sessions: 0, messages: 0, models: {},
          });
        }
        const day = dayMap.get(date)!;
        day.inputTokens += inputTokens;
        day.outputTokens += outputTokens;
        day.sessions += 1;
        day.messages += 1;

        totalSessions++;
        totalMessages++;
        if (!firstDate || date < firstDate) firstDate = date;

        const h = String(d.getHours());
        hourCounts[h] = (hourCounts[h] || 0) + 1;

        const end = parseTimestamp(row.updated_at);
        if (end && end.getTime() > d.getTime()) {
          sessionDurations.push((end.getTime() - d.getTime()) / 1000);
        }
      }
    } catch {
      return null;
    }
  } else {
    return null;
  }

  if (dayMap.size === 0) return null;

  const days: DayData[] = [];
  for (const [date, data] of dayMap) {
    days.push({
      date,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      cacheReadTokens: data.cacheReadTokens,
      sessions: data.sessions,
      messages: data.messages,
      toolCalls: 0,
      models: data.models,
    });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));

  const avgSessionSeconds = sessionDurations.length
    ? sessionDurations.reduce((a, b) => a + b, 0) / sessionDurations.length
    : 0;

  return {
    tool: 'codex',
    days,
    hourCounts,
    totalSessions,
    totalMessages,
    firstSessionDate: firstDate,
    modelUsage,
    avgSessionSeconds,
  };
}
