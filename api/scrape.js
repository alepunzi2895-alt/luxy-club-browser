/**
 * LuXy Club — Scraping Proxy
 * Fetcha URL esterni server-side (bypassa CORS del browser)
 * Fa parsing HTML e restituisce lead strutturati
 */

const ALLOWED_DOMAINS = [
  "mediavacanze.com", "subito.it",
  "idealista.com", "idealista.it",
  "t.me", "immobiliare.it"
];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { url, platform } = req.body;
  if (!url) return res.status(400).json({ error: "Missing url" });
  if (!ALLOWED_DOMAINS.some(d => url.includes(d))) {
    return res.status(403).json({ error: "Domain non autorizzato" });
  }

  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
    });

    if (!r.ok) return res.status(r.status).json({ error: "Upstream HTTP " + r.status, results: [] });

    const html = await r.text();
    const results = parseHtml(html, platform, url);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message, results: [] });
  }
}

function extractContacts(text) {
  const t = (text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const emailM = t.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  const waM = t.match(/wa\.me\/([+\d]{8,15})|whatsapp[\s:+]*([+\d][\d\s\-]{6,14})/i);
  const phM = t.match(/(?:\+|00)[1-9][\d\s\-]{8,16}/);
  return {
    email: emailM ? emailM[0] : null,
    whatsapp: waM ? (waM[1] || waM[2] || "").replace(/\D/g, "") || null : null,
    phone: (!waM && phM) ? phM[0].replace(/\s+/g, "") : null,
  };
}

function parseHtml(html, platform, baseUrl) {
  if (platform === "mediavacanze") return parseMediaVacanze(html, baseUrl);
  if (platform === "subito")       return parseSubito(html, baseUrl);
  if (platform === "idealista")    return parseIdealista(html, baseUrl);
  if (platform === "telegram")     return parseTelegram(html, baseUrl);
  return [];
}

function parseMediaVacanze(html, baseUrl) {
  const results = [];
  // MediaVacanze: listings have links like /location-vacances/ or /affitto-vacanze/
  // Extract listing blocks by splitting on common list item patterns
  const blocks = html.split(/class="[^"]*(?:annonce|listing|item-location)[^"]*"/).slice(1, 25);

  blocks.forEach(function(block) {
    const titleM = block.match(/<(?:h[23]|strong|span)[^>]*>([^<]{5,80})<\/(?:h[23]|strong|span)>/);
    const priceM = block.match(/(\d[\d\s.,]*)\s*€/);
    const linkM  = block.match(/href="(\/[^"?#]+)"/);
    const ct     = extractContacts(block);
    if (!titleM) return;
    results.push({
      platform: "mediavacanze",
      name:     titleM[1].trim(),
      type:     "Casa vacanza",
      price:    priceM ? priceM[1].replace(/\s/g,"") + "€" : "",
      email:    ct.email,
      whatsapp: ct.whatsapp,
      phone:    ct.phone,
      is_private: true,
      owner_managed: true,
      no_agency: true,
      src: linkM ? "https://www.mediavacanze.com" + linkM[1] : baseUrl,
    });
  });

  // Fallback: extract all emails/phones from page
  if (results.length === 0) {
    const ct = extractContacts(html);
    const titleM = html.match(/<title>([^<]+)<\/title>/);
    if (ct.email || ct.phone) {
      results.push({
        platform: "mediavacanze",
        name: titleM ? titleM[1].split("|")[0].trim() : "Annuncio MediaVacanze",
        type: "Casa vacanza",
        email: ct.email, whatsapp: ct.whatsapp, phone: ct.phone,
        is_private: true, owner_managed: true, no_agency: true,
        src: baseUrl,
      });
    }
  }
  return results.slice(0, 20);
}

function parseSubito(html, baseUrl) {
  const results = [];

  // Try JSON-LD structured data first
  const ldMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (ldMatch) {
    try {
      const data = JSON.parse(ldMatch[1]);
      const items = data.itemListElement || (Array.isArray(data) ? data : [data]);
      items.slice(0, 20).forEach(function(item) {
        const l = item.item || item;
        const ct = extractContacts(JSON.stringify(l));
        results.push({
          platform: "subito",
          name: l.name || "",
          type: (l["@type"] || "Annuncio").replace("Product","Annuncio"),
          price: l.offers && l.offers.price ? l.offers.price + "€" : "",
          location: l.address && l.address.addressLocality ? l.address.addressLocality : "",
          email: ct.email, whatsapp: ct.whatsapp, phone: ct.phone,
          is_private: true, owner_managed: true,
          src: l.url || baseUrl,
        });
      });
    } catch(e) {}
  }

  // Fallback: card parsing
  if (results.length === 0) {
    const cardPattern = /data-item-id="[^"]*"[^>]*>([\s\S]*?)(?=data-item-id=|$)/g;
    let m;
    let count = 0;
    while ((m = cardPattern.exec(html)) !== null && count < 20) {
      const block = m[1];
      const titleM = block.match(/class="[^"]*title[^"]*"[^>]*>([^<]{5,80})</);
      const priceM = block.match(/(\d[\d.,]+)\s*€/);
      const linkM  = block.match(/href="(\/annunci[^"]+)"/);
      if (titleM) {
        const ct = extractContacts(block);
        results.push({
          platform: "subito",
          name: titleM[1].trim(),
          type: "Annuncio affitto",
          price: priceM ? priceM[1] + "€" : "",
          email: ct.email, whatsapp: ct.whatsapp, phone: ct.phone,
          is_private: true, owner_managed: true,
          src: linkM ? "https://www.subito.it" + linkM[1] : baseUrl,
        });
        count++;
      }
    }
  }
  return results.slice(0, 20);
}

function parseIdealista(html, baseUrl) {
  const results = [];

  // Try __NEXT_DATA__ embedded JSON
  const nextM = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextM) {
    try {
      const data = JSON.parse(nextM[1]);
      const props = data.props && data.props.pageProps;
      const items = (props && (props.items || props.properties || props.ads)) || [];
      items.slice(0, 20).forEach(function(item) {
        const isPrivate = !item.realEstateAgency && !item.agency;
        results.push({
          platform: "idealista",
          name: (item.suggestedTexts && item.suggestedTexts.title) || ("Annuncio " + (item.typology && item.typology.label || "Idealista")),
          type: (item.typology && item.typology.label) || "Appartamento",
          location: item.address || item.location || "",
          price: item.price ? item.price + "€/mese" : "",
          phone: item.phone || null,
          is_private: isPrivate,
          owner_managed: isPrivate,
          no_agency: isPrivate,
          src: item.url ? "https://www.idealista.it" + item.url : baseUrl,
        });
      });
    } catch(e) {}
  }

  // Fallback regex
  if (results.length === 0) {
    const priceMs = (html.match(/(\d[\d.]+)\s*€(?:\s*\/\s*(?:mese|mes|month))?/gi) || []).slice(0, 20);
    const titleMs = (html.match(/class="[^"]*item-title[^"]*"[^>]*>([^<]{5,80})</g) || []).slice(0, 20);
    titleMs.forEach(function(tm, i) {
      const name = tm.replace(/^[^>]+>/, "").trim();
      if (name) {
        results.push({
          platform: "idealista",
          name: name,
          type: "Appartamento",
          price: priceMs[i] || "",
          is_private: false,
          src: baseUrl,
        });
      }
    });
  }
  return results.slice(0, 20);
}

function parseTelegram(html, channelUrl) {
  const results = [];
  const slug = channelUrl.split("/").filter(Boolean).pop() || "";

  // Telegram preview messages
  const msgPattern = /class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let m;
  const RENT_RE = /affitt|vacan|rent|villa|camera|appartamento|stanza|disponibile|posti|posto/i;

  while ((m = msgPattern.exec(html)) !== null) {
    const raw = m[1];
    const text = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text.length < 30 || !RENT_RE.test(text)) continue;
    const ct = extractContacts(raw + " " + text);
    results.push({
      platform: "telegram",
      name: "@" + slug,
      type: "Annuncio Telegram",
      bio: text.slice(0, 250),
      email: ct.email,
      whatsapp: ct.whatsapp,
      phone: ct.phone,
      is_private: true,
      owner_managed: true,
      no_agency: true,
      src: channelUrl,
    });
    if (results.length >= 15) break;
  }
  return results;
}
