import React from 'react';
import { Dashboard } from './components/Dashboard.js';
import { useLiveTelemetry, useHistoryTelemetry } from './hooks/useTelemetry.js';

interface AppProps {
  mode: 'live' | 'history';
  date?: string;
  baseDir?: string;
}

export function App({ mode, date, baseDir }: AppProps) {
  const liveData = useLiveTelemetry(mode === 'live' ? baseDir : undefined);
  const historyData = useHistoryTelemetry(mode === 'history' ? baseDir : undefined, date);

  const data = mode === 'live' ? liveData : historyData;

  return <Dashboard data={data} mode={mode} date={date} />;
}
