/* EARNest · in-app source reader.
   Resolves a post / study / paper into a clean, readable document and, for
   arXiv sources, fetches the full abstract + HTML body once (cached) so the
   reader stays inside the app instead of bouncing to an external site. */
"use strict";
const { db, q } = require("./db");

db.exec(`CREATE TABLE IF NOT EXISTS reader_cache (
  id TEXT PRIMARY KEY, json TEXT NOT NULL, fetched_at TEXT DEFAULT (datetime('now'))
)`);

const decode = (s) => String(s || "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/\s+/g, " ").trim();

async function fetchText(url, ms = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "EARNest-Reader/1.0 (research reading)" } });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
  finally { clearTimeout(t); }
}

function arxivId(url) {
  const m = String(url || "").match(/arxiv\.org\/(?:abs|html|pdf)\/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)/i);
  return m ? m[1] : null;
}

function parseAbs(html) {
  const meta = (name) => {
    const out = [];
    const re = new RegExp('<meta[^>]+name="' + name + '"[^>]+content="([^"]*)"', "gi");
    let m; while ((m = re.exec(html))) out.push(decode(m[1]));
    return out;
  };
  const title = meta("citation_title")[0] || decode((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || "");
  const authors = meta("citation_author");
  const date = meta("citation_date")[0] || meta("citation_online_date")[0] || "";
  const absM = html.match(/<blockquote[^>]*class="[^"]*abstract[^"]*"[^>]*>([\s\S]*?)<\/blockquote>/i);
  const abstract = absM ? decode(absM[1]).replace(/^Abstract:\s*/i, "") : "";
  return { title, authors, date, abstract };
}

function parseHtmlBody(html) {
  /* arXiv HTML (LaTeXML): sections are h2/h3.ltx_title, paragraphs p.ltx_p */
  const sections = [];
  const re = /<h([23])[^>]*class="[^"]*ltx_title[^"]*"[^>]*>([\s\S]*?)<\/h\1>|<p[^>]*class="[^"]*ltx_p[^"]*"[^>]*>([\s\S]*?)<\/p>/gi;
  let m, cur = null;
  while ((m = re.exec(html))) {
    if (m[2] != null) {
      const h = decode(m[2]).replace(/^\d+(\.\d+)*\s*/, "");
      if (!h || /abstract|references|acknowledg/i.test(h)) { cur = null; continue; }
      cur = { h, paragraphs: [] };
      sections.push(cur);
    } else if (m[3] != null && cur) {
      const p = decode(m[3]);
      if (p.length > 40) cur.paragraphs.push(p);
    }
  }
  return sections.filter((s) => s.paragraphs.length).slice(0, 14);
}

async function arxivDocument(id, fallback) {
  const cached = q.get("SELECT json FROM reader_cache WHERE id=?", "arxiv:" + id);
  if (cached) { try { return JSON.parse(cached.json); } catch {} }
  const absHtml = await fetchText("https://arxiv.org/abs/" + id);
  const meta = absHtml ? parseAbs(absHtml) : {};
  let sections = [];
  const bodyHtml = await fetchText("https://arxiv.org/html/" + id);
  if (bodyHtml) sections = parseHtmlBody(bodyHtml);
  const doc = {
    title: meta.title || fallback.title,
    authors: (meta.authors && meta.authors.length) ? meta.authors : (fallback.authors || []),
    date: meta.date || fallback.date || "",
    abstract: meta.abstract || fallback.abstract || fallback.summary || "",
    sections,
    source: "arXiv", url: "https://arxiv.org/abs/" + id,
    full: sections.length > 0,
  };
  try { q.run("INSERT INTO reader_cache (id,json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json, fetched_at=datetime('now')", "arxiv:" + id, JSON.stringify(doc)); } catch {}
  return doc;
}

/* Short, plain-English source label for the reader pill. */
function readerSource(d) {
  const ai = String(d.ai || "");
  if (/arxiv/i.test(ai)) return "arXiv";
  if (/nasa/i.test(ai)) return "NASA";
  if (/hacker news/i.test(ai)) return "Hacker News";
  if (/doi\.org/i.test(String(d.source_url || ""))) return "Peer-reviewed study";
  return d.chip && d.chip !== "finding" ? d.chip : "Earnest finding";
}

/* kind: post | study | paper */
async function getReader(kind, id) {
  if (kind === "paper") {
    const p = q.get("SELECT * FROM papers WHERE id=?", id);
    if (!p) return null;
    const aid = arxivId(p.url);
    if (aid) return arxivDocument(aid, { title: p.title, authors: String(p.authors || "").split(/,\s*/), abstract: p.abstract, date: p.published_at });
    return { title: p.title, authors: String(p.authors || "").split(/,\s*/), date: p.published_at || "", abstract: p.abstract || "", sections: [], source: "EARNest paper", url: p.url || "", full: false };
  }
  if (kind === "study") {
    const s = q.get("SELECT * FROM studies WHERE id=?", id);
    if (!s) return null;
    const aid = arxivId(s.source_url);
    if (aid) return arxivDocument(aid, { title: s.title, authors: String(s.authors || "").split(/,\s*/), abstract: s.abstract, summary: s.sub, date: s.published_at });
    return { title: s.title, authors: String(s.authors || "").split(/,\s*/).filter(Boolean), date: s.published_at || "", abstract: s.abstract || s.sub || "", sections: [], source: s.credit || "Study", url: s.source_url || "", full: false };
  }
  const d = q.get("SELECT * FROM discoveries WHERE id=?", id);
  if (!d) return null;
  /* Plain-English revamp: a generated ≤200-word blog replaces the technical
     source text for discovery posts that have one. */
  if (d.blog) {
    let sections = null;
    try { sections = (JSON.parse(d.blog) || {}).sections; } catch {}
    if (Array.isArray(sections) && sections.length) {
      return {
        title: d.title, sub: d.sub || "",
        authors: String(d.author || "").split(/,\s*/).filter(Boolean),
        date: d.published_at || "",
        blog: sections, plain: true,
        source: readerSource(d), url: d.source_url || "", full: true,
      };
    }
  }
  const aid = arxivId(d.source_url);
  if (aid) return arxivDocument(aid, { title: d.title, authors: String(d.author || "").split(/,\s*/), abstract: d.summary, summary: d.summary, date: d.published_at });
  if (d.paper_id) {
    const p = q.get("SELECT * FROM papers WHERE id=?", d.paper_id);
    if (p) return { title: p.title, authors: String(p.authors || "").split(/,\s*/), date: p.published_at || "", abstract: p.abstract || d.summary || "", sections: [], source: "EARNest paper", url: p.url || d.source_url || "", full: false };
  }
  return { title: d.title, authors: String(d.author || "").split(/,\s*/).filter(Boolean), date: d.published_at || "", abstract: d.summary || d.sub || "", sections: [], source: d.source_name || d.credit || "Source", url: d.source_url || "", full: false };
}

module.exports = { getReader };