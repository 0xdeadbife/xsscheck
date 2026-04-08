import { readFile } from 'node:fs/promises';

/**
 * Load payloads from a file. Blank lines and # comments are ignored.
 * @param {string} filePath
 * @returns {Promise<string[]>}
 */
export async function loadPayloads(filePath) {
  const text = await readFile(filePath, 'utf8');
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
}
