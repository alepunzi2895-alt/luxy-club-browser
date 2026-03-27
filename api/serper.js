/**
 * LuXy Club — Serper.dev Proxy
 * Richiede SERPER_API_KEY come variabile d'ambiente su Vercel
 * oppure passata nel body come { serperKey }
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { query, serperKey } = req.body;
  if (!query) return res.status(400).json({ error: "Missing query" });

  const KEY = process.env.SERPER_API_KEY || serperKey;
  if (!KEY || KEY.trim() === "") {
    return res.status(500).json({ error: "Serper key mancante — inseriscila in Configura API nell'app oppure aggiungi SERPER_API_KEY su Vercel Settings > Env Vars" });
  }
  const cleanKey = KEY.trim();

  // Detect country from query for correct gl param
  const q = query.toLowerCase();
  const isSpain = ["ibiza","formentera","mallorca","barcellona","madrid","valencia","tenerife","marbella","menorca"].some(w => q.includes(w));
  const isGreece = ["mykonos","santorini","creta","rodi","corfu","atene"].some(w => q.includes(w));
  const gl = isSpain ? "es" : isGreece ? "gr" : "it";
  const hl = isSpain ? "es" : "it";
  const endpoint = req.body.type === "search" ? "https://google.serper.dev/search" : "https://google.serper.dev/maps";

  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "X-API-KEY": cleanKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, gl, hl, num: 20 }),
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error("Serper error:", r.status, errText);
      return res.status(r.status).json({ error: "Serper " + r.status + ": " + errText.slice(0,200), places: [] });
    }
    const data = await r.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message, places: [] });
  }
}
