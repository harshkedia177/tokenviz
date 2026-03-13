let enabled = false;

export function setVerbose(on: boolean): void {
  enabled = on;
}

export function verbose(): boolean {
  return enabled;
}

export function debug(msg: string): void {
  if (enabled) console.error(`[debug] ${msg}`);
}
