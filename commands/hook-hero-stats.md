---
name: hook-hero-stats
description: Show a quick summary of recent agent session activity.
---

Read all session summary files from `~/.claude/hook-hero/sessions/` for today (or the date range the user specifies). Aggregate and display:

- Number of sessions
- Total duration
- Total tokens and estimated cost
- Top tools by usage
- Repos worked on
- Channels used (claude-code vs claude-cli)
- Git activity (commits, PRs, lines changed)

Format as a clean terminal-friendly summary table.
