/* EARNest · text embeddings — TF-IDF sparse vectors, the "two-tower" retrieval
   layer at this scale (a full scan + dot product, per Meta Explore / YouTube's
   candidate-generation → ranking funnel). Zero dependencies. */
"use strict";

const STOP = new Set(("a an and are as at be been but by for from has have had if in into is it its of on or that the this to was were will with not no nor so than too very can could should would may might do does did done just about above after again all also any because before below between both during each few further here how more most other out over own same some such then there these they those through under until up what when where which while who whom why you your yours i me my we our ours he him his she her hers them their theirs").split(" "));

function tokens(text) {
  return String(text || "").toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/)
    .filter((w) => w.length >= 3 && w.length <= 24 && !STOP.has(w));
}

/* Build an IDF table from a corpus of documents (arrays of tokens). */
function buildIdf(docs) {
  const df = new Map();
  for (const toks of docs) {
    const seen = new Set(toks);
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = Math.max(1, docs.length);
  const idf = new Map();
  for (const [t, n] of df) idf.set(t, Math.log((N + 1) / (n + 0.5)) + 1);
  return idf;
}

/* L2-normalized sparse TF-IDF vector. Tags are weighted like Instagram's
   interest tokens — stronger evidence than body prose. */
function vectorize(text, tags, idf) {
  const tf = new Map();
  for (const t of tokens(text)) tf.set(t, (tf.get(t) || 0) + 1);
  for (const tag of tags || []) for (const t of tokens(tag)) tf.set(t, (tf.get(t) || 0) + 2.5);
  const v = {};
  let norm = 0;
  for (const [t, n] of tf) {
    const w = (1 + Math.log(n)) * (idf.get(t) || Math.log(2));
    v[t] = w; norm += w * w;
  }
  norm = Math.sqrt(norm) || 1;
  for (const t of Object.keys(v)) v[t] /= norm;
  return v;
}

function cosine(a, b) {
  if (!a || !b) return 0;
  const [small, big] = Object.keys(a).length < Object.keys(b).length ? [a, b] : [b, a];
  let dot = 0;
  for (const t of Object.keys(small)) if (big[t]) dot += small[t] * big[t];
  return dot; // both L2-normalized
}

function addScaled(target, vec, k) {
  for (const [t, w] of Object.entries(vec || {})) target[t] = (target[t] || 0) + k * w;
  return target;
}
function normalize(v) {
  let norm = 0;
  for (const w of Object.values(v)) norm += w * w;
  norm = Math.sqrt(norm);
  if (!norm) return v;
  for (const t of Object.keys(v)) v[t] /= norm;
  return v;
}
function decay(v, k) {
  for (const t of Object.keys(v)) { v[t] *= k; if (Math.abs(v[t]) < 1e-4) delete v[t]; }
  return v;
}

/* Deterministic PRNG for reproducible exploration / game specs. */
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) { h ^= String(str).charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Gamma sampler (Marsaglia–Tsang) → Beta samples for Thompson exploration. */
function gammaSample(shape, rng) {
  if (shape < 1) {
    const u = rng();
    return gammaSample(shape + 1, rng) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do {
      // Box–Muller normal
      const u1 = rng() || 1e-9, u2 = rng();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng() || 1e-9;
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
function betaSample(alpha, beta, rng) {
  const x = gammaSample(alpha, rng), y = gammaSample(beta, rng);
  return x / (x + y);
}

module.exports = { tokens, buildIdf, vectorize, cosine, addScaled, normalize, decay, hashSeed, mulberry32, betaSample };