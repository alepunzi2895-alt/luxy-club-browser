/**
 * LuXy Club — RapidAPI Proxy
 * Vercel serverless function che fa da proxy per *.p.rapidapi.com
 *
 * Uso: POST /api/rapid
 * Body: { host: "airbnb13.p.rapidapi.com", path: "/search?...", method: "GET", body: {...}, key: "rapid_key..." }
 */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { host, path, method = "GET", body, key } = req.body;

  if (!host || !path || !key) {
    return res.status(400).json({ error: "Missing host, path or key" });
  }

  // Sicurezza: accetta solo host RapidAPI
  if (!host.endsWith(".p.rapidapi.com")) {
    return res.status(403).json({ error: "Host non autorizzato" });
  }

  const url = `https://${host}${path}`;

  try {
    const options = {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-rapidapi-host": host,
        "x-rapidapi-key": key,
      },
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
