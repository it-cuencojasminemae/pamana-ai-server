'use strict';

// Local, read-only file viewer. No database connection, credentials or mutation endpoints.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '../documentation');
const VENDOR = path.join(__dirname, '../../pamana-frontend/node_modules/maplibre-gl/dist');
const CODES = ['RCH-SJ-SMROB-OUT', 'RCH-SJ-SMROB-IN',
  'PILOT-ARAYAT-SF-MEXICO-BAYAN-SM-OUT', 'PILOT-PSU-MEXICO-BAYAN-TRICYCLE-OUT'];
function createReviewServer({ root = ROOT, vendor = VENDOR, reportFile = path.join(root, 'batch-a5-candidate-geometry-review.json') } = {}) {
const files = new Map([
  ['/', [path.join(root, 'batch-a5-candidates/review.html'), 'text/html; charset=utf-8']],
  ['/review.js', [path.join(root, 'batch-a5-candidates/review.js'), 'text/javascript; charset=utf-8']],
  ['/report.json', [reportFile, 'application/json']],
  ...CODES.map(code => [`/${code}.candidate.geojson`, [path.join(root, 'batch-a5-candidates', `${code}.candidate.geojson`), 'application/geo+json']]),
  ...['maplibre-gl.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl.css'].map(file => [
    `/vendor/${file}`, [path.join(vendor, file), file.endsWith('.css') ? 'text/css' : 'text/javascript']]),
]);
  return http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end('Read-only review server'); }
    const file = files.get(new URL(req.url, 'http://127.0.0.1').pathname);
    if (!file) { res.writeHead(404); return res.end('Not found'); }
    fs.readFile(file[0], (error, content) => {
      if (error) { res.writeHead(404); return res.end('Review artifact or installed MapLibre file missing'); }
      res.writeHead(200, { 'Content-Type': file[1] });
      res.end(req.method === 'HEAD' ? undefined : content);
    });
  });
}
if (require.main === module) {
  const port = Number(process.env.BATCH_A5_REVIEW_PORT || 8765);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid review port');
  const server = createReviewServer();
  server.on('error', () => { console.error('Review server failed to start. Check port and local files.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Batch A.5A manual review: http://127.0.0.1:${port}/ (read-only; Ctrl+C stops server)`));
}
module.exports = { createReviewServer };
