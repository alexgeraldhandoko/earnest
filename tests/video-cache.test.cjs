"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { Writable } = require('node:stream');
const { finished } = require('node:stream/promises');
const ROOT = path.join(__dirname, '..');
function hostFixture(fetchImpl) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'earnest-cache-test-'));
  fs.mkdirSync(path.join(dir, 'server'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'public/videos/real'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'public/videos/real/_hosted_urls.json'), JSON.stringify({ 's-one': 'https://ptc2aptn.qwenwork.page/videos/real/s-one.mp4' }));
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'server/videohost.js'), 'utf8'), {
    module: mod, __dirname: path.join(dir, 'server'), Buffer, AbortSignal, process: { env: {} },
    require: name => name === 'node:os' ? { tmpdir: () => dir } : require(name), fetch: fetchImpl,
  });
  const host = mod.exports;
  async function serve(range, id = 's-one') {
    let status, headers; const chunks = [];
    const res = new Writable({ write(chunk, enc, done) { chunks.push(chunk); done(); } });
    res.writeHead = (s, h) => { status = s; headers = h; };
    const served = await host.serve({ headers: { range } }, res, id);
    if (served) await finished(res);
    return { served, status, headers, body: Buffer.concat(chunks) };
  }
  return { host, serve, dir, close: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
test('audited legacy clips use the app origin; arbitrary hosts are never proxied', async () => {
  const f = hostFixture(() => { throw new Error('unexpected network'); });
  try {
    assert.equal(f.host.playbackUrl('https://ptc2aptn.qwenwork.page/videos/real/s-one.mp4'), '/videos/real/s-one.mp4');
    for (const url of ['https://other.example/videos/real/s-one.mp4', 'https://ptc2aptn.qwenwork.page/videos/real/unknown.mp4', '/uploads/my.mp4']) assert.equal(f.host.playbackUrl(url), url);
    assert.equal((await f.serve(null, 'unknown')).served, false);
    assert.equal((await f.serve(null, '../s-one')).served, false);
  } finally { f.close(); }
});
test('concurrent prefetch and playback share one download; replays use cache and support ranges', async () => {
  let downloads = 0;
  const content = Buffer.from('0123456789video-fixture');
  const f = hostFixture(async () => { downloads++; await new Promise(r => setTimeout(r, 20)); return new Response(content, { headers: { 'Content-Type': 'video/mp4', 'Content-Length': content.length } }); });
  try {
    const [a, b] = await Promise.all([f.serve(), f.serve('bytes=2-5')]);
    assert.equal(downloads, 1); assert.equal(a.status, 200); assert.deepEqual(a.body, content);
    assert.equal(b.status, 206); assert.equal(b.body.toString(), '2345');
    assert.equal(b.headers['Content-Range'], `bytes 2-5/${content.length}`);
    assert.equal((await f.serve('bytes=999-')).status, 416);
    await f.serve(); assert.equal(downloads, 1);
  } finally { f.close(); }
});
test('oversized and non-video upstream responses never enter the cache', async () => {
  for (const headers of [{ 'Content-Type': 'text/html' }, { 'Content-Type': 'video/mp4', 'Content-Length': 100 * 1024 * 1024 }]) {
    const f = hostFixture(async () => new Response('bad', { headers }));
    try { assert.equal((await f.serve()).served, false); assert.ok(!fs.existsSync(path.join(f.dir, 'earnest-clip-cache/s-one.mp4'))); }
    finally { f.close(); }
  }
});
function audioFixture() {
  const source = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
  const video = { dataset: {}, muted: false, isConnected: true, src: 'first', closest: () => true, getAttribute: () => video.src };
  const button = { setAttribute() {}, innerHTML: '' };
  const context = vm.createContext({ state: { sound: true }, document: { querySelector: selector => selector === '.sound-btn' ? button : video }, icon: () => '' });
  vm.runInContext(source.slice(source.indexOf('const reelPlayRequests ='), source.indexOf('function mountReels(')), context);
  return { context, video, play: () => context.playReel(video) };
}
test('a late rejected play cannot mute a newer playback or a rebound source', async () => {
  const f = audioFixture(); let reject;
  f.video.play = () => new Promise((resolve, r) => reject = r);
  f.play(); f.video.src = 'second';
  f.video.play = () => Promise.resolve(); f.play();
  reject(Object.assign(new Error('old request blocked'), { name: 'NotAllowedError' }));
  await new Promise(r => setImmediate(r));
  assert.equal(f.video.muted, false); assert.equal(f.video.dataset.soundBlocked, undefined);
});
test('a genuine audio block is tracked without changing the session sound preference', async () => {
  const f = audioFixture(); let attempts = 0;
  f.video.play = () => ++attempts === 1 ? Promise.reject(Object.assign(new Error('gesture required'), { name: 'NotAllowedError' })) : Promise.resolve();
  f.play(); await new Promise(r => setImmediate(r));
  assert.equal(f.video.muted, true); assert.equal(f.video.dataset.soundBlocked, 'true'); assert.equal(f.context.state.sound, true);
  f.video.muted = false; f.play(); await new Promise(r => setImmediate(r));
  assert.equal(f.video.muted, false); assert.equal(f.video.dataset.soundBlocked, undefined);
});
