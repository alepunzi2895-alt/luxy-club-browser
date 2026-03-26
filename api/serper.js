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

  try {
    const r = await fetch("https://google.serper.dev/maps", {
      method: "POST",
      headers: { "X-API-KEY": cleanKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, gl: "it", hl: "it", num: 20 }),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
