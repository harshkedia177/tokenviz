import { existsSync, copyFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database, { type Database as DatabaseType } from 'better-sqlite3';

export function openDb(dbPath: string): DatabaseType {
  try {
    return new Database(dbPath, { readonly: true });
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'SQLITE_BUSY' || err.message?.includes('locked') || err.message?.includes('SQLITE_BUSY')) {
      const tmp = mkdtempSync(join(tmpdir(), 'braggrid-'));
      const name = dbPath.split('/').pop()!;
      const tmpDb = join(tmp, name);
      copyFileSync(dbPath, tmpDb);
      for (const ext of ['-shm', '-wal']) {
        const src = dbPath + ext;
        if (existsSync(src)) copyFileSync(src, join(tmp, name + ext));
      }
      const conn = new Database(tmpDb, { readonly: true });
      const originalClose = conn.close.bind(conn);
      conn.close = (() => {
        originalClose();
        try { rmSync(tmp, { recursive: true, force: true }); } catch { /* cleanup best-effort */ }
      }) as typeof conn.close;
      return conn;
    }
    throw e;
  }
}
