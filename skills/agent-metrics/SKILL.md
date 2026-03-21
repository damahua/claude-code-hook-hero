---
name: agent-metrics
description: >
  Query agent session metrics from hook-hero telemetry data. Use when the user
  asks about agent activity, efficiency, token spend, tool usage, session history,
  cost tracking, or productivity metrics. Examples: "how efficient was I this week",
  "show me my agent metrics", "which repo used the most tokens", "how much did I
  spend on Claude today".
allowed-tools: Bash, Read, Grep, Glob
---

# Agent Metrics — Hook-Hero Telemetry

Query and analyze agent session telemetry captured by the hook-hero plugin.

## Data Location

Session summaries: `~/.claude/hook-hero/sessions/{YYYY-MM-DD}/{session_id}.json`
Raw events: `~/.claude/hook-hero/events/{YYYY-MM-DD}/{session_id}.jsonl`

## How to Query

### Quick stats for a date range
Use Glob to find session files, Read each one, aggregate in a Bash one-liner:
```bash
# Today's sessions
ls ~/.claude/hook-hero/sessions/$(date +%Y-%m-%d)/*.json 2>/dev/null | wc -l
```

### Filter by repo or channel
```bash
grep -rl '"repo": "acme/my-app"' ~/.claude/hook-hero/sessions/
grep -rl '"channel": "claude-cli"' ~/.claude/hook-hero/sessions/
```

### Analyze raw events for a session
```bash
cat ~/.claude/hook-hero/events/{date}/{session_id}.jsonl
```

## Session Summary Fields

Each JSON file contains:
- **timing**: start_time, end_time, duration_seconds
- **context**: project_path, project_name, directory, cwd, repo, git_remote_url, git_branch, model
- **tools**: total_calls, by_type (map), failures
- **tokens**: input, output, total, cache_read, cache_write, estimated_cost_usd
- **git**: commits_made, branches_touched, files_changed, insertions, deletions, prs_created
- **prompts**: count
- **subagents**: total_spawned, by_type (map), total_duration_ms
- **compactions**: count
- **worktrees**: created, removed
- **tasks**: completed

## Insights to Provide

When presenting metrics, highlight:
- Total sessions, time, and cost for the period
- Which repos consume the most effort/tokens
- Channel comparison (claude-code vs claude-cli)
- Most-used tools and failure rates
- Git productivity (commits, PRs, lines changed per session)
- Subagent usage patterns
- Context compaction frequency (signals complex sessions)
