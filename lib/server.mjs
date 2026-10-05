import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { manifest, payloads, seedFor } from './scenarios.mjs';

// Only generated fixtures, one scenario per server; no proxying or URL input.
export async function startFixtureServer(scenario) {
  const requests = [];
  const sockets = new Set();
  const offset = seedFor(scenario).length;
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, path: req.url, range: req.headers.range, ifRange: req.headers['if-range'], acceptEncoding: req.headers['accept-encoding'] });
    if (requests.length > 2 || req.method !== 'GET' || req.url !== '/artifact' || req.headers.range !== `bytes=${offset}-` || req.headers['if-range'] !== manifest.payloads.v1.etag || req.headers['accept-encoding'] !== 'identity') {
      res.writeHead(400, { 'Content-Length': 0 }); res.end(); return;
    }
    if (scenario.id === 'stall') return; // Test-only deadline fixture.
    const total = payloads.v1.length;
    let body = payloads.v1.subarray(offset);
    let status = 206;
    const headers = { ETag: manifest.payloads.v1.etag, 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${offset}-${total - 1}/${total}`, Connection: 'close' };
    if (scenario.id === 'changed-etag-200' || scenario.id === 'ignored-range-200' || scenario.id === 'encoded-200') {
      status = 200;
      body = payloads[scenario.version];
      headers.ETag = manifest.payloads[scenario.version].etag;
      delete headers['Content-Range'];
    }
    if (scenario.id === 'wrong-start-206') headers['Content-Range'] = `bytes ${offset + 1}-${total - 1}/${total}`;
    if (scenario.id === 'invalid-end-206') headers['Content-Range'] = `bytes ${offset}-${offset - 1}/${total}`;
    if (scenario.id === 'invalid-total-206') headers['Content-Range'] = `bytes ${offset}-${total - 1}/${total - 1}`;
    if (scenario.id === 'unknown-total-206') headers['Content-Range'] = `bytes ${offset}-${total - 1}/*`;
    if (scenario.id === 'changed-etag-206') headers.ETag = manifest.payloads.v2.etag;
    if (scenario.id === 'missing-etag-206') delete headers.ETag;
    if (scenario.id === 'weak-etag-206') headers.ETag = `W/${headers.ETag}`;
    if (scenario.id === 'unproven-416') {
      status = 416; body = Buffer.alloc(0);
      headers['Content-Range'] = `bytes */${total}`;
      delete headers.ETag;
    }
    if (scenario.id.startsWith('encoded-')) { body = gzipSync(body); headers['Content-Encoding'] = 'gzip'; }
    if (scenario.id === 'short-body-206') body = body.subarray(0, body.length - 17);
    headers['Content-Length'] = body.length;
    res.writeHead(status, headers);
    if (scenario.id === 'truncated-206') {
      res.flushHeaders();
      res.write(body.subarray(0, 31), () => res.socket?.destroy());
      return;
    }
    res.end(body);
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.headersTimeout = 1500;
  server.requestTimeout = 2000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    url: `http://127.0.0.1:${server.address().port}/artifact`, requests,
    async close() {
      const closed = new Promise(resolve => server.close(resolve));
      for (const socket of sockets) socket.destroy();
      await closed;
    },
  };
}
