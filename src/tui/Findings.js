import React from 'react';
import { Box, Text } from 'ink';

/**
 * @param {{
 *   findings: Array<{url: string, param: string|null, sink: string, confirmed: boolean, surface: string}>,
 *   errors: Array<{url: string, message: string}>
 * }} props
 */
export function Findings({ findings, errors }) {
  const divider = '─'.repeat(60);

  return React.createElement(
    Box,
    { flexDirection: 'column', marginTop: 1, marginLeft: 2 },

    findings.length > 0 && React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(Text, { bold: true }, `FINDINGS (${findings.length})`),
      React.createElement(Text, { dimColor: true }, divider),
      ...findings.map((f, i) =>
        React.createElement(
          Box,
          { key: i, flexDirection: 'column', marginBottom: 1 },
          React.createElement(
            Box,
            null,
            React.createElement(Text, { color: 'red', bold: true }, '⚡ VULN  '),
            React.createElement(Text, { color: 'green' }, f.url)
          ),
          React.createElement(
            Text,
            { dimColor: true },
            `         sink: ${f.sink}  surface: ${f.surface}  param: ${f.param ?? 'n/a'}  confirmed: ${f.confirmed ? 'yes' : 'no'}`
          )
        )
      ),
      React.createElement(Text, { dimColor: true }, divider)
    ),

    errors.length > 0 && React.createElement(
      Box,
      { flexDirection: 'column', marginTop: 1 },
      ...errors.map((e, i) =>
        React.createElement(
          Text,
          { key: i, dimColor: true },
          `✗ ERR  ${e.url}  — ${e.message}`
        )
      )
    )
  );
}
