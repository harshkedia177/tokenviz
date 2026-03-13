import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { cursorStatePaths } from '../lib/paths.js';
import { openDb } from '../lib/db-snapshot.js';
import { debug } from '../lib/debug.js';
import type { DayData, AdapterResult } from '../types.js';

export function detect(): boolean {
  return cursorStatePaths().length > 0;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf-8'));
  } catch {
    return null;
  }
}

async function extractAccessToken(dbPath: string): Promise<string | null> {
  try {
    debug(`cursor: opening DB ${dbPath}`);
    const db = await openDb(dbPath);
    try {
      const result = db.exec(
        "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'",
      );
      if (result.length > 0 && result[0].values.length > 0) {
        const token = (result[0].values[0][0] as string) || null;
        debug(`cursor: access token ${token ? `found (${token.length} chars)` : 'is empty'}`);
        return token;
      }
      debug('cursor: no access token row found in ItemTable');
      return null;
    } finally {
      db.close();
    }
  } catch (err) {
    debug(`cursor: failed to read access token: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function fetchUsageCsv(accessToken: string): Promise<string | null> {
  const url = 'https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens';

  const strategies: Array<{ label: string; headers: Record<string, string> }> = [];
  const seen = new Set<string>();
  const jwtPayload = decodeJwtPayload(accessToken);
  const sub = typeof jwtPayload?.sub === 'string' ? jwtPayload.sub.trim() : null;

  const cookieValues = [accessToken];
  if (sub) cookieValues.push(`${sub}::${accessToken}`);

  function addStrategy(label: string, headers: Record<string, string>): void {
    const key = JSON.stringify(headers);
    if (seen.has(key)) return;
    seen.add(key);
    strategies.push({ label, headers });
  }

  // Bearer only
  addStrategy('bearer', { Authorization: `Bearer ${accessToken}` });

  // Cookie variants
  for (const cookieValue of cookieValues) {
    addStrategy('cookie', { Cookie: `WorkosCursorSessionToken=${cookieValue}` });
    addStrategy('cookie-encoded', { Cookie: `WorkosCursorSessionToken=${encodeURIComponent(cookieValue)}` });
    // Combined bearer+cookie
    addStrategy('bearer+cookie', {
      Authorization: `Bearer ${accessToken}`,
      Cookie: `WorkosCursorSessionToken=${cookieValue}`,
    });
    addStrategy('bearer+cookie-encoded', {
      Authorization: `Bearer ${accessToken}`,
      Cookie: `WorkosCursorSessionToken=${encodeURIComponent(cookieValue)}`,
    });
  }

  debug(`cursor: trying ${strategies.length} auth strategies against API`);
  for (const opts of strategies) {
    try {
      debug(`cursor: trying strategy '${opts.label}'`);
      const res = await fetch(url, {
        method: 'GET',
        headers: { ...opts.headers, Accept: 'text/csv' },
        signal: AbortSignal.timeout(10_000),
      });
      debug(`cursor: strategy '${opts.label}' → HTTP ${res.status}`);
      if (res.ok) {
        const text = await res.text();
        // Validate it looks like CSV: must have a comma-separated header row
        const firstLine = text.split('\n')[0] || '';
        // Check for at least 2 comma-separated fields and a known column name
        const hasComma = firstLine.includes(',');
        const hasKnownColumn = /\b(Date|Model|Tokens|Total Tokens|Output Tokens)\b/.test(firstLine);
        if (hasComma && hasKnownColumn) {
          const lineCount = text.split('\n').filter(l => l.trim()).length;
          debug(`cursor: API returned valid CSV (${lineCount} lines)`);
          return text;
        }
        debug(`cursor: response is not valid CSV (header: "${firstLine.slice(0, 80)}")`);
      }
    } catch (err) {
      debug(`cursor: strategy '${opts.label}' failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  debug('cursor: all API strategies failed, will try local stats');
  return null;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote inside quoted field
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

interface DayEntry {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  sessions: number;
  messages: number;
  models: Record<string, number>;
}

function parseCsv(csv: string, yearFilter: number | null): { days: DayData[]; modelUsage: Record<string, number>; hourCounts: Record<string, number> } {
  const lines = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) return { days: [], modelUsage: {}, hourCounts: {} };

  const header = parseCsvLine(lines[0]);
  const colIdx = (name: string): number => header.indexOf(name);

  const dateIdx = colIdx('Date');
  const modelIdx = colIdx('Model');
  const inputNoCacheIdx = colIdx('Input (w/o Cache Write)');
  const inputWithCacheIdx = colIdx('Input (w/ Cache Write)');
  const cacheReadIdx = colIdx('Cache Read');
  const outputIdx = colIdx('Output Tokens');
  const legacyTokensIdx = colIdx('Tokens');
  const totalTokensIdx = colIdx('Total Tokens');

  const dayMap = new Map<string, DayEntry>();
  const modelUsage: Record<string, number> = {};

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < header.length) continue;

    const rawDate = cols[dateIdx];
    if (!rawDate) continue;
    const date = rawDate.slice(0, 10);
    if (yearFilter && !date.startsWith(String(yearFilter))) continue;

    let rawModel = cols[modelIdx] || 'unknown';
    rawModel = rawModel.replace(/^(?:[a-z]{2}\.)?(?:anthropic|amazon|google|meta|mistral|openai)\./i, '');
    // Strip trailing -YYYYMMDD date suffixes
    rawModel = rawModel.replace(/-\d{8}$/, '');
    // Strip version suffixes like -v2:0
    rawModel = rawModel.replace(/-v\d+:\d+$/, '');

    const num = (idx: number): number => (idx >= 0 && cols[idx]) ? (parseInt(cols[idx], 10) || 0) : 0;

    let inputTokens = 0;
    let outputTokens = num(outputIdx);
    let cacheReadTokens = num(cacheReadIdx);

    if (inputNoCacheIdx >= 0) {
      inputTokens = num(inputNoCacheIdx);
    } else if (inputWithCacheIdx >= 0) {
      inputTokens = num(inputWithCacheIdx);
    }

    // Legacy fallback: single "Tokens" column
    if (inputTokens === 0 && outputTokens === 0 && legacyTokensIdx >= 0) {
      const total = num(legacyTokensIdx);
      inputTokens = Math.round(total * 0.7);
      outputTokens = Math.round(total * 0.3);
    }

    let totalTokens: number;
    const rawTotal = totalTokensIdx >= 0 ? num(totalTokensIdx) : 0;
    if (rawTotal > 0) {
      totalTokens = rawTotal;
    } else {
      totalTokens = inputTokens + outputTokens + cacheReadTokens;
    }

    if (!dayMap.has(date)) {
      dayMap.set(date, {
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
        sessions: 0, messages: 0, models: {},
      });
    }
    const day = dayMap.get(date)!;
    day.inputTokens += inputTokens;
    day.outputTokens += outputTokens;
    day.cacheReadTokens += cacheReadTokens;
    day.messages += 1;

    day.models[rawModel] = (day.models[rawModel] || 0) + totalTokens;
    modelUsage[rawModel] = (modelUsage[rawModel] || 0) + totalTokens;
  }

  // Count unique days as sessions
  for (const day of dayMap.values()) {
    day.sessions = 1;
  }

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

  return { days, modelUsage, hourCounts: {} };
}

async function loadLocalStats(dbPath: string, yearFilter: number | null): Promise<{ days: DayData[]; modelUsage: Record<string, number> } | null> {
  try {
    debug(`cursor: loading local stats from ${dbPath}`);
    const db = await openDb(dbPath);
    try {
      const result = db.exec(
        "SELECT key, value FROM ItemTable WHERE key LIKE 'aiCodeTracking.dailyStats.v1.5.%'",
      );

      if (!result.length || !result[0].values.length) {
        debug('cursor: no local dailyStats rows found');
        return null;
      }
      debug(`cursor: found ${result[0].values.length} local dailyStats rows`);

      const days: DayData[] = [];
      for (const row of result[0].values) {
        const value = row[1] as string;
        if (!value) continue;
        try {
          const data = JSON.parse(value) as Record<string, unknown>;
          const date = data.date as string | undefined;
          if (!date) continue;
          if (yearFilter && !date.startsWith(String(yearFilter))) continue;

          // Convert lines to pseudo-tokens (1 line ~ 50 tokens)
          const totalLines = ((data.tabAcceptedLines as number) || 0) + ((data.composerAcceptedLines as number) || 0);
          const pseudoTokens = totalLines * 50;

          days.push({
            date,
            inputTokens: Math.round(pseudoTokens * 0.7),
            outputTokens: Math.round(pseudoTokens * 0.3),
            cacheReadTokens: 0,
            sessions: 1,
            messages: totalLines > 0 ? 1 : 0,
            toolCalls: 0,
            models: {},
          });
        } catch { /* skip malformed */ }
      }

      days.sort((a, b) => a.date.localeCompare(b.date));
      debug(`cursor: local stats produced ${days.length} days`);
      return { days, modelUsage: {} };
    } finally {
      db.close();
    }
  } catch (err) {
    debug(`cursor: loadLocalStats failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function loadHourlyDistribution(): Promise<Record<string, number>> {
  const dbPath = join(homedir(), '.cursor', 'ai-tracking', 'ai-code-tracking.db');
  if (!existsSync(dbPath)) {
    debug(`cursor: hourly DB not found at ${dbPath}`);
    return {};
  }

  try {
    const db = await openDb(dbPath);
    try {
      const result = db.exec(
        `SELECT CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch', 'localtime')) AS INTEGER) AS hour,
                COUNT(*) AS cnt
         FROM ai_code_hashes
         GROUP BY hour`,
      );
      const hourCounts: Record<string, number> = {};
      if (result.length > 0) {
        for (const row of result[0].values) {
          hourCounts[String(row[0])] = row[1] as number;
        }
      }
      return hourCounts;
    } finally {
      db.close();
    }
  } catch (err) {
    debug(`cursor: loadHourlyDistribution failed: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}

export async function load(yearFilter: number | null): Promise<AdapterResult | null> {
  const dbPaths = cursorStatePaths();
  debug(`cursor: state DB paths: ${dbPaths.length > 0 ? dbPaths.join(', ') : '(none found)'}`);
  if (!dbPaths.length) return null;

  let days: DayData[] = [];
  let modelUsage: Record<string, number> = {};
  let hourCounts: Record<string, number> = {};
  let usedApi = false;

  for (const dbPath of dbPaths) {
    const accessToken = await extractAccessToken(dbPath);
    if (!accessToken) continue;

    const csv = await fetchUsageCsv(accessToken);
    if (csv) {
      const parsed = parseCsv(csv, yearFilter);
      days = parsed.days;
      modelUsage = parsed.modelUsage;
      hourCounts = parsed.hourCounts;
      usedApi = true;
      break;
    }
  }

  if (!usedApi || days.length === 0) {
    for (const dbPath of dbPaths) {
      const local = await loadLocalStats(dbPath, yearFilter);
      if (local && local.days.length > 0) {
        days = local.days;
        modelUsage = local.modelUsage;
        break;
      }
    }
  }

  if (!days.length) return null;

  // Supplemental: hourly distribution
  const supplementalHours = await loadHourlyDistribution();
  hourCounts = { ...supplementalHours, ...hourCounts };

  let totalSessions = 0;
  let totalMessages = 0;
  let firstDate: string | null = null;

  for (const d of days) {
    totalSessions += d.sessions;
    totalMessages += d.messages;
    if (!firstDate || d.date < firstDate) firstDate = d.date;
  }

  return {
    tool: 'cursor',
    days,
    hourCounts,
    totalSessions,
    totalMessages,
    firstSessionDate: firstDate,
    modelUsage,
    avgSessionSeconds: 0,
  };
}
