import { execFileSync } from 'child_process';
import { platform } from 'os';

export async function copyImageToClipboard(pngPath: string): Promise<void> {
  const os = platform();

  switch (os) {
    case 'darwin': {
      const safePath = pngPath.replace(/'/g, "'\\''");
      execFileSync('osascript', [
        '-e',
        `set the clipboard to (read (POSIX file '${safePath}') as «class PNGf»)`,
      ]);
      break;
    }

    case 'linux':
      execFileSync('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-i', pngPath]);
      break;

    case 'win32': {
      const safePath = pngPath.replace(/'/g, "''");
      execFileSync('powershell', [
        '-NoProfile',
        '-Command',
        `Set-Clipboard -Path '${safePath}'`,
      ]);
      break;
    }

    default:
      throw new Error(`Unsupported platform for clipboard copy: ${os}`);
  }
}
