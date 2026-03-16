# Hook-Hero: Claude Code Plugin for Agent Session Telemetry

## Overview

Hook-Hero is a Claude Code plugin that captures structured telemetry data from every Claude Code and Claude CLI session. It writes raw event logs and aggregated session summaries as JSON files to a well-defined location. Any external tool (AmpClaw, scripts, dashboards) can consume these files by reading the published schema.

Hook-Hero knows nothing about its consumers. It just writes good data.

## Goals

- Track all Claude Code (interactive) and Claude CLI (piped) sessions automatically
- Capture: timing, context (project/repo/directory/branch), tool usage, token/cost, git activity, channel, subagent lifecycle, context compaction, worktree activity
- Produce both raw event streams (JSONL) and aggregated session summaries (JSON)
- Follow Claude Code plugin standards for zero-friction installation
- Zero external dependencies — plain JavaScript on Node.js stdlib only

## Non-Goals

- No built-in dashboard (consumers handle visualization)
- No database (files are the interface)
- No knowledge of AmpClaw or any specific consumer
- No network calls — everything is local filesystem

## Installation

```bash
# From Claude Code plugin marketplace
/plugin install hook-hero@your-marketplace

# Or from git
/plugin install github:damahua/claude-code-hook-hero
```

No further setup required. Hooks auto-register and sessions start logging immediately.

## Plugin Structure

```
claude-code-hook-hero/
├── README.md
├── LICENSE
├── hooks/
│   ├── hooks.json                    # Lifecycle event registration (14 hooks)
│   └── run-hook.cmd                  # Cross-platform dispatcher → node lib/{hook-name}.mjs
├── lib/                              # Plain JS (ES modules), Node.js stdlib only
│   ├── session-start.mjs
│   ├── session-end.mjs
│   ├── pre-tool-use.mjs
│   ├── post-tool-use.mjs
│   ├── post-tool-use-failure.mjs
│   ├── stop.mjs
│   ├── user-prompt-submit.mjs
│   ├── subagent-start.mjs
│   ├── subagent-stop.mjs
│   ├── pre-compact.mjs
│   ├── post-compact.mjs
│   ├── worktree-create.mjs
│   ├── worktree-remove.mjs
│   ├── task-completed.mjs
│   ├── session-store.mjs            # File locking, JSON read/write, event append
│   ├── git-utils.mjs                # Repo, branch, diff stats
│   └── cost-calculator.mjs          # Token → USD with model rates
├── skills/
│   └── agent-metrics/
│       └── SKILL.md                  # /agent-metrics skill for querying data
├── commands/
│   └── hook-hero-stats.md            # /hook-hero-stats slash command
└── config/
    └── defaults.json                 # Model cost rates, retention days
```

## Hooks Registration

File: `hooks/hooks.json`

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" session-start",
            "async": false
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" session-end",
            "async": false
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" user-prompt-submit",
            "async": true
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" pre-tool-use",
            "async": true
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" post-tool-use",
            "async": true
          }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" post-tool-use-failure",
            "async": true
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" stop",
            "async": false
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" subagent-start",
            "async": true
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" subagent-stop",
            "async": true
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" pre-compact",
            "async": true
          }
        ]
      }
    ],
    "PostCompact": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" post-compact",
            "async": true
          }
        ]
      }
    ],
    "WorktreeCreate": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" worktree-create",
            "async": true
          }
        ]
      }
    ],
    "WorktreeRemove": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" worktree-remove",
            "async": true
          }
        ]
      }
    ],
    "TaskCompleted": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" task-completed",
            "async": true
          }
        ]
      }
    ]
  }
}
```

### Async Decisions

| Hook | Async | Reason |
|------|-------|--------|
| `SessionStart` | false | Must complete to establish session context before Claude begins |
| `SessionEnd` | false | Must complete to finalize session data before process exits |
| `Stop` | false | Must complete to update buffer with token/cost/git data before SessionEnd finalizes |
| `UserPromptSubmit` | true | Must not delay prompt processing |
| `PreToolUse` | true | Must not slow down tool execution |
| `PostToolUse` | true | Must not slow down tool execution |
| `PostToolUseFailure` | true | Must not slow down error handling |
| `SubagentStart` | true | Must not delay subagent spawn |
| `SubagentStop` | true | Must not delay subagent cleanup |
| `PreCompact` | true | Must not delay compaction |
| `PostCompact` | true | Must not delay post-compaction |
| `WorktreeCreate` | true | Must not delay worktree creation |
| `WorktreeRemove` | true | Must not delay worktree removal |
| `TaskCompleted` | true | Must not delay task flow |

## Telemetry Data Storage

Date directories use **`YYYY-MM-DD`** format (e.g., `2026-03-15`).

```
~/.claude/hook-hero/
├── events/2026-03-15/{session_id}.jsonl   # Raw events (append-only, one line per event)
├── sessions/2026-03-15/{session_id}.json  # Aggregated session summary
├── buffer/{session_id}.json               # In-progress aggregation state
├── config.json                            # User overrides (cost rates, retention)
└── schema.json                            # Published schema for consumers
```

### Directory Layout

- `events/` — raw event log, append-only JSONL. One file per session, organized by date (`YYYY-MM-DD`). Never modified after writing — only appended to.
- `sessions/` — finalized aggregated summaries. One JSON file per session. Written once at session end.
- `buffer/` — working state for in-progress sessions. Read by `SessionEnd` hook, which computes final aggregates, writes to `sessions/`, then deletes the buffer file.
- `config.json` — user-editable overrides (e.g., custom cost rates per model).
- `schema.json` — formal JSON Schema definition for both event and session formats, enabling consumers to validate data.

### Buffer File Schema

The buffer file (`buffer/{session_id}.json`) is internal working state. It is not part of the consumer contract — only hooks read and write it. Structure:

```json
{
  "session_id": "abc123-def456",
  "channel": "claude-code",
  "date": "2026-03-15",
  "start_time": "2026-03-15T10:30:00Z",
  "context": { "...same as session_start event context..." },
  "prompts_count": 8,
  "tools_total": 47,
  "tools_by_type": { "Read": 12, "Edit": 8 },
  "tools_failures": 1,
  "tokens_input": 125000,
  "tokens_output": 18500,
  "tokens_cache_read": 80000,
  "tokens_cache_write": 45000,
  "subagents_total": 3,
  "subagents_by_type": { "Explore": 1, "general-purpose": 1 },
  "compactions_count": 1,
  "worktrees_created": 1,
  "worktrees_removed": 0,
  "tasks_completed": 5
}
```

Each async hook that updates the buffer does a locked read-modify-write cycle (see Concurrency section).

## Event Schema (JSONL)

Every event shares a common envelope:

```json
{"v": 1, "ts": "ISO-8601", "event": "event_type", "session_id": "string", ...event-specific fields}
```

- `v` — schema version for events (integer). Bumped on breaking changes. Consumers use this to handle format evolution in JSONL files.

### Session Lifecycle Events

#### session_start

Written by: `SessionStart` hook

```json
{
  "ts": "2026-03-15T10:30:00Z",
  "event": "session_start",
  "session_id": "abc123-def456",
  "channel": "claude-code",
  "context": {
    "project_path": "/Users/leo.zhang/Work/nova",
    "project_name": "nova",
    "directory": "src/main/java/com/amplitude",
    "cwd": "/Users/leo.zhang/Work/nova/src/main/java/com/amplitude",
    "repo": "amplitude/nova",
    "git_remote_url": "git@github.com:amplitude/nova.git",
    "git_branch": "AMP-1234-cohort-fix",
    "model": "claude-opus-4-6"
  }
}
```

#### session_end

Written by: `SessionEnd` hook

```json
{
  "ts": "2026-03-15T10:45:30Z",
  "event": "session_end",
  "session_id": "abc123-def456"
}
```

#### agent_stop

Written by: `Stop` hook. Fires each time the main Claude agent finishes a response turn. A session may have multiple `agent_stop` events (one per user prompt → Claude response cycle).

Token counts in each `agent_stop` are **deltas for that turn**, not cumulative totals. The session summary aggregates all turns by summing deltas. Git stats are collected once on the **last** `agent_stop` (or by `SessionEnd` if `Stop` never fires) by comparing the git state at session start vs current.

```json
{
  "ts": "2026-03-15T10:45:22Z",
  "event": "agent_stop",
  "session_id": "abc123-def456",
  "tokens": {
    "input": 25000,
    "output": 3500,
    "cache_read": 15000,
    "cache_write": 8000
  }
}
```

### Prompt Events

#### user_prompt

Written by: `UserPromptSubmit` hook

```json
{
  "ts": "2026-03-15T10:30:01Z",
  "event": "user_prompt",
  "session_id": "abc123-def456",
  "prompt_length": 142
}
```

Note: We log prompt length for metrics, not prompt content (privacy).

### Tool Events

#### tool_start

Written by: `PreToolUse` hook

```json
{
  "ts": "2026-03-15T10:30:05Z",
  "event": "tool_start",
  "session_id": "abc123-def456",
  "tool": "Read",
  "tool_use_id": "toolu_01ABC123",
  "tool_input_summary": {
    "file_path": "/src/Main.java"
  }
}
```

Note on `tool_input_summary`: We log a redacted summary of tool inputs — file paths and tool names only. Bash command content, file bodies, and MCP tool parameters are excluded to prevent leaking credentials or sensitive data. The `tool_use_id` is provided by Claude Code in the hook input and serves as the correlation key between `tool_start`, `tool_end`, and `tool_failure` events.

#### tool_end

Written by: `PostToolUse` hook. Uses `tool_use_id` from the hook input to correlate with the corresponding `tool_start` event for duration computation.

```json
{
  "ts": "2026-03-15T10:30:06Z",
  "event": "tool_end",
  "session_id": "abc123-def456",
  "tool": "Read",
  "tool_use_id": "toolu_01ABC123",
  "status": "success"
}
```

Note: `duration_ms` is not computed here — consumers can derive it by correlating `tool_start` and `tool_end` events via `tool_use_id`. This avoids the complexity of cross-hook state for timing.

#### tool_failure

Written by: `PostToolUseFailure` hook. Provides richer error context.

```json
{
  "ts": "2026-03-15T10:31:12Z",
  "event": "tool_failure",
  "session_id": "abc123-def456",
  "tool": "Bash",
  "tool_use_id": "toolu_01DEF456",
  "error": "Command exited with code 1"
}
```

### Subagent Events

#### subagent_start

Written by: `SubagentStart` hook

```json
{
  "ts": "2026-03-15T10:32:00Z",
  "event": "subagent_start",
  "session_id": "abc123-def456",
  "subagent_id": "sub-789",
  "subagent_type": "Explore"
}
```

#### subagent_stop

Written by: `SubagentStop` hook. Consumers can compute duration by correlating `subagent_start` and `subagent_stop` via `subagent_id`.

```json
{
  "ts": "2026-03-15T10:33:15Z",
  "event": "subagent_stop",
  "session_id": "abc123-def456",
  "subagent_id": "sub-789",
  "subagent_type": "Explore"
}
```

### Context Compaction Events

#### compact_start

Written by: `PreCompact` hook. Signals the context window is filling up.

```json
{
  "ts": "2026-03-15T10:40:00Z",
  "event": "compact_start",
  "session_id": "abc123-def456"
}
```

#### compact_end

Written by: `PostCompact` hook

```json
{
  "ts": "2026-03-15T10:40:03Z",
  "event": "compact_end",
  "session_id": "abc123-def456"
}
```

### Worktree Events

#### worktree_create

Written by: `WorktreeCreate` hook

```json
{
  "ts": "2026-03-15T10:35:00Z",
  "event": "worktree_create",
  "session_id": "abc123-def456",
  "worktree_path": "/Users/leo.zhang/Work/nova_worktree/AMP-1234-cohort",
  "branch": "AMP-1234-cohort-fix"
}
```

#### worktree_remove

Written by: `WorktreeRemove` hook

```json
{
  "ts": "2026-03-15T11:00:00Z",
  "event": "worktree_remove",
  "session_id": "abc123-def456",
  "worktree_path": "/Users/leo.zhang/Work/nova_worktree/AMP-1234-cohort"
}
```

### Task Events

#### task_completed

Written by: `TaskCompleted` hook

```json
{
  "ts": "2026-03-15T10:38:00Z",
  "event": "task_completed",
  "session_id": "abc123-def456",
  "task_id": "5",
  "task_subject": "Implement cohort filtering"
}
```

## Session Summary Schema (JSON)

File: `sessions/{date}/{session_id}.json`

Written once when the session ends. This is a materialized view of the raw events — everything a consumer needs to build dashboards without parsing JSONL.

```json
{
  "schema_version": "1.0",
  "session_id": "abc123-def456",
  "channel": "claude-code",

  "timing": {
    "start_time": "2026-03-15T10:30:00Z",
    "end_time": "2026-03-15T10:45:22Z",
    "duration_seconds": 922
  },

  "context": {
    "project_path": "/Users/leo.zhang/Work/nova",
    "project_name": "nova",
    "directory": "src/main/java/com/amplitude",
    "cwd": "/Users/leo.zhang/Work/nova/src/main/java/com/amplitude",
    "repo": "amplitude/nova",
    "git_remote_url": "git@github.com:amplitude/nova.git",
    "git_branch": "AMP-1234-cohort-fix",
    "model": "claude-opus-4-6"
  },

  "tools": {
    "total_calls": 47,
    "by_type": {
      "Read": 12,
      "Edit": 8,
      "Bash": 6,
      "Write": 3,
      "Grep": 5,
      "Glob": 4,
      "Agent": 3,
      "WebFetch": 2,
      "mcp__Atlassian__searchJiraIssuesUsingJql": 2,
      "mcp__datadog__search_datadog_logs": 2
    },
    "failures": 1
  },

  "tokens": {
    "input": 125000,
    "output": 18500,
    "total": 143500,
    "cache_read": 80000,
    "cache_write": 45000,
    "estimated_cost_usd": 2.34
  },

  "git": {
    "commits_made": 2,
    "branches_touched": ["AMP-1234-cohort-fix"],
    "files_changed": 7,
    "insertions": 145,
    "deletions": 32,
    "prs_created": 1
  },

  "prompts": {
    "count": 8
  },

  "subagents": {
    "total_spawned": 3,
    "by_type": {
      "Explore": 1,
      "general-purpose": 1,
      "code-reviewer": 1
    },
    "total_duration_ms": 185000
  },

  "compactions": {
    "count": 1
  },

  "worktrees": {
    "created": 1,
    "removed": 0
  },

  "tasks": {
    "completed": 5
  }
}
```

## Hook Implementation Details

### Data Flow

```
SessionStart             → creates buffer, appends session_start event
UserPromptSubmit         → appends user_prompt event, increments buffer prompt count
PreToolUse               → appends tool_start event
PostToolUse              → appends tool_end event, updates buffer tool counts
PostToolUseFailure       → appends tool_failure event, updates buffer failure count
SubagentStart            → appends subagent_start event, updates buffer subagent counts
SubagentStop             → appends subagent_stop event, updates buffer subagent duration
PreCompact               → appends compact_start event, increments buffer compaction count
PostCompact              → appends compact_end event
WorktreeCreate           → appends worktree_create event, updates buffer worktree counts
WorktreeRemove           → appends worktree_remove event, updates buffer worktree counts
TaskCompleted            → appends task_completed event, updates buffer task count
Stop                     → appends agent_stop event, updates buffer with token deltas
SessionEnd               → computes git stats + cost, reads buffer, writes final sessions/ JSON, deletes buffer
```

### Hook Entry Points

`hooks/run-hook.cmd` is a polyglot bash/cmd wrapper (same pattern as the superpowers plugin). On Windows it finds Git Bash; on Unix it execs bash directly. It receives the hook name as an argument (e.g., `session-start`) and dispatches to the corresponding `.mjs` file:

```bash
# Unix portion of run-hook.cmd (simplified)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
HOOK_NAME="$1"
shift
exec node "${PLUGIN_ROOT}/lib/${HOOK_NAME}.mjs" "$@"
```

The individual bash scripts in `hooks/` (e.g., `session-start`, `pre-tool-use`) are **not used** — `run-hook.cmd` dispatches directly to `.mjs` files. The `hooks.json` registration always calls `run-hook.cmd <hook-name>`. Stdin is piped through from Claude Code (JSON input with hook context).

Note: `hooks.json` uses PascalCase keys (`SessionStart`, `PreToolUse`, etc.) — this matches Claude Code's documented hook dispatch naming convention.

### Channel Detection

Claude Code sets environment variables that distinguish interactive vs piped mode:

- `CLAUDE_CODE=1` + interactive TTY → `claude-code`
- No TTY / piped mode (`claude -p`) → `claude-cli`

The `session-start` hook inspects `process.env` and `process.stdin.isTTY` to determine the channel.

### Concurrency & File Safety

- **Events JSONL** — append-only. Each hook opens the file in append mode (`fs.appendFileSync`). Atomic at the OS level for single-line writes under ~4KB (pipe buffer guarantee on POSIX).
- **Buffer JSON** — read-modify-write by multiple async hooks. Protected by an exclusive lock file:
  1. Attempt to create `buffer/{session_id}.lock` with `O_CREAT | O_EXCL` (atomic create-if-not-exists)
  2. If lock exists, retry up to 10 times with 50ms backoff (500ms max wait)
  3. Read buffer JSON, modify, write back
  4. Delete lock file
  5. Stale lock detection: if lock file is older than 30 seconds, delete it and retry (handles crashed hooks)
- **Sessions JSON** — written once by `SessionEnd`. No concurrency concern.

### Git Stats Collection

Git stats are collected by `SessionEnd` (not `Stop`) to avoid blocking Claude's response delivery. `SessionEnd` runs git commands to collect activity since session start:

```javascript
// Compare session start time to git log
git log --since="${startTime}" --format="%H" --no-merges
git diff --stat HEAD~${commitCount}  // if commits were made
git log --since="${startTime}" --format="%D" // branches
```

Falls back gracefully if not in a git repo (all git fields default to zero/empty).

### Cost Calculation

Token counts from the `Stop` hook input are multiplied by per-model rates from `config/defaults.json`:

```json
{
  "cost_rates": {
    "claude-opus-4-6": { "input_per_1k": 0.015, "output_per_1k": 0.075, "cache_read_per_1k": 0.00375, "cache_write_per_1k": 0.01875 },
    "claude-sonnet-4-6": { "input_per_1k": 0.003, "output_per_1k": 0.015, "cache_read_per_1k": 0.00075, "cache_write_per_1k": 0.00375 },
    "claude-haiku-4-5": { "input_per_1k": 0.0008, "output_per_1k": 0.004, "cache_read_per_1k": 0.0002, "cache_write_per_1k": 0.001 }
  },
  "retention_days": 90
}
```

Users can override rates in `~/.claude/hook-hero/config.json`.

**Unknown model fallback:** If the model is not found in cost rates, `estimated_cost_usd` is set to `null` in the session summary (not zero — zero implies free, null implies unknown). A warning is logged to stderr on first occurrence per model per session.

## Skills & Commands

### Skill: `/agent-metrics`

File: `skills/agent-metrics/SKILL.md`

A Claude Code skill that teaches Claude how to read and interpret hook-hero data. When a user asks "how efficient was I this week?" or "show me my agent metrics", Claude reads the session JSON files and presents insights.

### Command: `/hook-hero-stats`

File: `commands/hook-hero-stats.md`

A slash command that outputs a quick summary of recent session activity directly in the terminal.

## Consumer Contract

Any tool that wants to consume hook-hero data should:

1. Read JSON files from `~/.claude/hook-hero/sessions/**/*.json` for aggregated data
2. Read JSONL files from `~/.claude/hook-hero/events/**/*.jsonl` for raw event streams
3. Validate against `~/.claude/hook-hero/schema.json`
4. Use `schema_version` field to handle format evolution
5. Use `session_id` as idempotent key (safe to re-ingest)
6. Expect files organized by date: `{date}/{session_id}.*`

Hook-Hero makes no guarantees about consumers. It writes files, consumers read them.

## Error Handling

- If `~/.claude/hook-hero/` doesn't exist, hooks create it on first run
- If a hook fails (node not found, permission error), it exits non-zero (non-blocking) — Claude continues normally, that session just isn't tracked
- If `SessionEnd` can't find a buffer file (e.g., session-start failed), it writes a bare `session_end` event to JSONL (timestamp + session_id only) and skips summary generation entirely
- Orphaned buffer files (from crashes) are cleaned up by future `SessionStart` hooks that detect buffers older than 24 hours
- All hooks fail silently — telemetry should never interfere with the user's Claude session

## Future Considerations

- Additional hook events (`PermissionRequest`, `TeammateIdle`, `Notification`, `Elicitation`, `ElicitationResult`, `ConfigChange`, `InstructionsLoaded`) can be added without schema changes — just new event types in the JSONL
- `schema_version` bump for breaking changes to session summary format
- Retention cleanup could be added as a periodic job (delete files older than `retention_days`)
- The schema.json file enables automated validation in CI/CD for consumers
