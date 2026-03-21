import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AgentStream } from './EventStream.js';

const HOOK_HERO_BASE = path.join(os.homedir(), '.claude', 'hook-hero');

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
}

interface ChatPanelProps {
  stream: AgentStream;
  width: number;
  height: number;
  active: boolean;     // whether this panel has focus
  onExit: () => void;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Build a concise session context string for Claude */
function buildSessionContext(stream: AgentStream): string {
  const elapsed = (stream.endTime || Date.now()) - stream.startTime;
  const toolEntries = Object.entries(stream.toolCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name}: ${count}`)
    .join(', ');

  const lines = [
    `Session: ${stream.id}`,
    `Project: ${stream.label}`,
    `Channel: ${stream.channel || 'unknown'}`,
    `Status: ${stream.done ? 'completed' : stream.idle ? 'idle' : 'active'}`,
    `Duration: ${formatDuration(elapsed)}`,
    `Tools (${Object.values(stream.toolCounts).reduce((s, c) => s + c, 0)} total): ${toolEntries || 'none'}`,
    `Failures: ${stream.failures}`,
    `Prompts: ${stream.promptCount}`,
  ];

  if (stream.tokens) {
    const t = stream.tokens;
    const cost = (t.input / 1000) * 0.005 + (t.output / 1000) * 0.025 +
      (t.cache_read / 1000) * 0.0005 + (t.cache_write / 1000) * 0.00625;
    lines.push(`Tokens: ${formatTokens(t.input)} in, ${formatTokens(t.output)} out, ${formatTokens(t.cache_read)} cache read, ${formatTokens(t.cache_write)} cache write`);
    lines.push(`Estimated cost: $${cost.toFixed(2)}`);
  }

  const eventCounts: Record<string, number> = {};
  for (const ev of stream.events) {
    eventCounts[ev.event] = (eventCounts[ev.event] || 0) + 1;
  }
  lines.push(`Events: ${Object.entries(eventCounts).map(([e, c]) => `${e}:${c}`).join(', ')}`);

  // Load session summary for git + model info
  try {
    const today = new Date().toISOString().slice(0, 10);
    const summaryPath = path.join(HOOK_HERO_BASE, 'sessions', today, `${stream.id}.json`);
    if (fs.existsSync(summaryPath)) {
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
      if (summary.git) {
        const g = summary.git;
        lines.push(`Git: ${g.commits_made} commits, ${g.files_changed} files, +${g.insertions}/-${g.deletions}, ${g.prs_created} PRs`);
      }
      if (summary.context?.model) lines.push(`Model: ${summary.context.model}`);
    }
  } catch { /* ignore */ }

  // Recent events (last 30)
  const recentEvents = stream.events.slice(-30).map(ev => {
    const ts = new Date(ev.ts).toLocaleTimeString('en-US', { hour12: false });
    const parts = [ts, ev.event];
    if (ev.tool) parts.push(ev.tool);
    const s = (ev as any).tool_input_summary;
    if (s) {
      const detail = s.command || s.file_path || s.pattern || '';
      if (detail) parts.push(detail.slice(0, 80));
    }
    return parts.join(' | ');
  });
  if (recentEvents.length > 0) {
    lines.push('', 'Recent events:', ...recentEvents);
  }

  return lines.join('\n');
}

export function ChatPanel({ stream, width, height, active, onExit }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const processRef = useRef<ReturnType<typeof spawn> | null>(null);
  const contextRef = useRef(buildSessionContext(stream));
  const prevStreamId = useRef(stream.id);

  // Reset when stream changes
  useEffect(() => {
    if (stream.id !== prevStreamId.current) {
      prevStreamId.current = stream.id;
      contextRef.current = buildSessionContext(stream);
      setMessages([]);
      setInputText('');
      setScrollOffset(0);
      if (processRef.current) {
        processRef.current.kill();
        processRef.current = null;
      }
      setIsStreaming(false);
    }
  }, [stream.id]);

  // Kill process on unmount
  useEffect(() => {
    return () => { if (processRef.current) processRef.current.kill(); };
  }, []);

  const sendMessage = useCallback((text: string) => {
    if (isStreaming || !text.trim()) return;

    const userMsg: ChatMessage = { role: 'user', text: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsStreaming(true);

    const isFirst = messages.filter(m => m.role === 'user').length === 0;
    const prompt = isFirst
      ? `You are analyzing a Claude Code session from Hook Hero telemetry. Here is the session data:\n\n${contextRef.current}\n\nUser question: ${text.trim()}\n\nProvide a concise analysis. Use plain text, no markdown headers. Keep it brief.`
      : `Follow-up question about the same session:\n\n${text.trim()}`;

    const claudePath = process.env.HOME + '/.local/bin/claude';
    const proc = spawn(claudePath, ['-p', prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
    });
    processRef.current = proc;

    let output = '';
    const assistantIdx = messages.length + 1;

    proc.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      setMessages(prev => {
        const updated = [...prev];
        const existing = updated.find((m, i) => i === assistantIdx && m.role === 'assistant');
        if (existing) {
          existing.text = output;
        } else {
          updated.push({ role: 'assistant', text: output });
        }
        return [...updated];
      });
      setScrollOffset(999999);
    });

    proc.on('close', () => {
      processRef.current = null;
      setIsStreaming(false);
      if (!output.trim()) {
        setMessages(prev => [...prev, { role: 'system', text: '(no response — is claude CLI available?)' }]);
      }
    });

    proc.on('error', () => {
      processRef.current = null;
      setIsStreaming(false);
      setMessages(prev => [...prev, { role: 'system', text: '(error spawning claude CLI)' }]);
    });
  }, [isStreaming, messages]);

  useInput((input, key) => {
    if (!active) return;

    if (key.escape) {
      if (isStreaming && processRef.current) {
        processRef.current.kill();
        processRef.current = null;
        setIsStreaming(false);
      } else if (inputText) {
        setInputText('');
      } else {
        onExit();
      }
      return;
    }

    if (isStreaming) {
      // Only scrolling while streaming
      if (key.upArrow) setScrollOffset(s => Math.max(0, s - 1));
      if (key.downArrow) setScrollOffset(s => s + 1);
      return;
    }

    if (key.return) {
      sendMessage(inputText);
      return;
    }
    if (key.backspace || key.delete) {
      setInputText(prev => prev.slice(0, -1));
      return;
    }
    if (key.upArrow) {
      setScrollOffset(s => Math.max(0, s - 1));
      return;
    }
    if (key.downArrow) {
      setScrollOffset(s => s + 1);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setInputText(prev => prev + input);
    }
  });

  // Build render lines
  const renderLines: Array<{ text: string; color: string }> = [];
  for (const msg of messages) {
    if (msg.role === 'user') {
      renderLines.push({ text: `▸ ${msg.text}`, color: '#79c0ff' });
    } else if (msg.role === 'assistant') {
      for (const line of msg.text.split('\n')) {
        renderLines.push({ text: line, color: '#c9d1d9' });
      }
    } else {
      renderLines.push({ text: msg.text, color: '#f85149' });
    }
  }
  if (isStreaming && (messages.length === 0 || messages[messages.length - 1]?.role === 'user')) {
    renderLines.push({ text: '⠋ thinking...', color: '#d2a8ff' });
  }

  const contentHeight = Math.max(1, height - 3); // border + input line + hints
  const maxScroll = Math.max(0, renderLines.length - contentHeight);
  const effectiveScroll = Math.min(scrollOffset, maxScroll);
  const visibleLines = renderLines.slice(effectiveScroll, effectiveScroll + contentHeight);

  useEffect(() => {
    if (scrollOffset > maxScroll) setScrollOffset(maxScroll);
  }, [maxScroll, scrollOffset]);

  const borderColor = active ? '#d2a8ff' : '#30363d';

  return (
    <Box flexDirection="column" height={height}>
      {/* Top border with title */}
      <Box>
        <Text color={borderColor}>{'─'} </Text>
        <Text color={active ? '#d2a8ff' : '#8b949e'} bold>AI</Text>
        <Text color="#484f58"> {stream.id.slice(0, 8)} </Text>
        {isStreaming && <Text color="#d2a8ff">streaming </Text>}
        {effectiveScroll < maxScroll && <Text color="#484f58">↓{maxScroll - effectiveScroll} </Text>}
        <Text color={borderColor}>{'─'.repeat(Math.max(1, width - 30))}</Text>
      </Box>

      {/* Content */}
      <Box flexDirection="column" flexGrow={1}>
        {messages.length === 0 && !isStreaming && (
          <Box paddingLeft={1}>
            <Text color="#6e7681">type a question and press enter</Text>
          </Box>
        )}
        {visibleLines.map((line, i) => (
          <Box key={effectiveScroll + i} paddingLeft={1}>
            <Text color={line.color} wrap="truncate-end">{line.text || ' '}</Text>
          </Box>
        ))}
      </Box>

      {/* Input line */}
      <Box paddingLeft={1}>
        {active ? (
          <>
            <Text color="#3fb950" bold>{'>'} </Text>
            <Text color="#e6edf3">{inputText}</Text>
            <Text color="#d2a8ff">{'█'}</Text>
          </>
        ) : (
          <Text color="#484f58">press tab to focus chat</Text>
        )}
      </Box>
    </Box>
  );
}
