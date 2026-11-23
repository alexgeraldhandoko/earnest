/* EARNest · on-demand webscrape. HTTP fetching stays here in Earnest; the
   extraction/summarization step runs on the same provider client as game
   generation (config-selected OpenRouter/DashScope key). User-triggered —
   distinct from the hourly discovery agent. */
"use strict";
const llm = require("./llm");

function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function scrape(target) {
  let u;
  try { u = new URL(String(target || "")); } catch { throw Object.assign(new Error("Enter a valid URL to scrape."), { status: 400 }); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw Object.assign(new Error("Only http(s) URLs can be scraped."), { status: 400 });
  let res;
  try {
    res = await fetch(u.href, {
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; EARNest-research/1.0)", Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
    });
  } catch (e) {
    throw Object.assign(new Error("Could not fetch that URL: " + (e.name === "TimeoutError" ? "the site timed out." : e.message)), { status: 400 });
  }
  if (!res.ok) throw Object.assign(new Error(`The site responded HTTP ${res.status}.`), { status: 400 });
  const html = (await res.text()).slice(0, 2e6);
  const text = htmlToText(html).slice(0, 12000);
  if (text.length < 80) throw Object.assign(new Error("That page had no readable article text."), { status: 400 });
  const { content, model } = await llm.chat([
    { role: "system", content: "You extract research-relevant content from web pages. Output ONLY valid JSON: {\"title\": string, \"summary\": \"2-3 sentence summary\", \"key_points\": [\"3-6 concrete findings or claims\"], \"topics\": [\"2-5 short topic tags\"]}. Base everything strictly on the provided page text; no commentary, no markdown." },
    { role: "user", content: `Page URL: ${u.href}\n\nPage text:\n${text}` },
  ], { json: true, timeoutMs: 60000 });
  let data;
  try { data = llm.extractJson(content); } catch { throw new Error("The AI reply was not parseable JSON. Try again."); }
  if (!data.title || !data.summary || !Array.isArray(data.key_points)) throw new Error("The AI extraction was incomplete. Try again.");
  return {
    url: u.href,
    title: String(data.title).slice(0, 200),
    summary: String(data.summary).slice(0, 1000),
    key_points: data.key_points.slice(0, 8).map((k) => String(k).slice(0, 300)),
    topics: (Array.isArray(data.topics) ? data.topics : []).slice(0, 6).map((t) => String(t).slice(0, 40)),
    model,
  };
}
module.exports = { scrape };