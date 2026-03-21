# Changelog

All notable changes to Hook Hero will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-21

### Added
- 14 lifecycle hooks: SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Stop, SubagentStart, SubagentStop, PreCompact, PostCompact, WorktreeCreate, WorktreeRemove, TaskCompleted
- StorageCodec with configurable format (msgpack or JSON)
- Dictionary compression: 56 static codes + per-session dynamic codes (47% smaller events)
- Optional AES-256-GCM encryption with auto-generated keyfile or env var
- Real-time terminal dashboard (`hook-hero live`)
- Historical session replay (`hook-hero history`)
- Export command (`hook-hero export`) with decryption support
- AI analysis chat panel (press `a` on any session)
- Cost tracking with auto-updated pricing from Anthropic
- Session summaries with tools, tokens, cost, git stats, subagents
- Debug mode for full tool input/output capture
- Cross-platform dispatcher (Unix + Windows)
- `/hook-hero-stats` slash command
- `agent-metrics` skill for natural language queries

[1.0.0]: https://github.com/damahua/claude-code-hook-hero/releases/tag/v1.0.0
