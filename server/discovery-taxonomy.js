"use strict";
/* Shared discovery taxonomy: classify scraped posts into the 22 topics / 110 subtopics,
   and map each topic to scrape queries so the pipeline can rotate evenly across topics. */
const { TOPICS } = require("./topics");

const TOPIC_KW = {
  ai: ["artificial intelligence","machine learning","neural","llm","gpt","language model","deep learning","chatbot","transformer","generative","computer vision","reinforcement learning"," ai ","ai-","algorithm","chatgpt","openai","anthropic","claude"],
  space: ["space","galaxy","exoplanet","planet","mars","rocket","launch","telescope","astronom","cosm","orbit","satellite","lunar","moon","asteroid","nasa","spacex","star","solar system","spacecraft","hubble","webb","milky way","black hole"],
  climate: ["climate","carbon","emission","renewable","solar","wind","battery","grid","warming","greenhouse","net zero","energy transition","decarbon","fossil fuel","clean energy"],
  health: ["cancer","vaccine","disease","clinical","patient","medical","health","drug","therapy","tumor","tumour","diagnos","hospital","virus","infection","treatment","pharma","surgery","immune","cardiac","diabetes"],
  brain: ["brain","neuro","cognitive","memory","attention","sleep","mental","neuron","consciousness","dementia","alzheimer","mind","psychiatr","eeg","fmri"],
  ocean: ["ocean","marine","coral","reef","sea ","fish","whale","shark","underwater","aquatic","kelp","seabird","coast","seagrass","plankton","deep sea"],
  cities: ["city","urban","transport","transit","traffic","housing","commute","infrastructure","smart city","walkab","road","mobility","pedestrian","cycling","public transit"],
  food: ["food","agriculture","crop","farm","diet","nutrition","soil","harvest","food waste","plant-based","protein","eating","meal","grocery","livestock"],
  materials: ["material","semiconductor","nanomaterial","superconductor","sensor","manufacturing","chip","polymer","graphene","nanotech","device","wearable","transistor"],
  econ: ["econom","finance","market","labor","labour","job","work","productivity","money","bank","trade","gdp","inflation","startup","venture","salary","employment","business"],
  robotics: ["robot","drone","autonomous","humanoid","automation","exoskeleton","swarm","self-driving","boston dynamics","android"],
  quantum: ["quantum","particle","physics","fusion","optic","laser","photon","condensed matter","qubit","superconduct","cern","boson","relativity"],
  genetics: ["gene","genetic","genomic","dna","crispr","microbiome","protein","synthetic biology","mutation","hered","rna","sequenc","biotech"],
  security: ["security","privacy","cyber","password","encrypt","fraud","scam","hack","bot","phishing","data protection","ransomware","breach","vulnerab","malware"],
  media: ["media","news","misinformation","fake news","journalism","social media","fact-check","trust","persuasion","platform","disinformation","propaganda","press"],
  earth: ["earth","geolog","weather","glacier","ice","pollution","environment","remote sensing","earthquake","ecosystem","biodiversity","deforest","wildfire","drought","atmospher"],
  psych: ["social","fairness","culture","relationship","wellbeing","happiness","behavior","behaviour","society","moral","cooperat","loneli","emotion","personality","bias","empathy"],
  education: ["education","learning","school","student","teach","edtech","skill","assessment","literacy","university","classroom","curricul","tutor"],
  chem: ["chem","catalys","molecule","reaction","electrochem","spectroscop","compound","green chemistry","chemical","polymer","solvent"],
  math: ["math","algorithm","optim","probability","network","model","statistic","numer","geometry","computation","theorem","equation","calculus"],
  sports: ["sport","athlete","exercise","fitness","training","running","biomechan","esport","performance","workout","marathon","olymp","football","basketball"],
  design: ["design","art","music","creative","game","visual","audio","interaction","aesthetic","gamif","animation","film","paint","architectur"],
};

// arXiv search query + optional NASA term per topic (for topic-targeted scraping).
const TOPIC_QUERIES = {
  ai: { arxiv: "artificial intelligence", nasa: null },
  space: { arxiv: "exoplanet", nasa: "galaxy" },
  climate: { arxiv: "climate change", nasa: "climate" },
  health: { arxiv: "cancer treatment", nasa: null },
  brain: { arxiv: "neuroscience cognition", nasa: null },
  ocean: { arxiv: "coral reef marine", nasa: "ocean" },
  cities: { arxiv: "urban transportation", nasa: "earth city" },
  food: { arxiv: "agriculture crop nutrition", nasa: null },
  materials: { arxiv: "semiconductor nanomaterial", nasa: null },
  econ: { arxiv: "economics labor market", nasa: null },
  robotics: { arxiv: "robotics autonomous", nasa: "robot" },
  quantum: { arxiv: "quantum computing", nasa: null },
  genetics: { arxiv: "genomics crispr", nasa: null },
  security: { arxiv: "cybersecurity privacy", nasa: null },
  media: { arxiv: "misinformation social media", nasa: null },
  earth: { arxiv: "glacier pollution environment", nasa: "earth" },
  psych: { arxiv: "social behavior wellbeing", nasa: null },
  education: { arxiv: "education learning", nasa: null },
  chem: { arxiv: "chemistry catalysis", nasa: null },
  math: { arxiv: "algorithm optimization statistics", nasa: null },
  sports: { arxiv: "exercise sports science", nasa: null },
  design: { arxiv: "generative art music game design", nasa: null },
};

function classify(title, summary, tags) {
  const text = (" " + title + " " + (summary || "") + " " + (typeof tags === "string" ? tags : (tags || []).join(" ")) + " ").toLowerCase();
  let best = null, bs = 0;
  for (const t of TOPICS) {
    let s = 0; for (const k of (TOPIC_KW[t.id] || [])) if (text.includes(k)) s += (k.length > 6 ? 2 : 1);
    if (s > bs) { bs = s; best = t; }
  }
  if (!best || bs === 0) best = TOPICS.find(t => t.id === "ai");
  let sub = best.fields[0], ss = 0;
  for (const f of best.fields) {
    const words = f.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    let s = 0; for (const w of words) if (text.includes(w)) s++;
    if (s > ss) { ss = s; sub = f; }
  }
  return { topic: best.label, topicId: best.id, sub, score: bs };
}

module.exports = { TOPICS, TOPIC_KW, TOPIC_QUERIES, classify };