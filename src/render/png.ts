import sharp from 'sharp';
import { writeFileSync } from 'fs';

const PNG_SCALE = 4;

interface SvgToPngOptions {
  background?: string;
}

export async function svgToPng(svgString: string, outputPath?: string, opts: SvgToPngOptions = {}): Promise<Buffer> {
  const wMatch = svgString.match(/width="(\d+)"/);
  const targetWidth = wMatch
    ? parseInt(wMatch[1], 10) * PNG_SCALE
    : 4000;

  const bg = opts.background || '#1a1a2e';

  const pngBuffer = await sharp(Buffer.from(svgString), { density: 192 })
    .resize({ width: targetWidth })
    .flatten({ background: bg })
    .png()
    .toBuffer();

  if (outputPath) writeFileSync(outputPath, pngBuffer);
  return pngBuffer;
}
