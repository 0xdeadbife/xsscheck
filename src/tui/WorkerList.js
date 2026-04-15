import React from 'react';
import { Box, Text } from 'ink';

const MAX_URL_LEN = 72;

function truncate(str) {
  return str.length > MAX_URL_LEN ? str.slice(0, MAX_URL_LEN - 1) + '…' : str;
}

/**
 * @param {{ active: Array<{url: string, surface: string, param: string|null}> }} props
 */
export function WorkerList({ active }) {
  if (active.length === 0) return null;

  return React.createElement(
    Box,
    { flexDirection: 'column', marginTop: 1, marginLeft: 2 },
    ...active.map((w, i) =>
      React.createElement(
        Box,
        { key: i },
        React.createElement(Text, { color: 'yellow' }, '● '),
        React.createElement(Text, { dimColor: true }, `[${w.surface}] `),
        React.createElement(Text, null, truncate(w.url)),
        w.param != null && React.createElement(Text, { dimColor: true }, `  param: ${w.param}`)
      )
    )
  );
}
