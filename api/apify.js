/**
 * LuXy Club — Apify Proxy
 * Handles memory param in path: /acts/actor~id/runs?memory=128
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { path, method = "GET", body, token } = req.body;
  // Use env var as primary, fallback to token from request body
  const APIFY_TOKEN = process.env.APIFY_TOKEN || token;
  if (!path) return res.status(400).json({ error: "Missing path" });
  if (!APIFY_TOKEN) return res.status(400).json({ error: "Apify token mancante — aggiungilo su Vercel Settings > Env Vars come APIFY_TOKEN" });

  // If path already has query params, use & otherwise use ?
  const separator = path.includes("?") ? "&" : "?";
  const url = `https://api.apify.com/v2${path}${separator}token=${APIFY_TOKEN}`;

  try {
    const options = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (body && (method === "POST" || method === "PUT")) {
      options.body = JSON.stringify(body);
    }
    const upstream = await fetch(url, options);
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
