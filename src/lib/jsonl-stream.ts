import { createReadStream } from 'fs';
import { createInterface } from 'readline';

const MAX_BYTES = parseInt(process.env.BRAGGRID_MAX_RECORD_BYTES ?? '', 10) || 67_108_864;

export async function* streamJsonl(
  filePath: string,
  preFilter?: (line: string) => boolean,
): AsyncGenerator<unknown, void, undefined> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  let lineNum = 0;
  for await (const line of rl) {
    lineNum++;
    if (!line.trim()) continue;
    if (Buffer.byteLength(line) > MAX_BYTES) {
      console.warn(`[braggrid] Skipping oversized record: ${filePath}:${lineNum} (>${MAX_BYTES} bytes)`);
      continue;
    }
    if (preFilter && !preFilter(line)) continue;
    try { yield JSON.parse(line); } catch { /* malformed line */ }
  }
}
