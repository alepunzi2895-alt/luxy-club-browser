/**
 * LuXy Club — Config endpoint
 * Serves API keys from Vercel env vars to the frontend
 * So the user never needs to re-enter them after a deploy
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).end();

  // Only return keys that are actually set — never return undefined/null
  const config = {};
  if (process.env.APIFY_TOKEN)   config.apify  = process.env.APIFY_TOKEN;
  if (process.env.SERPER_API_KEY) config.serper = process.env.SERPER_API_KEY;
  // Never expose ANTHROPIC_API_KEY to frontend — it stays server-side only

  res.status(200).json({
    hasApify:  !!process.env.APIFY_TOKEN,
    hasSerper: !!process.env.SERPER_API_KEY,
    hasClaude: !!process.env.ANTHROPIC_API_KEY,
    keys: config,
  });
}
