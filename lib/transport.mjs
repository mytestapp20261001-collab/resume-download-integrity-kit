import http from 'node:http';

export function fetchFixture(url, headers, { timeoutMs = 1200, maxBytes = 262144 } = {}) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port || endpoint.username || endpoint.password || endpoint.pathname !== '/artifact' || endpoint.search || endpoint.hash) throw new Error('Only the generated loopback fixture endpoint is allowed');
  return new Promise((resolve, reject) => {
    let response;
    const request = http.get(endpoint, { headers, agent: false }, res => {
      response = res;
      const chunks = [];
      let length = 0;
      res.on('data', chunk => {
        length += chunk.length;
        if (length > maxBytes) { request.destroy(new Error('Response exceeds fixture limit')); return; }
        chunks.push(chunk);
      });
      res.on('error', fail);
      res.on('aborted', () => fail(new Error('Truncated response')));
      res.on('end', () => {
        clearTimeout(timer);
        if (!res.complete) { reject(new Error('Incomplete HTTP message')); return; }
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
      });
    });
    function fail(error) { clearTimeout(timer); reject(error); }
    const timer = setTimeout(() => { response?.destroy(); request.destroy(new Error('Request deadline exceeded')); }, timeoutMs);
    request.on('error', fail);
  });
}
