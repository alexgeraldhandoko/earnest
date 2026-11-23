"use strict";
history.replaceState(null, "", "#/feed");
const testNativeFetch = window.fetch.bind(window);
const testSeen = new Set();
const testCacheFetches = new Map();
const testBlobUrls = new Set();
const nativeObjectURL = URL.createObjectURL.bind(URL), nativeRevokeURL = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = blob => { const url = nativeObjectURL(blob); testBlobUrls.add(url); return url; };
URL.revokeObjectURL = url => { testBlobUrls.delete(url); nativeRevokeURL(url); };
const testUnlockedPlayers = new WeakSet();
let testPhoneAudioPolicy = false;
const testNativePlay = HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play = function () {
  if (testPhoneAudioPolicy) {
    if (!this.muted && !testUnlockedPlayers.has(this)) return Promise.reject(new DOMException('This element needs a gesture', 'NotAllowedError'));
    return Promise.resolve();
  }
  return testNativePlay.call(this);
};
let testRefreshDelay = 0, testFailNextFeed = false;
const testPool = (tab) => Array.from({ length: 240 }, (_, i) => ({
  id: `${tab}-${i}`, kind: tab === 'gold' ? 'study' : 'news', genre: 'earn',
  title: `Test ${tab} post ${i}`, sub: 'Regression fixture', researcher: 'r1', minutes: 2,
  reward: 0.5, chip: 'Research', rail: { heart: '1', repost: '0', comment: '0' },
  video: `/videos/real/s-2157.mp4?fixture=${tab}-${i}`,
}));
const testUser = { id: 1, name: 'Test User', initials: 'TU', researcher_mode: false };
const testBootstrap = () => ({
  user: testUser, researchers: { r1: { name: 'Test Researcher', org: 'Test Lab', initials: 'TR' } }, papers: {},
  studies: testPool('gold').slice(0, 30), discoveries: testPool('discover').slice(0, 30), impact: [],
  follows: {}, hearts: {}, reposts: {}, answered: {}, unlocked: {}, completed: [], methods: [], withdrawals: [], ledger: [],
  settings: { autoplay: 1 }, oauth: {}, withdraw: { min_cents: 1000, fee_rate: 0.02, min_fee_cents: 25 },
  preferences: { topics: ['science'], fields: [], goals: [], formats: [] }, wallet_cents: 0, streak_day: 0, multiplier_left: 0,
});
window.fetch = async (input, options = {}) => {
  const url = new URL(input, location.href);
  if (url.pathname.startsWith('/videos/')) testCacheFetches.set(url.href, (testCacheFetches.get(url.href) || 0) + 1);
  if (!url.pathname.startsWith('/api/')) return testNativeFetch(input, options);
  let body = {};
  if (url.pathname === '/api/auth/me') body = { user: testUser };
  if (url.pathname === '/api/bootstrap') body = testBootstrap();
  if (url.pathname === '/api/events') { const event = JSON.parse(options.body); if (event.kind === 'impression') testSeen.add(event.item_id); }
  if (url.pathname === '/api/feed') {
    if (testFailNextFeed) { testFailNextFeed = false; throw new Error('Simulated offline'); }
    if (url.searchParams.has('refresh') && testRefreshDelay) await new Promise(r => setTimeout(r, testRefreshDelay));
    const exclude = new Set((url.searchParams.get('exclude') || '').split(','));
    body = testPool(url.searchParams.get('tab')).filter(it => !testSeen.has(it.id) && !exclude.has(it.id)).slice(0, 30);
  }
  if (url.pathname === '/api/search') body = { people: [], items: [], studies: [], discoveries: [], papers: [] };
  if (url.pathname === '/api/games') body = { games: [] };
  if (url.pathname === '/api/wallet') body = testBootstrap();
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
