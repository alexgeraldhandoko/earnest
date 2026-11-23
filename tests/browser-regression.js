"use strict";
const browserResults = [];
const browserErrors = [];
addEventListener('error', e => browserErrors.push(e.message));
addEventListener('unhandledrejection', e => browserErrors.push(String(e.reason)));
const pause = ms => new Promise(r => setTimeout(r, ms));
function check(value, message) { if (!value) throw new Error(message); }
async function until(fn, message) {
  const end = performance.now() + 10000;
  while (!fn()) { if (performance.now() > end) throw new Error(message); await pause(30); }
}
async function regression(name, fn) {
  try { await fn(); browserResults.push({ name, pass: true }); }
  catch (e) { browserResults.push({ name, pass: false, error: e.stack }); }
}
function touch(type, x, y, target = $('#device')) {
  const t = new Touch({ identifier: 1, target, clientX: x, clientY: y });
  target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' || type === 'touchcancel' ? [] : [t], changedTouches: [t] }));
}
async function edgeSwipe(complete, cancel = false) {
  const left = $('#device').getBoundingClientRect().left + 2;
  touch('touchstart', left, 300);
  touch('touchmove', left + (complete ? 250 : 24), 300);
  touch(cancel ? 'touchcancel' : 'touchend', left + (complete ? 250 : 24), 300);
  await pause(750);
}
async function refreshFeed() {
  const strip = $('#reels'); strip.scrollTop = 0; await pause(100);
  const zone = $('#ptr-zone'), x = $('#device').getBoundingClientRect().left + 130;
  touch('touchstart', x, 240, zone); touch('touchmove', x, 450, zone); touch('touchend', x, 450, zone);
  await pause(400);
}
addEventListener('load', async () => {
  await until(() => $('#reels .live'), 'initial feed');
  await regression('Fresh session starts unmuted', async () => check(state.sound && $('.sound-btn').getAttribute('aria-pressed') === 'true', 'default sound'));
  await regression('Both feeds paginate beyond 100 posts with bounded DOM and video nodes', async () => {
    for (const tab of ['gold', 'discover']) {
      if (state.feedTab !== tab) { $(`[data-tab="${tab}"]`).click(); await pause(100); }
      const viewed = new Set();
      for (let step = 0; step < 130; step++) {
        const strip = $('#reels');
        const live = strip.querySelector('.reel.live');
        const idx = [...strip.children].indexOf(live);
        viewed.add(live.dataset.id);
        await until(() => strip.children[idx + 1], `next card ${tab}`);
        const nextId = strip.children[idx + 1].dataset.id;
        strip.scrollTop = (idx + 1) * strip.clientHeight;
        await until(() => strip.querySelector('.reel.live')?.dataset.id === nextId, `scroll ${tab} step ${step}`);
        check(strip.children.length <= 90, 'metadata/DOM bound');
        check(strip.querySelectorAll('video').length <= 3, 'mounted video bound');
        check(new Set(feedItems().map(it => it.id)).size === feedItems().length, 'duplicate cards');
        check(posterCache.size <= 40, 'poster bound');
      }
      check(viewed.size === 130, `repeated viewed posts ${tab}: ${viewed.size}`);
    }
  });
  await regression('Mute persists through tab switches and keep-alive refresh works', async () => {
    $('.sound-btn').click(); check(!state.sound, 'muted');
    switchTab('#/profile'); await pause(100); switchTab('#/feed'); await pause(100);
    check(!state.sound && $('.sound-btn').getAttribute('aria-pressed') === 'false', 'mute preserved');
    const old = feedItems(); await refreshFeed();
    check(feedItems() !== old && state.reelIndex === 0, 'refresh after keep-alive');
    check(!testSeen.has(feedItems()[1].id), 'fresh unviewed recommendations');
  });
  await regression('Late refresh cannot replace another feed tab', async () => {
    testRefreshDelay = 600;
    const zone = $('#ptr-zone'), x = $('#device').getBoundingClientRect().left + 130;
    $('#reels').scrollTop = 0; await pause(100);
    touch('touchstart', x, 240, zone); touch('touchmove', x, 450, zone); touch('touchend', x, 450, zone);
    $('[data-tab="gold"]').click(); await pause(850); testRefreshDelay = 0;
    check(state.feedTab === 'gold' && feedItems().every(it => it.id.startsWith('gold-')), 'stale refresh switched feed');
  });
  routes['test-one'] = el => { el.innerHTML = '<div class="view" style="height:2000px">First test page</div>'; };
  routes['test-two'] = el => { el.innerHTML = '<div class="view">Second test page</div>'; };
  routes['test-slow'] = async el => { await pause(700); el.innerHTML = '<div class="view">Slow stale page</div>'; };
  await regression('Nested edge swipe returns to exact page and scroll position', async () => {
    switchTab('#/profile'); await pause(100); go('#/test-one'); await pause(450);
    $('#screen').scrollTop = 180; go('#/test-two'); await pause(450);
    await edgeSwipe(true);
    check(location.hash === '#/test-one', `wrong destination ${location.hash}`);
    check($('#screen').scrollTop === 180, `lost scroll ${$('#screen').scrollTop}`);
    check(!$('#screen').style.transform && !document.querySelector('.swipe-dim'), 'distorted layers');
    await edgeSwipe(true); check(location.hash === '#/profile', 'wrong root tab');
  });
  await regression('Cancelled edge swipe restores layers without navigating', async () => {
    go('#/test-one'); await pause(450); await edgeSwipe(false, true);
    check(location.hash === '#/test-one', 'cancel navigated');
    check(!$('#screen').style.transform && !swipeBusy, 'cancel left transform');
  });
  await regression('A tab change during swipe settling cancels the pending pop', async () => {
    const left = $('#device').getBoundingClientRect().left + 2;
    touch('touchstart', left, 300); touch('touchmove', left + 250, 300); touch('touchend', left + 250, 300);
    switchTab('#/impact'); await pause(750);
    check(location.hash === '#/impact' && !swipeBusy && !$('#screen').style.transform, 'stale swipe timer changed tab');
  });
  await regression('Rapid nested pushes retain the correct previous page', async () => {
    switchTab('#/profile'); go('#/test-one'); await pause(30); go('#/test-two'); await pause(450);
    check(underlays.length === 2, `snapshots ${underlays.length}`);
    await edgeSwipe(true); check(location.hash === '#/test-one', 'rapid push wrong parent');
    await edgeSwipe(true); check(location.hash === '#/profile', 'rapid push wrong tab');
  });
  await regression('A slow page response cannot overwrite the previous page after back', async () => {
    go('#/test-slow'); await pause(30); back(); await pause(1000);
    check(location.hash === '#/profile' && !$('#screen').textContent.includes('Slow stale'), 'stale response overwrote page');
  });
  await regression('Failed pagination can retry without losing the feed', async () => {
    state.feedTab = 'gold'; state.reelIndex = 0; studies = [];
    testFailNextFeed = true; switchTab('#/feed');
    await until(() => $('.feed-status')?.textContent.includes("Couldn't load"), 'failure status');
    $('.feed-status').click();
    await until(() => $('#reels .live'), 'retry did not restore feed');
  });
  await regression('An exhausted feed waits for fresh posts and recovers without repeats', async () => {
    testPool('gold').forEach(it => testSeen.add(it.id));
    studies = []; state.reelIndex = 0; render();
    await until(() => $('.feed-status')?.textContent.includes("You're up to date"), 'empty state');
    check(!$('#reels .reel'), 'exhausted feed repeated a viewed post');
    testSeen.delete('gold-238'); testSeen.delete('gold-239');
    $('.feed-status').click();
    await until(() => $('#reels .live'), 'newly eligible content not loaded');
    check(feedItems().every(it => ['gold-238', 'gold-239'].includes(it.id)), 'repeated seen content');
  });
  await regression('No JavaScript errors', async () => check(!browserErrors.length, browserErrors.join('\n')));
  await testNativeFetch('/test-results', { method: 'POST', body: JSON.stringify({ results: browserResults, errors: browserErrors }) });
  const report = document.createElement('pre'); report.id = 'regression-results';
  report.style = 'position:fixed;inset:0;z-index:99999;background:white;color:black;padding:24px;overflow:auto;white-space:pre-wrap';
  report.textContent = browserResults.map(r => `${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.error ? '\n'+r.error : ''}`).join('\n\n');
  document.body.appendChild(report);
});
