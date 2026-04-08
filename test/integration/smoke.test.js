import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { enumerateJobs } from '../../src/scanner/inject.js';
import { runJob } from '../../src/scanner/worker.js';

function startVulnerableServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url, 'http://localhost');
      const xss = u.searchParams.get('xss') ?? '';
      res.writeHead(200, { 'Content-Type': 'text/html' });
      // Deliberately reflect unescaped input — this is the vulnerable page
      res.end(`<html><body><script>
        var x = "${xss}";
      </script></body></html>`);
    });
    server.listen(0, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

test('scanner detects XSS in a vulnerable local server', async (t) => {
  const server = await startVulnerableServer();
  const { port } = server.address();
  const targetUrl = `http://127.0.0.1:${port}/?xss=hello`;

  const browser = await chromium.launch({ headless: true });

  try {
    // Payload that breaks out of the JS string context and calls alert
    const payload = '";alert(1);//';
    const jobs = enumerateJobs(targetUrl, [payload]);
    const urlParamJobs = jobs.filter(j => j.surface === 'url_param');

    assert.ok(urlParamJobs.length > 0, 'Should have at least one url_param job');

    let foundHit = false;
    for (const job of urlParamJobs) {
      const result = await runJob(browser, job, 8000);
      if (result.hit) {
        foundHit = true;
        assert.ok(result.sink !== null, 'Hit should have a sink');
        break;
      }
    }

    assert.ok(foundHit, 'Should have detected XSS in the vulnerable server');
  } finally {
    await browser.close();
    server.close();
  }
}, { timeout: 30000 });
