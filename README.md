# Hook Hero

Structured telemetry for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Captures every hook event across your sessions — tools, tokens, costs, git activity, subagents, and more — with msgpack compression, optional encryption, and a real-time terminal dashboard.

![Hook Hero Dashboard](docs/dashboard.png?v=2)

## Install

**Prerequisites:** [Node.js](https://nodejs.org/) (v18+) and [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

```sh
# Clone and install dependencies
git clone https://github.com/damahua/claude-code-hook-hero.git
cd claude-code-hook-hero
npm install

# Install as a Claude Code plugin
/plugin install hook-hero
```

Telemetry starts flowing on your next Claude Code session.

## Uninstall

```sh
/plugin uninstall hook-hero
```

This removes the plugin and stops all hook registration. Your existing telemetry data in `~/.claude/hook-hero/` is **not** deleted — remove it manually if you no longer need it:

```sh
rm -rf ~/.claude/hook-hero
```

## What It Captures

Hook Hero registers **14 hooks** that fire automatically during every session:

| Hook | What it records |
|------|----------------|
| `SessionStart` | Channel (claude-code / claude-cli), project context, git branch, model |
| `SessionEnd` | Final session summary written to disk |
| `UserPromptSubmit` | Prompt count tracking |
| `PreToolUse` | Tool invocation intent |
| `PostToolUse` | Tool result, duration |
| `PostToolUseFailure` | Tool errors and failure counts |
| `Stop` | Token usage from transcript, cost calculation, git diff stats |
| `SubagentStart` | Subagent type and spawn tracking |
| `SubagentStop` | Subagent duration and completion |
| `PreCompact` / `PostCompact` | Context compaction events |
| `WorktreeCreate` / `WorktreeRemove` | Git worktree lifecycle |
| `TaskCompleted` | Task completion count |

## Data Storage

All telemetry is stored locally under `~/.claude/hook-hero/`:

```
~/.claude/hook-hero/
├── sessions/{date}/{session_id}.json     # Session summaries (JSON, human-readable)
├── events/{date}/{session_id}.events     # Raw hook events (msgpack, compressed)
├── buffer/{session_id}.buf               # Live session state (msgpack)
├── debug/{date}/{session_id}.jsonl       # Debug entries (JSONL, human-readable)
├── config.json                           # User config overrides (optional)
└── .key                                  # Encryption key (auto-generated, chmod 600)
```

Events and buffers use [MessagePack](https://msgpack.org/) with dictionary compression by default (~47% smaller than JSON). Session summaries and debug logs stay as human-readable JSON/JSONL. Old JSON/JSONL files are auto-detected and readable regardless of current format setting.

**Nothing leaves your machine.** All data stays on local disk.

## Session Summary Schema

Each completed session produces a JSON summary with the following structure:

```jsonc
{
  "schema_version": "1.0",
  "session_id": "abc123",
  "channel": "claude-code",           // or "claude-cli"
  "timing": {
    "start_time": "2026-03-20T10:00:00Z",
    "end_time": "2026-03-20T10:45:00Z",
    "duration_seconds": 2700
  },
  "context": {
    "project_path": "/Users/you/Work/my-project",
    "project_name": "my-project",
    "repo": "you/my-project",
    "git_branch": "feature/new-api",
    "model": "claude-opus-4-6"
  },
  "tools": {
    "total_calls": 47,
    "by_type": { "Read": 12, "Edit": 8, "Bash": 15, "Write": 5, "Grep": 7 },
    "failures": 1
  },
  "tokens": {
    "input": 125000,
    "output": 42000,
    "total": 167000,
    "cache_read": 95000,
    "cache_write": 30000,
    "estimated_cost_usd": 1.23
  },
  "git": {
    "commits_made": 3,
    "branches_touched": ["feature/new-api"],
    "files_changed": 8,
    "insertions": 245,
    "deletions": 67,
    "prs_created": 1
  },
  "prompts": { "count": 12 },
  "subagents": { "total_spawned": 2, "by_type": { "Explore": 1, "general-purpose": 1 }, "total_duration_ms": 45000 },
  "compactions": { "count": 1 },
  "worktrees": { "created": 0, "removed": 0 },
  "tasks": { "completed": 4 }
}
```

The full JSON Schema is available in [`config/schema.json`](config/schema.json).

## Terminal Dashboard

Hook Hero includes a real-time terminal dashboard built with [Ink](https://github.com/vadimdemedes/ink).

### Install the CLI

```sh
cd dashboard
npm install
npm link
```

This makes the `hook-hero` command available globally:

```sh
hook-hero live                        # Real-time monitoring
hook-hero history                     # Review today's sessions
hook-hero history --date 2026-03-19   # Review a specific date
hook-hero export --session <id>       # Export session as JSON
```

### Export Command

Decrypt and export session data as readable JSON — useful for external analysis, piping to `jq`, or sharing session reports.

```sh
# List available sessions
hook-hero export --date 2026-03-20

# Export a specific session summary
hook-hero export --session 24768f42

# Include the full decrypted event timeline
hook-hero export --session 24768f42 --events

# Export all sessions for a date
hook-hero export --all --date 2026-03-20

# Write to file instead of stdout
hook-hero export --session 24768f42 --events -o session.json

# Pipe to jq for analysis
hook-hero export --session 24768f42 --events | jq '.events[] | select(.event == "tool_end") | .tool'
```

The export command decrypts encrypted `.events` and `.buf` files automatically using your local key. Session summaries (`.json`) are always readable without decryption.

### Development mode

If you prefer not to link globally, run directly from the dashboard directory:

```sh
cd dashboard
npm run dev -- --live     # Live monitoring
npm run dev -- --history  # Review past sessions
```

### Dashboard Layout

The dashboard has four areas, top to bottom:

**Header** — ASCII art logo with the current mode (live telemetry or session replay).

**Stats bar** — Two-line summary of today's activity:

```
today 2 sess │ 5#/0$ msgs │ 47 ops │ $1.23 │ active $0.45 │ 3m
time 12m AI + 8m you │ all time $34.56
```

- `sess` — sessions started today
- `#/$` — interactive prompts / CLI prompts
- `ops` — total tool invocations
- `err` — tool failures (only shown if > 0)
- Cost — today's cost and active session cost
- `AI` / `you` — time Claude spent working vs. time you spent typing
- `all time` — cumulative cost across all sessions

**Tool breakdown** — Inline bar showing the most-used tools and their counts (e.g. `Read 12 │ Bash 9 │ Edit 7`).

**Stream list** — Sessions grouped by project, each showing:

```
[-] claude-code-hook-hero · 2 sess
 >● # claude-code-hook-hero / 2edf9112 · 6m 4s
  ○ # claude-code-hook-hero / a1b2c3d4 · 12m 31s  $0.87
```

- `[-]` / `[+]` — collapsed/expanded project group
- `●` active / `○` idle / `◇` completed session
- `#` interactive / `$` CLI channel
- Session ID, duration, and cost
- Expanding a completed session shows its tool counts and token stats
- Entering a session opens the **detail view**

### Detail View

Press `Enter` on a session to open a scrollable event timeline:

```
◈ 10:00:00  session_start
→ 10:00:12  tool_start    Read
← 10:00:12  tool_end      Read
▸ 10:01:03  user_prompt
→ 10:01:15  tool_start    Bash
✗ 10:01:16  tool_failure  Bash
⊕ 10:02:00  subagent      Explore
◇ 10:12:31  session_end
```

Each event is color-coded: green for tool success, red for failures, blue for prompts, violet for subagents, amber for compactions. Press `Esc` or `q` to return to the main view.

### Debug Mode

Press `d` on any active session to toggle debug capture. When enabled, Hook Hero records full tool inputs, tool results, and assistant messages to `~/.claude/hook-hero/debug/{date}/{session_id}.jsonl`. The detail view renders these entries inline so you can inspect exactly what Claude sent and received.

### Keyboard Controls

| Key | Action |
|-----|--------|
| `↑` `↓` / `j` `k` | Navigate sessions and groups |
| `Enter` | Expand group / open session detail |
| `Esc` | Collapse group / exit detail view |
| `a` | Open AI analysis chat for selected session |
| `Tab` | Toggle focus between main view and chat panel |
| `d` | Toggle debug capture for a session |
| `c` | Collapse all groups |
| `e` | Expand all groups |
| `f` | Cycle project filter |
| `g` / `G` | Jump to top / bottom (in detail view) |
| `q` | Quit (or exit detail view) |

### AI Analysis

Press `a` on any session to open a chat panel at the bottom of the screen. Type a question and press Enter — Hook Hero spawns `claude -p` with the session's telemetry context (tools, tokens, cost, events timeline, git stats) and streams the response. Follow-up questions are supported. Press `Tab` to toggle focus between the dashboard and the chat panel.

## Commands

### `/hook-hero-stats`

Quick terminal summary of session activity for today or a custom date range:

```
Sessions: 8
Duration: 3h 42m
Cost:     $4.87
Top tools: Bash (89), Read (67), Edit (43), Write (22), Grep (18)
Repos:    my-project (5), another-repo (3)
Channels: claude-code (6), claude-cli (2)
Git:      12 commits, 3 PRs, +1,204 / -387 lines
```

## Skills

### `agent-metrics`

Natural language queries against your telemetry data. Ask things like:

- *"How much did I spend on Claude today?"*
- *"Which repo used the most tokens this week?"*
- *"Show me my agent efficiency metrics"*
- *"Compare my claude-code vs claude-cli usage"*

## Cost Tracking

Token costs are calculated using rates defined in [`config/defaults.json`](config/defaults.json):

| Model | Input | Output | Cache Read | Cache Write |
|-------|-------|--------|------------|-------------|
| claude-opus-4-6 | $5.00/M | $25.00/M | $0.50/M | $6.25/M |
| claude-opus-4-5 | $5.00/M | $25.00/M | $0.50/M | $6.25/M |
| claude-opus-4-1 | $15.00/M | $75.00/M | $1.50/M | $18.75/M |
| claude-opus-4-0 | $15.00/M | $75.00/M | $1.50/M | $18.75/M |
| claude-sonnet-4-6 | $3.00/M | $15.00/M | $0.30/M | $3.75/M |
| claude-sonnet-4-5 | $3.00/M | $15.00/M | $0.30/M | $3.75/M |
| claude-sonnet-4-0 | $3.00/M | $15.00/M | $0.30/M | $3.75/M |
| claude-haiku-4-5 | $1.00/M | $5.00/M | $0.10/M | $1.25/M |
| claude-haiku-3-5 | $0.80/M | $4.00/M | $0.08/M | $1.00/M |
| claude-haiku-3-0 | $0.25/M | $1.25/M | $0.03/M | $0.30/M |

Rates sourced from [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) and auto-updated daily on session start. Override rates by placing a custom `cost_rates` object in your config.

## Storage Configuration

Hook Hero uses msgpack with dictionary compression by default. Configure format and encryption in `~/.claude/hook-hero/config.json`:

```json
{
  "storage": {
    "format": "msgpack",
    "encryption": {
      "enabled": true,
      "key_source": "keyfile"
    }
  }
}
```

### Format

| Option | Default | Description |
|--------|---------|-------------|
| `"msgpack"` | Yes | Binary format with dictionary compression (~47% smaller than JSON) |
| `"json"` | No | Human-readable JSON/JSONL (for debugging or external tooling) |

### Encryption

Optional AES-256-GCM encryption for events and buffer files. Each event frame is encrypted independently (supports append without re-encrypting the whole file). Overhead: 29 bytes per frame.

| Key source | How it works |
|-----------|--------------|
| `"keyfile"` (default) | Auto-generates a 256-bit key at `~/.claude/hook-hero/.key` (chmod 600) |
| `"env"` | Reads from `HOOK_HERO_KEY` environment variable (hex-encoded, 64 chars) |

### Dictionary Compression

Events contain highly repetitive strings (field names, event types, tool names, session IDs). The codec replaces these with compact integer codes:

- **Static dictionary**: 56 codes for common keys (`session_id`, `tool_use_id`, ...) and values (`tool_start`, `Read`, `success`, ...)
- **Per-file dynamic dictionary**: stored as the first frame in each event file, maps session-specific strings (UUID, project path) to codes

## Querying Data

Session summaries are plain JSON files — query them with any tool:

```bash
# Count today's sessions
ls ~/.claude/hook-hero/sessions/$(date +%Y-%m-%d)/ | wc -l

# Total cost today
cat ~/.claude/hook-hero/sessions/$(date +%Y-%m-%d)/*.json | \
  jq -s '[.[].tokens.estimated_cost_usd // 0] | add'

# Sessions for a specific repo
grep -rl '"repo": "you/my-project"' ~/.claude/hook-hero/sessions/

# Most-used tools across all sessions today
cat ~/.claude/hook-hero/sessions/$(date +%Y-%m-%d)/*.json | \
  jq -s '[.[].tools.by_type | to_entries[]] | group_by(.key) |
    map({tool: .[0].key, count: [.[].value] | add}) | sort_by(-.count)'
```

## Project Structure

```
hook-hero/
├── hooks/
│   ├── hooks.json          # Hook registration (14 hooks)
│   └── run-hook.cmd        # Cross-platform dispatcher (Unix + Windows)
├── lib/
│   ├── storage-codec.mjs   # StorageCodec — msgpack, dictionary, encryption
│   ├── session-store.mjs   # File-based storage with locking
│   ├── session-start.mjs   # Session initialization + pricing auto-update
│   ├── session-end.mjs     # Summary finalization
│   ├── cost-calculator.mjs # Token cost calculation
│   ├── update-pricing.mjs  # Daily pricing fetch from Anthropic
│   ├── git-utils.mjs       # Git context extraction
│   ├── stdin-reader.mjs    # Hook stdin parsing
│   ├── stop.mjs            # Transcript parsing + token aggregation
│   └── ...                 # One handler per hook event
├── config/
│   ├── defaults.json       # Storage, cost rates, retention settings
│   └── schema.json         # JSON Schema for session summaries
├── dashboard/              # Ink-based terminal dashboard + AI chat
├── commands/               # Slash commands
├── skills/                 # AI-queryable skills
└── tests/                  # Test suite (14 test files)
```

## How It Works

1. **Claude Code fires a hook** — one of 14 registered events
2. **`run-hook.cmd` dispatches** to the matching `.mjs` handler in `lib/`
3. **The handler reads stdin** (hook payload with session ID, tool info, etc.)
4. **`StorageCodec` encodes the data** — dictionary compression, msgpack serialization, optional encryption
5. **`SessionStore` persists to disk** — buffer files for active sessions, compressed event logs, and JSON session summaries
6. **On `Stop`**, the transcript is parsed for token usage and costs are calculated
7. **On `SessionEnd`**, the buffer is finalized into a session summary

Concurrency is handled via file-based locking with stale lock detection.

## Security

Hook Hero captures telemetry that may include file paths, bash commands, and project structure from your sessions. Keep these points in mind:

**Data stays local.** All telemetry is written to `~/.claude/hook-hero/` on your machine. Nothing is sent to any external server.

**Encryption key management.** If you enable encryption, the key is stored at `~/.claude/hook-hero/.key` (256-bit, chmod 600). This file is your only way to decrypt your telemetry data.

- **Never commit the `.key` file** to version control. The `.gitignore` excludes it, but verify if you copy the data directory.
- **Back up the key** if you need to preserve access to encrypted data across machines.
- **If you lose the key**, encrypted event and buffer files become unreadable. Session summaries (JSON) are never encrypted and remain accessible.
- **For teams**, use the `HOOK_HERO_KEY` environment variable (`"key_source": "env"`) instead of a keyfile so each member manages their own key.

**What is captured.** Session summaries include: project paths, git remote URLs, branch names, model names, tool invocations (including bash commands up to 100 chars), token counts, and cost estimates. Review the [session schema](#session-summary-schema) for the full list. Debug mode (when enabled) captures full tool inputs and outputs.

**What is NOT captured.** File contents, prompt text, assistant responses, and API keys are never stored in session summaries or event logs. Debug mode captures tool inputs/outputs but is opt-in per session.

## Requirements

- **[Node.js](https://nodejs.org/)** v18+ (for running `.mjs` hook handlers and msgpack)
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** with plugin support

## License

[MIT](LICENSE)
