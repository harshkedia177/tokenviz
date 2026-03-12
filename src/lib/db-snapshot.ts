import { existsSync, readFileSync, copyFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';

export async function openDb(dbPath: string): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs();

  try {
    const buf = readFileSync(dbPath);
    return new SQL.Database(buf);
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'EBUSY' || err.message?.includes('locked') || err.message?.includes('SQLITE_BUSY')) {
      const tmp = mkdtempSync(join(tmpdir(), 'tokenburn-'));
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
    throw e;
  }
}
