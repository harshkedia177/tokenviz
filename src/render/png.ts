import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'fs';

interface SvgToPngOptions {
  background?: string;
}

export async function svgToPng(svgString: string, outputPath?: string, opts: SvgToPngOptions = {}): Promise<Buffer> {
  const bg = opts.background || '#1a1a2e';

  const resvg = new Resvg(svgString, {
    background: bg,
    fitTo: { mode: 'width', value: 4000 },
  });

  const rendered = resvg.render();
  const pngBuffer = Buffer.from(rendered.asPng());

  if (outputPath) writeFileSync(outputPath, pngBuffer);
  return pngBuffer;
}
