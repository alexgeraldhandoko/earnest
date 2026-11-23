/* EARNest · interest taxonomy for onboarding (Instagram/X-style explicit picks).
   These are NOT post labels — posts are never assigned an enum topic. The picks
   only seed the user's interest vector; matching is computed from content text. */
"use strict";

const TOPICS = [
  { id: "ai", label: "AI & machine learning", icon: "bolt", fields: ["Large language models", "Computer vision", "Reinforcement learning", "AI safety", "Generative models"] },
  { id: "space", label: "Space & astronomy", icon: "star", fields: ["Exoplanets", "Cosmology", "Rockets & launch", "Telescopes", "Planetary science"] },
  { id: "climate", label: "Climate & energy", icon: "sprout", fields: ["Solar & wind", "Batteries & grids", "Carbon capture", "Climate modelling", "Policy"] },
  { id: "health", label: "Health & medicine", icon: "pulse", fields: ["Cancer research", "Vaccines", "Public health", "Medical devices", "Nutrition"] },
  { id: "brain", label: "Brain & behaviour", icon: "dna", fields: ["Attention", "Memory", "Decision-making", "Sleep", "Mental health"] },
  { id: "ocean", label: "Ocean & wildlife", icon: "wave", fields: ["Coral reefs", "Marine biology", "Conservation", "Animal behaviour", "Fisheries"] },
  { id: "cities", label: "Cities & transport", icon: "globe", fields: ["Urban design", "Transit", "Housing", "Traffic & mobility", "Smart cities"] },
  { id: "food", label: "Food & agriculture", icon: "sprout", fields: ["Crop science", "Soil & water", "Food tech", "Supply chains", "Sustainability"] },
  { id: "materials", label: "Materials & devices", icon: "chest", fields: ["Semiconductors", "Nanomaterials", "Superconductors", "Sensors", "Manufacturing"] },
  { id: "econ", label: "Economics & work", icon: "medal", fields: ["Labour markets", "Behavioural economics", "Finance", "Development", "Productivity"] },
  { id: "robotics", label: "Robotics & drones", icon: "gamepad", fields: ["Humanoids", "Autonomy", "Swarm systems", "Field robotics", "Human-robot interaction"] },
  { id: "quantum", label: "Quantum & physics", icon: "bolt", fields: ["Quantum computing", "Particle physics", "Optics & lasers", "Fusion", "Condensed matter"] },
  { id: "genetics", label: "Genetics & bio", icon: "dna", fields: ["Gene editing", "Genomics", "Synthetic biology", "Proteins", "Microbiome"] },
  { id: "security", label: "Security & privacy", icon: "shield", fields: ["Cryptography", "Bot detection", "Fraud", "Privacy tech", "Network security"] },
  { id: "media", label: "Media & misinformation", icon: "comment", fields: ["Fact-checking", "Social platforms", "Journalism", "Persuasion", "Trust"] },
  { id: "earth", label: "Earth & environment", icon: "globe", fields: ["Geology", "Weather", "Glaciers & ice", "Pollution", "Remote sensing"] },
  { id: "psych", label: "Psychology & society", icon: "person", fields: ["Social behaviour", "Fairness", "Culture", "Relationships", "Wellbeing"] },
  { id: "education", label: "Education & learning", icon: "bookmark", fields: ["EdTech", "Learning science", "Assessment", "Access", "Skills"] },
  { id: "chem", label: "Chemistry", icon: "chest", fields: ["Catalysis", "Green chemistry", "Electrochemistry", "Polymers", "Spectroscopy"] },
  { id: "math", label: "Mathematics & stats", icon: "pulse", fields: ["Optimisation", "Probability", "Networks", "Modelling", "Algorithms"] },
  { id: "sports", label: "Sport & performance", icon: "flame", fields: ["Training science", "Biomechanics", "Recovery", "Analytics", "Esports"] },
  { id: "design", label: "Art, design & audio", icon: "star", fields: ["Interaction design", "Music tech", "Visual culture", "Games", "Creativity"] },
];

const GOALS = [
  { id: "earn", label: "Earn in spare moments" },
  { id: "impact", label: "Contribute to real research" },
  { id: "learn", label: "Discover breakthroughs early" },
  { id: "play", label: "Play research games" },
];

const FORMATS = [
  { id: "video", label: "Short video reels" },
  { id: "read", label: "Quick reads & findings" },
  { id: "games", label: "Interactive games" },
  { id: "surveys", label: "Paid studies" },
];

const WINDOWS = [
  { id: "commute", label: "Commute" },
  { id: "lunch", label: "Lunch break" },
  { id: "waiting", label: "Waiting rooms & queues" },
  { id: "evening", label: "Evening wind-down" },
];

module.exports = { TOPICS, GOALS, FORMATS, WINDOWS };