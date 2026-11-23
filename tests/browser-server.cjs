// Local, isolated browser regression harness. Never connects to the app DB.
// Run: node tests/browser-server.cjs, then open http://localhost:4318.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'public');
let results = null;
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/test-results') {
    if (req.method === 'POST') { let body = ''; req.on('data', c => body += c); req.on('end', () => { results = JSON.parse(body); res.end('ok'); }); }
    else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(results)); }
    return;
  }
  if (url.pathname === '/browser-preload.js' || url.pathname === '/browser-regression.js') {
    res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(__dirname, url.pathname.slice(1)))); return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    html = html.replace(/<link[^>]+https:[^>]+>/g, '').replace(/<script>\s*if \("serviceWorker"[\s\S]*?<\/script>/, '');
    html = html.replace('<script src="./app.js">', '<script src="/browser-preload.js"></script><script src="./app.js">');
    html = html.replace('</body>', '<script src="/browser-regression.js"></script></body>');
    res.setHeader('Content-Type', 'text/html'); res.end(html); return;
  }
  const file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', ({'.js':'text/javascript','.css':'text/css','.mp4':'video/mp4','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'})[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(4318, '127.0.0.1', () => console.log('Isolated browser tests: http://localhost:4318'));
