import React from 'react';
import { useInput, useStdin } from 'ink';
import { Dashboard } from './components/Dashboard.js';
import { useLiveTelemetry, useHistoryTelemetry } from './hooks/useTelemetry.js';

interface AppProps {
  mode: 'live' | 'history';
  date?: string;
  baseDir?: string;
}

function QuitHandler() {
  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      process.exit(0);
    }
  });
  return null;
}

export function App({ mode, date, baseDir }: AppProps) {
  const liveData = useLiveTelemetry(mode === 'live' ? baseDir : undefined);
  const historyData = useHistoryTelemetry(mode === 'history' ? baseDir : undefined, date);

  const data = mode === 'live' ? liveData : historyData;
  const hasTTY = process.stdin.isTTY === true;

  return (
    <>
      {hasTTY && <QuitHandler />}
      <Dashboard data={data} mode={mode} date={date} />
    </>
  );
}
