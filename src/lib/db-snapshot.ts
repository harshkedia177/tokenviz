import { existsSync, readFileSync, copyFileSync, mkdtempSync, rmSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { debug } from './debug.js';

// sql.js loads the entire DB into a WASM buffer via readFileSync.
// Node.js Buffers cap at ~2 GiB, so large DBs need a different approach.
const MAX_SQLJS_BYTES = 2 * 1024 * 1024 * 1024 - 1; // 2 GiB - 1

/**
 * Minimal interface matching the sql.js Database methods we use.
 * Adapters only call db.exec(sql) and db.close().
 */
export interface DbHandle {
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  close(): void;
}

/**
 * Fallback 1: Node's built-in sqlite module (available since Node 22.5).
 * Works on all platforms including Windows — no extra install needed.
 */
function openWithNodeSqlite(dbPath: string): DbHandle | null {
  try {
    // Dynamic import to avoid crashing on Node < 22.5
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    debug('db: file > 2 GiB, using node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });

    return {
      exec(sql: string): Array<{ columns: string[]; values: unknown[][] }> {
        const stmt = db.prepare(sql);
        const rows = stmt.all() as Record<string, unknown>[];
        if (rows.length === 0) return [];

        const columns = Object.keys(rows[0]);
        const values = rows.map((row: Record<string, unknown>) => columns.map(c => row[c]));
        return [{ columns, values }];
      },
      close() { db.close(); },
    };
  } catch {
    debug('db: node:sqlite not available');
    return null;
  }
}

/**
 * Fallback 2: shell out to the sqlite3 CLI.
 * Available by default on macOS and most Linux distros.
 */
function openWithSqliteCli(dbPath: string): DbHandle | null {
  try {
    execFileSync('sqlite3', ['--version'], { encoding: 'utf-8', timeout: 5_000 });
  } catch {
    debug('db: sqlite3 CLI not available');
    return null;
  }

  debug('db: file > 2 GiB, using sqlite3 CLI');
  return {
    exec(sql: string): Array<{ columns: string[]; values: unknown[][] }> {
      let raw: string;
      try {
        raw = execFileSync('sqlite3', ['-json', '-readonly', dbPath, sql], {
          encoding: 'utf-8',
          timeout: 30_000,
          maxBuffer: 50 * 1024 * 1024,
        });
      } catch {
        // Older sqlite3 builds may not support -json; fall back to tab-separated
        debug('db: sqlite3 -json failed, trying tab-separated mode');
        raw = execFileSync('sqlite3', ['-separator', '\t', '-header', '-readonly', dbPath, sql], {
          encoding: 'utf-8',
          timeout: 30_000,
          maxBuffer: 50 * 1024 * 1024,
        });
        return parseTsv(raw);
      }

      raw = raw.trim();
      if (!raw || raw === '[]') return [];

      const rows = JSON.parse(raw) as Record<string, unknown>[];
      if (rows.length === 0) return [];

      const columns = Object.keys(rows[0]);
      const values = rows.map(row => columns.map(c => row[c]));
      return [{ columns, values }];
    },
    close() { /* noop */ },
  };
}

function parseTsv(raw: string): Array<{ columns: string[]; values: unknown[][] }> {
  const lines = raw.trim().split('\n');
  if (lines.length < 1) return [];

  const columns = lines[0].split('\t');
  const values: unknown[][] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    values.push(lines[i].split('\t'));
  }
  if (values.length === 0) return [];
  return [{ columns, values }];
}

/**
 * Open a large DB (> 2 GiB) using the best available fallback.
 * Priority: node:sqlite → sqlite3 CLI → error
 */
function openLargeDb(dbPath: string): DbHandle {
  const handle = openWithNodeSqlite(dbPath) || openWithSqliteCli(dbPath);
  if (handle) return handle;

  throw new Error(
    'Database file exceeds 2 GiB. Upgrade to Node.js 22.5+ (recommended) ' +
    'or install the sqlite3 CLI (brew install sqlite3 / apt install sqlite3).',
  );
}

export async function openDb(dbPath: string): Promise<DbHandle> {
  // Check file size before attempting sql.js
  try {
    const size = statSync(dbPath).size;
    if (size > MAX_SQLJS_BYTES) {
      return openLargeDb(dbPath);
    }
  } catch { /* statSync failed — let readFileSync surface the error below */ }

  const SQL = await initSqlJs();

  try {
    const buf = readFileSync(dbPath);
    return new SQL.Database(buf);
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'EBUSY' || err.message?.includes('locked') || err.message?.includes('SQLITE_BUSY')) {
      const tmp = mkdtempSync(join(tmpdir(), 'tokenviz-'));
      const name = dbPath.split('/').pop()!;
      const tmpDb = join(tmp, name);
      copyFileSync(dbPath, tmpDb);
      for (const ext of ['-shm', '-wal']) {
        const src = dbPath + ext;
        if (existsSync(src)) copyFileSync(src, join(tmp, name + ext));
      }
      const buf = readFileSync(tmpDb);
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* cleanup best-effort */ }
      return new SQL.Database(buf);
    }

    // File might be > 2 GiB but statSync didn't catch it; try fallbacks
    if (err.message?.includes('2 GiB') || err.message?.includes('too large') || err.code === 'ERR_FS_FILE_TOO_LARGE') {
      return openLargeDb(dbPath);
    }

    throw e;
  }
}
