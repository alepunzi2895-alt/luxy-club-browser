/**
 * LuXy Club — Scraping Proxy
 * Fetcha URL esterni server-side (bypassa CORS del browser)
 * Fa parsing HTML e restituisce lead strutturati
 */

const ALLOWED_DOMAINS = [
  "mediavacanze.com", "subito.it",
  "idealista.com", "idealista.it",
  "t.me", "immobiliare.it",
  "fotocasa.es", "spitogatos.gr"
];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { url, platform } = req.body;
  if (!url) return res.status(400).json({ error: "Missing url" });
  // For contact page enrichment, allow any HTTPS domain
  const isContactPage = platform === "contact";
  if (!isContactPage && !ALLOWED_DOMAINS.some(d => url.includes(d))) {
    return res.status(403).json({ error: "Domain non autorizzato" });
  }
  // Security: only allow HTTPS for contact pages
  if (isContactPage && !url.startsWith("https://")) {
    return res.status(403).json({ error: "Solo HTTPS consentito" });
  }

  try {
    // Pick referer based on platform
    const referers = {
      mediavacanze: "https://www.google.it/",
      subito:       "https://www.google.it/",
      idealista:    "https://www.idealista.it/",
      immobiliare:  "https://www.immobiliare.it/",
      telegram:     "https://t.me/",
    };
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "max-age=0",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
        "Referer": referers[platform] || "https://www.google.it/",
      },
      redirect: "follow",
    });

    if (!r.ok) return res.status(r.status).json({ error: "Upstream HTTP " + r.status, results: [] });

    const html = await r.text();
    const results = parseHtml(html, platform, url);
    // For contact pages, also return raw text for enrichment
    if (platform === "contact") {
      const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 3000);
      res.json({ results, text });
    } else {
      res.json({ results });
    }
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
  if (platform === "contact")      return parseContactPage(html, baseUrl);
  if (platform === "mediavacanze") return parseMediaVacanze(html, baseUrl);
  if (platform === "subito")       return parseSubito(html, baseUrl);
  if (platform === "idealista")    return parseIdealista(html, baseUrl);
  if (platform === "telegram")     return parseTelegram(html, baseUrl);
  if (platform === "immobiliare")  return parseImmobiliare(html, baseUrl);
  if (platform === "fotocasa")     return parseFotocasa(html, baseUrl);
  if (platform === "spitogatos")   return parseSpitogatos(html, baseUrl);
  return [];
}

function parseMediaVacanze(html, baseUrl) {
  const results = [];

  // Try JSON-LD structured data
  const ldMatches = html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of ldMatches) {
    try {
      const data = JSON.parse(m[1]);
      const items = Array.isArray(data) ? data : (data["@graph"] || [data]);
      items.forEach(function(item) {
        if (!item.name) return;
        const ct = extractContacts(JSON.stringify(item));
        results.push({
          platform: "mediavacanze",
          name: item.name.slice(0, 80),
          type: item["@type"] || "Casa vacanza",
          location: item.address ? (item.address.addressLocality || "") : "",
          price: item.offers && item.offers.price ? item.offers.price + "€" : "",
          email: ct.email, whatsapp: ct.whatsapp, phone: ct.phone,
          is_private: true, owner_managed: true, no_agency: true,
          src: item.url || baseUrl,
        });
      });
    } catch(e) {}
  }

  // Fallback: scan for listing blocks by href pattern
  if (results.length === 0) {
    const linkPattern = /href="(\/[a-z\-]+\/[0-9]+[^"]*)"[^>]*>[\s\S]*?(?:class="[^"]*(?:title|name|titre)[^"]*"|<h[23])[^>]*>([^<]{5,80})</gi;
    let m;
    while ((m = linkPattern.exec(html)) !== null && results.length < 20) {
      const ct = extractContacts(html.slice(m.index, m.index + 500));
      results.push({
        platform: "mediavacanze",
        name: m[2].trim(),
        type: "Casa vacanza",
        email: ct.email, whatsapp: ct.whatsapp, phone: ct.phone,
        is_private: true, owner_managed: true, no_agency: true,
        src: "https://www.mediavacanze.com" + m[1],
      });
    }
  }

  // Last resort: extract page title + any contacts found on page
  if (results.length === 0) {
    const titleM = html.match(/<title>([^<|]{5,80})/);
    const ct = extractContacts(html);
    if (titleM) {
      results.push({
        platform: "mediavacanze", name: titleM[1].trim(),
        type: "Casa vacanza", email: ct.email, whatsapp: ct.whatsapp, phone: ct.phone,
        is_private: true, owner_managed: true, no_agency: true, src: baseUrl,
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
  const RENT_RE = /affitt|vacan|rent|villa|camera|appartament|stanza|disponibil|affitto|bedroom|posto letto|vendo|for rent|alquil/i;

  // Extract full message wrappers to get message ID
  const wrapPattern = /data-post="([^"]+)"[^>]*>([\s\S]*?)(?=data-post=|<\/section|$)/gi;
  let wm;
  while ((wm = wrapPattern.exec(html)) !== null && results.length < 15) {
    const postId = wm[1]; // e.g. "channelname/1234"
    const block  = wm[2];
    // Extract text from message
    const textMatch = block.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (!textMatch) continue;
    const raw  = textMatch[1];
    const text = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text.length < 20 || !RENT_RE.test(text)) continue;
    const ct = extractContacts(raw + " " + text);
    // Build direct message link
    const parts = postId.split("/");
    const msgNum = parts[parts.length - 1];
    const directLink = msgNum ? "https://t.me/" + slug + "/" + msgNum : channelUrl;
    results.push({
      platform: "telegram",
      name: "@" + slug + (msgNum ? " #" + msgNum : ""),
      type: "Annuncio Telegram",
      bio: text.slice(0, 300),
      email: ct.email,
      whatsapp: ct.whatsapp,
      phone: ct.phone,
      telegram_channel: slug,
      channel_url: "https://t.me/" + slug,
      msg_id: msgNum || null,
      is_private: true,
      owner_managed: true,
      no_agency: true,
      src: directLink,
    });
  }

  // Fallback: old pattern without post ID
  if (results.length === 0) {
    const msgPattern = /class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let m;
    while ((m = msgPattern.exec(html)) !== null && results.length < 10) {
      const raw  = m[1];
      const text = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (text.length < 20 || !RENT_RE.test(text)) continue;
      const ct = extractContacts(raw + " " + text);
      results.push({
        platform: "telegram",
        name: "@" + slug,
        type: "Annuncio Telegram",
        bio: text.slice(0, 300),
        email: ct.email, whatsapp: ct.whatsapp, phone: ct.phone,
        telegram_channel: slug,
        channel_url: "https://t.me/" + slug,
        is_private: true, owner_managed: true, no_agency: true,
        src: channelUrl,
      });
    }
  }
  return results;
}

function parseImmobiliare(html, baseUrl) {
  const results = [];

  // Try JSON-LD / __NEXT_DATA__
  const nextM = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextM) {
    try {
      const data = JSON.parse(nextM[1]);
      const props = data.props && data.props.pageProps;
      const items = (props && (props.results || props.listings || props.ads)) || [];
      items.slice(0, 20).forEach(function(item) {
        const isPrivate = !item.advertiser || item.advertiser.type === "private";
        const ct = extractContacts(JSON.stringify(item));
        results.push({
          platform: "immobiliare",
          name:     (item.title || item.description || "Annuncio Immobiliare.it").slice(0, 60),
          type:     item.category || "Appartamento",
          location: (item.location && item.location.city) || baseUrl,
          price:    item.price ? item.price + "€/mese" : "",
          phone:    (item.advertiser && item.advertiser.phones && item.advertiser.phones[0]) || ct.phone || null,
          email:    ct.email,
          is_private:    isPrivate,
          owner_managed: isPrivate,
          no_agency:     isPrivate,
          src: item.url || baseUrl,
        });
      });
    } catch(e) {}
  }

  // Fallback: regex on page
  if (results.length === 0) {
    const priceMs = html.match(/(\d[\d.]+)\s*€(?:\s*\/\s*(?:mese|month))/gi) || [];
    const titleMs = html.match(/class="[^"]*in-listingCardTitle[^"]*"[^>]*>([^<]{5,80})</g) || [];
    titleMs.slice(0, 15).forEach(function(tm, i) {
      const name = tm.replace(/^[^>]+>/, "").trim();
      if (name) {
        results.push({
          platform: "immobiliare",
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

function parseFotocasa(html, baseUrl) {
  const results = [];
  // Fotocasa uses __NEXT_DATA__
  const nextM = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextM) {
    try {
      const data = JSON.parse(nextM[1]);
      const props = data.props && data.props.pageProps;
      const items = (props && (props.realEstates || props.results || props.ads)) || [];
      items.slice(0, 20).forEach(function(item) {
        const isPrivate = item.advertiser && item.advertiser.commercialName === null;
        results.push({
          platform: "fotocasa",
          name: item.title || item.subtitle || "Annuncio Fotocasa",
          type: item.propertyType || "Appartamento",
          location: (item.address && item.address.area) || baseUrl,
          price: item.price ? item.price + "€/mese" : "",
          phone: item.phone || null,
          is_private: !!isPrivate,
          owner_managed: !!isPrivate,
          no_agency: !!isPrivate,
          src: item.url ? "https://www.fotocasa.es" + item.url : baseUrl,
        });
      });
    } catch(e) {}
  }
  // Fallback title scan
  if (results.length === 0) {
    const titles = html.match(/data-testid="card-title"[^>]*>([^<]{5,80})</g) || [];
    titles.slice(0,15).forEach(function(t) {
      const name = t.replace(/^[^>]+>/, "").trim();
      if (name) results.push({ platform:"fotocasa", name, type:"Appartamento", is_private:false, src:baseUrl });
    });
  }
  return results.slice(0, 20);
}

function parseSpitogatos(html, baseUrl) {
  const results = [];
  const titles = html.match(/class="[^"]*property[^"]*title[^"]*"[^>]*>([^<]{5,80})</g) || [];
  const prices = html.match(/([\d.,]+)\s*€/g) || [];
  titles.slice(0,15).forEach(function(t, i) {
    const name = t.replace(/^[^>]+>/, "").trim();
    if (name) results.push({
      platform: "spitogatos", name, type: "Appartamento",
      price: prices[i] || "", is_private: false, src: baseUrl,
    });
  });
  return results.slice(0, 15);
}

function parseContactPage(html, baseUrl) {
  // Extract all contacts from a generic contact/about page
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const ct = extractContacts(text);
  // Return raw html for the agent to parse
  return [{ platform:"contact", name: baseUrl, html: text.slice(0, 2000), ...ct }];
}
