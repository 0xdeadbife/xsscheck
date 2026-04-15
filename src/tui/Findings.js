import React from 'react';
import { Box, Text } from 'ink';

const MAX_PAYLOAD_LEN = 80;
const MAX_PAYLOADS_SHOWN = 3;

function truncate(str, len) {
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}

/**
 * Group raw findings by (url, param, surface) so the same injection point
 * is shown once regardless of how many payloads triggered it.
 */
function groupFindings(findings) {
  const groups = new Map();
  for (const f of findings) {
    const key = `${f.url}::${f.param ?? ''}::${f.surface}`;
    if (!groups.has(key)) {
      groups.set(key, {
        url: f.url,
        param: f.param,
        surface: f.surface,
        sink: f.sink,
        confirmed: f.confirmed,
        firefox_confirmed: f.firefox_confirmed ?? false,
        payloads: [],
      });
    }
    const g = groups.get(key);
    g.payloads.push(f.payload);
    if (f.confirmed) g.confirmed = true;
    if (f.firefox_confirmed) g.firefox_confirmed = true;
  }
  return [...groups.values()];
}

/**
 * @param {{
 *   findings: Array<{url: string, param: string|null, sink: string, confirmed: boolean, surface: string, payload: string, firefox_confirmed?: boolean}>,
 *   errors: Array<{url: string, message: string}>
 * }} props
 */
export function Findings({ findings, errors }) {
  const divider = '─'.repeat(60);
  const groups = groupFindings(findings);

  return React.createElement(
    Box,
    { flexDirection: 'column', marginTop: 1, marginLeft: 2 },

    groups.length > 0 && React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(
        Text,
        { bold: true },
        `FINDINGS — ${groups.length} endpoint${groups.length !== 1 ? 's' : ''} · ${findings.length} payload${findings.length !== 1 ? 's' : ''}`
      ),
      React.createElement(Text, { dimColor: true }, divider),
      ...groups.map((g, i) => {
        const metaParts = [
          `surface: ${g.surface}`,
          g.param != null ? `param: ${g.param}` : null,
          `sink: ${g.sink}`,
          g.confirmed ? 'confirmed' : null,
          g.firefox_confirmed ? 'firefox ✓' : null,
        ].filter(Boolean).join('  ');

        const visible = g.payloads.slice(0, MAX_PAYLOADS_SHOWN);
        const extra = g.payloads.length - visible.length;

        const payloadNodes = visible.map((p, j) =>
          React.createElement(
            Text,
            { key: `p${j}`, dimColor: true },
            `        ${j === 0 ? '↳' : ' '} ${truncate(p, MAX_PAYLOAD_LEN)}`
          )
        );
        if (extra > 0) {
          payloadNodes.push(
            React.createElement(
              Text,
              { key: 'extra', dimColor: true },
              `          +${extra} more payload${extra !== 1 ? 's' : ''}`
            )
          );
        }

        return React.createElement(
          Box,
          { key: i, flexDirection: 'column', marginBottom: 1 },
          React.createElement(
            Box,
            null,
            React.createElement(Text, { color: 'red', bold: true }, '[VULN]  '),
            React.createElement(Text, { color: 'green' }, g.url)
          ),
          React.createElement(Text, { dimColor: true }, `        ${metaParts}`),
          ...payloadNodes
        );
      }),
      React.createElement(Text, { dimColor: true }, divider)
    ),

    errors.length > 0 && React.createElement(
      Box,
      { flexDirection: 'column', marginTop: 1 },
      ...errors.map((e, i) =>
        React.createElement(
          Text,
          { key: i, dimColor: true },
          `✗ ERR  ${truncate(e.url ?? '(no url)', 50)}  — ${truncate(e.message, 100)}`
        )
      )
    )
  );
}
