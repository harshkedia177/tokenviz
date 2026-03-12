import { existsSync, readdirSync, readFileSync } from 'fs';
import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import { opencodePaths } from '../lib/paths.js';
import { openDb } from '../lib/db-snapshot.js';
import { poolMap } from '../lib/concurrency.js';
import type { DayData, AdapterResult } from '../types.js';

const MAX_BYTES = parseInt(process.env.BRAGGRID_MAX_RECORD_BYTES || '', 10) || 67_108_864;

interface ParsedMessage {
  id?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string | null;
  timestamp: number | null;
}

export function detect(): boolean {
  const { db, messages } = opencodePaths();
  return existsSync(db) || existsSync(messages);
}

function parseMessageData(data: Record<string, unknown>): ParsedMessage | null {
  if (!data) return null;

  const tokens = (data.tokens || {}) as Record<string, unknown>;
  const inputTokens = (tokens.input as number) || 0;
  const outputTokens = (tokens.output as number) || 0;
  const cache = (tokens.cache || {}) as Record<string, number>;
  const cacheReadTokens = cache.read || 0;
  const cacheWriteTokens = cache.write || 0;

  if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0) return null;

  const model = (data.modelID as string) || null;
  const time = (data.time || {}) as Record<string, unknown>;
  const timestamp = time.created ? Number(time.created) : null;

  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, model, timestamp };
}

async function loadFromDb(dbPath: string): Promise<ParsedMessage[]> {
  const db = await openDb(dbPath);
  const messages: ParsedMessage[] = [];
  try {
    const result = db.exec('SELECT id, data FROM message ORDER BY time_created ASC');
    if (!result.length) return messages;
    const seenIds = new Set<string>();
    for (const row of result[0].values) {
      const id = row[0] as string;
      const rawData = row[1];
      if (!rawData) continue;
      if (id && seenIds.has(id)) continue;
      const raw = typeof rawData === 'string' ? rawData : String(rawData);
      if (Buffer.byteLength(raw) > MAX_BYTES) continue;
      try {
        const data = JSON.parse(raw) as Record<string, unknown>;
        const parsed = parseMessageData(data);
        if (parsed) {
          parsed.id = id;
          messages.push(parsed);
          if (id) seenIds.add(id);
        }
      } catch { /* skip malformed */ }
    }
  } finally {
    db.close();
  }
  return messages;
}

async function loadFromFiles(messagesDir: string): Promise<ParsedMessage[]> {
  if (!existsSync(messagesDir)) return [];

  const files: string[] = [];
  function walk(dir: string): void {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.json')) {
        files.push(full);
      }
    }
  }
  walk(messagesDir);

  const results = await poolMap(files, async (fp: string) => {
    try {
      const st = await stat(fp);
      if (st.size > MAX_BYTES) return null;
      const raw = await readFile(fp, 'utf-8');
      const data = JSON.parse(raw) as Record<string, unknown>;
      return parseMessageData(data);
    } catch { return null; }
  });

  return results.filter((r): r is ParsedMessage => r !== null);
}

function loadSessionTiming(sessionsDir: string): { durations: number[]; firstDate: string | null } {
  const durations: number[] = [];
  let firstDate: string | null = null;
  if (!existsSync(sessionsDir)) return { durations, firstDate };

  function walk(dir: string): void {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.json')) {
        try {
          const raw = readFileSync(full, 'utf-8');
          const data = JSON.parse(raw) as Record<string, unknown>;
          const time = (data.time || {}) as Record<string, unknown>;
          const created = time.created;
          const updated = time.updated;
          if (created) {
            const d = new Date(typeof created === 'number' ? created : Number(created));
            const dateStr = d.toISOString().slice(0, 10);
            if (!firstDate || dateStr < firstDate) firstDate = dateStr;
            if (updated) {
              const end = new Date(typeof updated === 'number' ? updated : Number(updated));
              const dur = (end.getTime() - d.getTime()) / 1000;
              if (dur > 0) durations.push(dur);
            }
          }
        } catch { /* skip */ }
      }
    }
  }
  walk(sessionsDir);
  return { durations, firstDate };
}

interface DayMapEntry {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  sessions: Set<string>;
  messages: number;
  models: Record<string, number>;
}

export async function load(yearFilter: number | null): Promise<AdapterResult | null> {
  const paths = opencodePaths();

  let messages: ParsedMessage[] = [];
  if (existsSync(paths.db)) {
    try {
      messages = await loadFromDb(paths.db);
    } catch {
      // Fallback to file-based loading
      messages = await loadFromFiles(paths.messages);
    }
  } else {
    messages = await loadFromFiles(paths.messages);
  }

  if (!messages.length) return null;

  const dayMap = new Map<string, DayMapEntry>();
  const hourCounts: Record<string, number> = {};
  const modelUsage: Record<string, number> = {};
  let totalMessages = 0;

  const seen = new Set<string>();
  for (const msg of messages) {
    if (msg.id && seen.has(msg.id)) continue;
    if (msg.id) seen.add(msg.id);
    if (!msg.timestamp) continue;
    const d = new Date(msg.timestamp);
    if (isNaN(d.getTime())) continue;
    const date = d.toISOString().slice(0, 10);
    if (yearFilter && !date.startsWith(String(yearFilter))) continue;

    if (!dayMap.has(date)) {
      dayMap.set(date, {
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
        sessions: new Set(), messages: 0, models: {},
      });
    }
    const day = dayMap.get(date)!;
    day.inputTokens += msg.inputTokens;
    day.outputTokens += msg.outputTokens;
    day.cacheReadTokens += msg.cacheReadTokens;
    day.messages += 1;
    totalMessages++;

    if (msg.model) {
      const totalTok = msg.inputTokens + msg.outputTokens + msg.cacheReadTokens;
      day.models[msg.model] = (day.models[msg.model] || 0) + totalTok;
      modelUsage[msg.model] = (modelUsage[msg.model] || 0) + totalTok;
    }

    const h = String(d.getHours());
    hourCounts[h] = (hourCounts[h] || 0) + 1;
  }

  if (dayMap.size === 0) return null;

  const { durations, firstDate: sessionFirstDate } = loadSessionTiming(paths.sessions);

  let firstDate: string | null = null;
  for (const date of dayMap.keys()) {
    if (!firstDate || date < firstDate) firstDate = date;
  }
  if (sessionFirstDate && (!firstDate || sessionFirstDate < firstDate)) {
    firstDate = sessionFirstDate;
  }

  // Count sessions as unique days (rough estimate without session IDs from messages)
  const totalSessions = dayMap.size;

  const days: DayData[] = [];
  for (const [date, data] of dayMap) {
    days.push({
      date,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      cacheReadTokens: data.cacheReadTokens,
      sessions: 1, // One session aggregate per day from message data
      messages: data.messages,
      toolCalls: 0,
      models: data.models,
    });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));

  const avgSessionSeconds = durations.length
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0;

  return {
    tool: 'opencode',
    days,
    hourCounts,
    totalSessions,
    totalMessages,
    firstSessionDate: firstDate,
    modelUsage,
    avgSessionSeconds,
  };
}
