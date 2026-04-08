import React, { useState, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import { ProgressBar } from './ProgressBar.js';
import { WorkerList } from './WorkerList.js';
import { Findings } from './Findings.js';

/**
 * Root Ink component. Receives an `emitter` EventEmitter that fires IPC message
 * events: 'progress', 'finding', 'error', 'done'.
 *
 * @param {{
 *   emitter: import('node:events').EventEmitter,
 *   target: string,
 *   payloadCount: number,
 *   concurrency: number,
 * }} props
 */
export function App({ emitter, target, payloadCount, concurrency }) {
  const { exit } = useApp();

  const [progress, setProgress] = useState({ done: 0, total: 0, active: [] });
  const [findings, setFindings] = useState([]);
  const [errors, setErrors] = useState([]);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    emitter.on('progress', (msg) => {
      setProgress({ done: msg.done, total: msg.total, active: msg.active });
    });

    emitter.on('finding', (msg) => {
      setFindings(prev => [...prev, msg]);
    });

    emitter.on('error', (msg) => {
      setErrors(prev => [...prev, msg]);
    });

    emitter.on('done', (msg) => {
      setSummary(msg);
      setTimeout(() => exit(), 300);
    });
  }, []);

  return React.createElement(
    Box,
    { flexDirection: 'column', paddingTop: 1 },

    // Header
    React.createElement(
      Box,
      { marginLeft: 2 },
      React.createElement(Text, { bold: true, color: 'cyan' }, 'xsscheck'),
      React.createElement(Text, { dimColor: true }, `  ▸  target: `),
      React.createElement(Text, null, target),
      React.createElement(Text, { dimColor: true }, `  ▸  payloads: `),
      React.createElement(Text, null, String(payloadCount)),
      React.createElement(Text, { dimColor: true }, `  ▸  workers: `),
      React.createElement(Text, null, String(concurrency))
    ),

    // Progress bar
    React.createElement(Box, { marginTop: 1 },
      React.createElement(ProgressBar, { done: progress.done, total: progress.total })
    ),

    // Active workers
    React.createElement(WorkerList, { active: progress.active }),

    // Findings + errors
    React.createElement(Findings, { findings, errors }),

    // Done summary
    summary && React.createElement(
      Box,
      { marginTop: 1, marginLeft: 2 },
      React.createElement(
        Text,
        { color: 'green', bold: true },
        `Done. ${summary.findings} finding(s) in ${summary.duration_ms}ms.`
      )
    ),

    // Footer hint
    !summary && React.createElement(
      Box,
      { marginTop: 1, marginLeft: 2 },
      React.createElement(Text, { dimColor: true }, '[ctrl+c to stop]')
    )
  );
}
