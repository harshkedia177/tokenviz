import { program, InvalidArgumentError } from 'commander';
import { aggregateMulti } from './aggregator.js';
import { renderTerminal } from './render/terminal.js';
import { renderSVG } from './render/svg.js';
import { svgToPng } from './render/png.js';
import { copyImageToClipboard } from './clipboard.js';
import { getAllThemeNames, getBgColor } from './themes.js';
import { setVerbose } from './lib/debug.js';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { createInterface } from 'readline';

function getTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function confirmSave(filePath: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => {
    rl.question(`Save to ${filePath}? (y/n) `, (answer) => {
      rl.close();
      res(answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes');
    });
  });
}

interface CLIOptions {
  claude?: boolean;
  codex?: boolean;
  opencode?: boolean;
  cursor?: boolean;
  user?: string;
  theme: string;
  export: string | false;
  out?: string;
  copy?: boolean;
  year?: number;
  json?: boolean;
  listThemes?: boolean;
  verbose?: boolean;
}

program
  .name('tokenviz')
  .description('Shareable heatmap of your AI coding tool usage')
  .version('0.2.0')
  .option('--claude', 'Include Claude Code data')
  .option('--codex', 'Include Codex data')
  .option('--opencode', 'Include OpenCode data')
  .option('--cursor', 'Include Cursor data')
  .option('--user <name>', 'Username to display')
  .option('--theme <name>', 'Color theme (see --list-themes)', 'green')
  .option('--export <format>', 'Export format: png, svg', 'png')
  .option('--no-export', 'Skip file export')
  .option('--out <path>', 'Custom output file path')
  .option('--copy', 'Copy image to clipboard')
  .option('--year <year>', 'Filter to specific year', (v: string) => {
    const n = parseInt(v, 10);
    if (isNaN(n) || n < 2000 || n > 2100) {
      throw new InvalidArgumentError('must be a valid year between 2000 and 2100');
    }
    return n;
  })
  .option('--json', 'Output raw stats as JSON')
  .option('--list-themes', 'Show all available themes')
  .option('--verbose', 'Show debug output for troubleshooting')
  .action(async (opts: CLIOptions) => {
    try {
      if (opts.listThemes) {
        console.log('Available themes:\n');
        for (const name of getAllThemeNames()) {
          const marker = name === 'green' ? ' (default)' : '';
          console.log(`  ${name}${marker}`);
        }
        return;
      }

      const themeNames = getAllThemeNames();
      if (!themeNames.includes(opts.theme)) {
        console.error(`Unknown theme: ${opts.theme}. Available: ${themeNames.join(', ')}`);
        process.exit(1);
      }

      const format = opts.export !== false
        ? (typeof opts.export === 'string' ? opts.export : 'png')
        : null;
      if (format && format !== 'png' && format !== 'svg') {
        console.error(`Unknown export format: ${format}. Supported: png, svg`);
        process.exit(1);
      }

      if (opts.verbose) setVerbose(true);

      const tools: string[] = [];
      if (opts.claude) tools.push('claude');
      if (opts.codex) tools.push('codex');
      if (opts.opencode) tools.push('opencode');
      if (opts.cursor) tools.push('cursor');

      const panels = await aggregateMulti({
        tools: tools.length > 0 ? tools : undefined,
        year: opts.year,
      });

      if (panels.length === 0) {
        console.error('No AI coding tool data found. Supported: Claude Code, Codex, OpenCode, Cursor.');
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(panels, null, 2));
        return;
      }

      const renderOpts = { theme: opts.theme, user: opts.user, year: opts.year };

      renderTerminal(panels, renderOpts);

      if (format) {
        const svg = renderSVG(panels, renderOpts);
        const ts = getTimestamp();
        let savedPermission = false;

        if (format === 'svg') {
          const outPath = opts.out || `tokenviz_${ts}.svg`;
          if (!savedPermission) {
            const ok = await confirmSave(resolve(outPath));
            if (!ok) { console.log('Skipped saving.'); return; }
            savedPermission = true;
          }
          writeFileSync(outPath, svg);
          console.log(`\nSaved to ${resolve(outPath)}`);
        } else {
          const outPath = opts.out || `tokenviz_${ts}.png`;
          if (!savedPermission) {
            const ok = await confirmSave(resolve(outPath));
            if (!ok) { console.log('Skipped saving.'); return; }
            savedPermission = true;
          }
          await svgToPng(svg, outPath, { background: getBgColor(opts.theme) });
          console.log(`\nSaved to ${resolve(outPath)}`);

          if (opts.copy) {
            try {
              await copyImageToClipboard(resolve(outPath));
              console.log('Copied to clipboard!');
            } catch {
              console.warn('Could not copy to clipboard.');
            }
          }
        }
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('Error:', message);
      if (process.env.DEBUG) {
        const stack = e instanceof Error ? e.stack : undefined;
        if (stack) console.error(stack);
      }
      process.exit(1);
    }
  });

program.parse();
