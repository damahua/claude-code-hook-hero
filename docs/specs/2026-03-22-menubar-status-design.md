# macOS Menu Bar Status — Design Spec

**Date:** 2026-03-22
**Status:** Draft
**Branch:** feature/menubar-status
**Schema Version:** 1.0

## Overview

Add a macOS menu bar status item that shows at-a-glance Claude Code agent metrics: active session count, today's interaction time, and today's cost. Clicking the item opens a dropdown with detailed metrics similar to the `hook-hero live` dashboard.

This is a **two-project** solution:
1. **Hook Hero** (this repo) — adds a `status.json` writer to existing hooks
2. **Menu Bar App** (separate repo) — a standalone Swift/SwiftUI macOS app that reads the status file

## Menu Bar Display

Format: `● 2 | 1h23m | $4.57`

| Element | Meaning | Source |
|---------|---------|--------|
| `●` (green) | Active sessions exist | `active_sessions > 0` |
| `●` (gray) | No active sessions | `active_sessions == 0` |
| `2` | Active session count | `active_sessions` |
| `1h23m` | Active interaction time today | `today.interaction_time_sec` |
| `$4.57` | Total USD cost today | `today.cost_usd` |

### States

- **Active sessions:** `● 2 | 1h23m | $4.57` (green dot)
- **No active sessions:** `● 0 | 1h23m | $4.57` (gray dot)
- **Fresh day / no data:** `● 0 | 0m | $0.00` (gray dot)

## Dropdown (on click)

A dropdown/popover showing detailed metrics for today:

- **Today's Summary:** sessions total, interaction time, cost, tokens (input/output/cache_read/cache_write), tool calls, prompts
- **Active Sessions:** per-session breakdown (project, wall-clock duration, cost, prompts)
- **Git Activity:** commits made, files changed
- **Optional:** "Launch at Login" toggle

## Status File Contract

Hook Hero writes `~/.claude/hook-hero/status.json`. This is the sole interface between the two projects.

### Schema

```json
{
  "schema_version": "1.0",
  "active_sessions": 2,
  "today": {
    "sessions_total": 5,
    "interaction_time_sec": 4980,
    "cost_usd": 4.57,
    "tokens": {
      "input": 125000,
      "output": 43000,
      "cache_read": 89000,
      "cache_write": 15000
    },
    "tool_calls": 312,
    "prompts": 47,
    "git": {
      "commits": 3,
      "files_changed": 12
    }
  },
  "active": [
    {
      "session_id": "abc123",
      "project": "hook-hero",
      "duration_sec": 1200,
      "cost_usd": 0.83,
      "prompts": 8
    }
  ],
  "updated_at": "2026-03-22T10:32:00Z"
}
```

**Field notes:**
- `schema_version` — enables the menu bar app to detect incompatible schema changes.
- `today.git.commits` maps to session summary field `git.commits_made`.
- `today.tokens.cache_write` included for completeness — used in cost calculations.
- `active[].duration_sec` is wall-clock time since session start (`Date.now() - start_time`), not interaction time.

### File Location

`~/.claude/hook-hero/status.json`

## Hook Hero Changes (This Repo)

### Interaction Time Tracking

`interaction_time_sec` is not currently stored in buffers or session summaries — it is computed on the fly by walking event files (see `computeTimeDurations` in the dashboard). To avoid expensive event-file scans on every status write:

- Add a running `interaction_time_sec` accumulator to the session buffer, updated on each `Stop` hook (which already has timing data from the transcript).
- `write-status.mjs` reads this field from buffers and completed session summaries — no event file scanning needed.

### New File: `lib/write-status.mjs`

Reads today's sessions + active buffers, computes aggregated metrics, writes `status.json`.

- Reads completed sessions from `sessions/YYYY-MM-DD/*.json`
- Reads active session buffers from `buffer/*.buf`
- Computes: active count, today's totals (cost, time, tokens, tools, prompts, git)
- Writes atomically: write to `status.json.tmp`, then `rename()` to `status.json`

### Concurrency: Atomic Writes

Multiple Claude Code sessions may fire hooks concurrently. Since each hook invocation reads the same source files (sessions + buffers) and computes a full aggregate, the write is idempotent. The atomic write strategy (write to temp file, then `fs.rename`) ensures the menu bar app never reads a partial file. In the worst case, two concurrent writes produce slightly different aggregates (one may not see the other's just-written buffer), but the next hook event corrects this within seconds.

### Hooks That Trigger Status Write

Only high-value events (not every tool call):

| Hook | Why |
|------|-----|
| `SessionStart` | Active session count increases |
| `SessionEnd` | Active count decreases, today's totals finalize |
| `Stop` | Cost/token data updates (transcript parsed here) |
| `UserPromptSubmit` | Prompt count increments |

`PostToolUse` is excluded — tool calls are too frequent and cost/time don't meaningfully change per tool call.

### Update Strategy

On-change only. Status file is written as a side effect of the hooks listed above. No polling, no cron, no background process.

**Staleness trade-off:** During long AI turns (e.g., multi-minute code generation), the status file will not update since no hooks fire mid-turn. This is an acceptable trade-off to avoid per-tool-call writes. The `Stop` hook fires at the end of each turn, refreshing the data.

### What Doesn't Change

- Existing data formats (buffers, sessions, events)
- Dashboard, CLI commands, slash commands
- No new npm dependencies

## Menu Bar App (Separate Repo)

### Tech Stack

- **Language:** Swift
- **UI Framework:** SwiftUI
- **Menu Bar:** `NSStatusItem` (AppKit)
- **Dropdown:** `NSPopover` with SwiftUI views
- **File Watching:** `DispatchSource` / FSEvents on `status.json`
- **JSON Parsing:** `Codable` structs matching the schema above

### Architecture

```
StatusFileWatcher (FSEvents on ~/.claude/hook-hero/status.json)
  → StatusModel (Codable struct, decoded from JSON)
    → MenuBarItem (NSStatusItem, renders "● 2 | 1h23m | $4.57")
    → DropdownView (NSPopover, SwiftUI detailed metrics view)
```

### Components

| Component | Responsibility |
|-----------|---------------|
| `StatusFileWatcher` | Watches `status.json` for changes via FSEvents |
| `StatusModel` | Codable struct matching the JSON schema, with `schema_version` check |
| `MenuBarItem` | `NSStatusItem` rendering the compact bar display |
| `DropdownView` | SwiftUI popover with today's summary, active sessions, git stats |
| `AppDelegate` | App lifecycle, launch-at-login, midnight reset |

### Lifecycle

1. App launches (optionally at login)
2. Reads `status.json` on startup
3. Watches for file changes — updates display on each change
4. If file doesn't exist: shows `● 0 | 0m | $0.00`
5. **Midnight reset:** The app compares the date portion of `updated_at` against the current date. If they differ (new day, no sessions yet), it resets to the fresh-day state independently — it does not wait for a hook to fire.

### Distribution

- GitHub Releases with pre-built `.app` binary
- Build from source: `swift build -c release`
- Future: `brew install --cask hook-hero-bar`

### Dependencies

- **macOS system frameworks only** (AppKit, Foundation, SwiftUI)
- **Xcode Command Line Tools** for building from source
- **No third-party Swift packages**

## Non-Goals

- No web UI or browser-based approach
- No inter-process communication (sockets, XPC, etc.)
- No changes to Hook Hero's existing data formats (except the new `interaction_time_sec` accumulator in buffers)
- No real-time streaming — file-based updates are sufficient
- Menu bar app does not write back to Hook Hero

## Testing Strategy

### Hook Hero (status writer)
- Unit test: `write-status.mjs` produces correct JSON from mock session data
- Unit test: `interaction_time_sec` accumulator updates correctly on `Stop` hook
- Integration test: trigger hooks and verify `status.json` is written with correct values
- Integration test: concurrent hook invocations produce valid (non-corrupt) `status.json`

### Menu Bar App
- Unit test: `StatusModel` decodes all valid JSON variants (active, inactive, fresh day, missing fields)
- Unit test: `StatusModel` handles `schema_version` mismatch gracefully
- Unit test: midnight reset triggers when `updated_at` date differs from current date
- UI test: `MenuBarItem` renders correct format strings for each state
