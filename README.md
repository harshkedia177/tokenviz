<div align="center">

# braggrid

**Your AI coding stats, visualized.**

A GitHub-style contribution heatmap that shows how much you actually use AI coding tools.
One command. Auto-detected. Shareable.

[![npm version](https://img.shields.io/npm/v/braggrid.svg)](https://www.npmjs.com/package/braggrid)
[![license](https://img.shields.io/npm/l/braggrid.svg)](https://github.com/harshkedia177/braggrid/blob/main/LICENSE)

</div>

---

```
npx braggrid@latest
```

That's it. It reads your local data, renders a heatmap in your terminal, and exports a shareable PNG.

<div align="center">

### Single Tool View

<img src="assets/demo-single.png" alt="braggrid — single tool heatmap" width="720" />

<br />

### Multi-Tool View

<img src="assets/demo.png" alt="braggrid — multi-tool heatmap" width="720" />

</div>

---

## Supported Tools

| Tool | Data Source | What's Tracked |
|------|-----------|----------------|
| **Claude Code** | `~/.claude/stats-cache.json` | Tokens, models, sessions, costs |
| **Codex CLI** | `~/.codex/sessions/*.jsonl` | Tokens, models, session durations |
| **OpenCode** | `~/.local/share/opencode/` | Tokens, models, messages |
| **Cursor** | Cursor API + local `state.vscdb` | Tokens, models, usage events |

braggrid auto-detects which tools you have installed. No configuration needed.

## Install

```bash
# Run directly (no install)
npx braggrid@latest

# Run stats for a specific tool
npx braggrid@latest --claude
npx braggrid@latest --codex
npx braggrid@latest --cursor
npx braggrid@latest --opencode

# Or install globally
npm install -g braggrid
braggrid
```

Requires **Node.js 18+**.

## What You Get

### Terminal Heatmap

A full-color contribution grid right in your terminal, with:

- Token usage breakdown (input / output / total)
- Most used model (all-time + last 30 days)
- Current & longest streaks
- Peak coding hour & busiest day
- Average session length
- Per-tool usage panels

### Shareable PNG/SVG

Automatically exports a high-quality image you can share on Twitter, LinkedIn, your blog, or anywhere.

```bash
braggrid --user yourname              # PNG with your name
braggrid --user yourname --export svg # SVG export
braggrid --user yourname --copy       # PNG + copy to clipboard
```

## Usage

```bash
# Basic — auto-detect all tools, export PNG
braggrid

# Add your name to the heatmap
braggrid --user yourname

# Filter to a specific tool
braggrid --claude
braggrid --codex
braggrid --cursor
braggrid --opencode

# Filter to a specific year
braggrid --year 2025

# Change the color theme
braggrid --theme dark-green

# Export as SVG instead of PNG
braggrid --export svg

# Custom output path
braggrid --out ~/Desktop/my-ai-usage.png

# Terminal only, no file export
braggrid --no-export

# Copy PNG to clipboard (macOS/Linux/Windows)
braggrid --copy

# Dump raw stats as JSON (for scripting)
braggrid --json

# See all themes
braggrid --list-themes
```

## Themes

10 built-in themes — 5 light, 5 dark:

| Dark | Light |
|------|-------|
| `dark-ember` | `green` (default) |
| `dark-green` | `purple` |
| `dark-purple` | `blue` |
| `dark-blue` | `amber` |
| `dark-mono` | `mono` |

```bash
braggrid --theme dark-purple
braggrid --theme amber
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--user <name>` | Username shown on the heatmap | — |
| `--claude` | Include only Claude Code data | — |
| `--codex` | Include only Codex data | — |
| `--opencode` | Include only OpenCode data | — |
| `--cursor` | Include only Cursor data | — |
| `--theme <name>` | Color theme | `green` |
| `--export <fmt>` | Export format: `png` or `svg` | `png` |
| `--no-export` | Skip file export, terminal only | — |
| `--out <path>` | Custom output file path | `braggrid.png` |
| `--copy` | Copy PNG to clipboard after export | — |
| `--year <year>` | Filter to a specific year | last 365 days |
| `--json` | Output raw stats as JSON | — |
| `--list-themes` | Show all available themes | — |

## How It Works

braggrid reads **locally stored data** from your AI coding tools. It never sends data anywhere — everything stays on your machine.

1. **Detect** — scans for installed tool data directories
2. **Aggregate** — merges token usage, sessions, and model stats across tools
3. **Render** — generates a terminal heatmap + exportable image
4. **Export** — saves a high-res PNG/SVG with stats panel

### Privacy

- All data is read **locally** from your filesystem
- Nothing is uploaded or transmitted
- The only network request is Cursor's API (to fetch your own usage CSV, using your local auth token) — and even that's optional with a local fallback

## FAQ

**Q: I don't see any data?**
Make sure you've actually used one of the supported tools. braggrid reads from the default data locations — if you've customized paths, set the environment variable:
- `CLAUDE_CONFIG_DIR` for Claude Code
- `CODEX_HOME` for Codex CLI
- `OPENCODE_DATA_DIR` for OpenCode
- `CURSOR_STATE_DB_PATH` or `CURSOR_CONFIG_DIR` for Cursor

**Q: Can I use this in CI/scripts?**
Yes — `braggrid --json` outputs machine-readable JSON.

**Q: The Cursor data seems low?**
If the API fetch fails (auth issues), braggrid falls back to local line-count tracking which estimates tokens. The API-based data is more accurate.

## Contributing

PRs welcome! The codebase is TypeScript with ESM modules.

```bash
git clone https://github.com/harshkedia177/braggrid.git
cd braggrid
npm install
npm run dev    # watch mode
node dist/bin.js --list-themes
```

## License

MIT
