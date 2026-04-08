import React from 'react';
import { Box, Text } from 'ink';

const BAR_WIDTH = 20;

/**
 * @param {{ done: number, total: number }} props
 */
export function ProgressBar({ done, total }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const filled = Math.round((pct / 100) * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);

  return React.createElement(
    Box,
    { marginLeft: 2 },
    React.createElement(Text, { color: 'cyan' }, `[${bar}]`),
    React.createElement(Text, null, `  ${done}/${total}  ${pct}%`)
  );
}
