/**
 * LuXy Club — Google Places Proxy
 * Mantiene la API key Google server-side (non esposta nel browser)
 *
 * Uso: POST /api/places
 * Body: { endpoint: "textsearch/json", params: { query: "...", language: "it" } }
 */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const GOOGLE_KEY = process.env.GOOGLE_PLACES_KEY;
  if (!GOOGLE_KEY) return res.status(500).json({ error: "Google API key non configurata su Vercel" });

  const { endpoint, params } = req.body;
  if (!endpoint || !params) return res.status(400).json({ error: "Missing endpoint or params" });

  const qs = new URLSearchParams({ ...params, key: GOOGLE_KEY }).toString();
  const url = `https://maps.googleapis.com/maps/api/place/${endpoint}?${qs}`;

  try {
    const upstream = await fetch(url);
    const data = await upstream.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
