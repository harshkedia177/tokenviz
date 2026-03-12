import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const home = homedir();

export function claudePaths(): string[] {
  const dirs: string[] = [];
  if (process.env.CLAUDE_CONFIG_DIR) dirs.push(process.env.CLAUDE_CONFIG_DIR);
  dirs.push(join(home, '.claude'));
  dirs.push(join(home, '.config', 'claude'));
  return dirs.filter(d => existsSync(d));
}

export interface CodexPaths {
  base: string;
  sessions: string;
  db: string;
}

export function codexPaths(): CodexPaths {
  const base = process.env.CODEX_HOME || join(home, '.codex');
  return { base, sessions: join(base, 'sessions'), db: join(base, 'state_5.sqlite') };
}

export interface OpencodePaths {
  base: string;
  db: string;
  messages: string;
  sessions: string;
}

export function opencodePaths(): OpencodePaths {
  const base = process.env.OPENCODE_DATA_DIR || join(home, '.local', 'share', 'opencode');
  return {
    base,
    db: join(base, 'opencode.db'),
    messages: join(base, 'storage', 'message'),
    sessions: join(base, 'storage', 'session'),
  };
}

export function cursorStatePaths(): string[] {
  if (process.env.CURSOR_STATE_DB_PATH) return [process.env.CURSOR_STATE_DB_PATH];
  const paths: string[] = [];
  if (process.env.CURSOR_CONFIG_DIR) {
    paths.push(join(process.env.CURSOR_CONFIG_DIR, 'User', 'globalStorage', 'state.vscdb'));
  }
  const platform = process.platform;
  if (platform === 'darwin') {
    paths.push(join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb'));
  } else if (platform === 'win32') {
    paths.push(join(process.env.APPDATA || '', 'Cursor', 'User', 'globalStorage', 'state.vscdb'));
  } else {
    paths.push(join(home, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb'));
  }
  return paths.filter(p => existsSync(p));
}
