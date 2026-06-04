import { useState, useRef, useEffect } from "react";
import * as XLSX from "xlsx";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
var IS_VERCEL = typeof window !== "undefined" &&
  (window.location.hostname.endsWith(".vercel.app") ||
   window.location.hostname === "localhost");

var SEARCH_MODES = [
  { id:"all",          label:"Tutto" },
  { id:"privati",      label:"Solo Privati" },
  { id:"proprietari",  label:"Proprietari Diretti" },
  { id:"villaggi",     label:"Villaggi & Resort" },
  { id:"agenzie",      label:"Agenzie Collaborazione" },
];

var PLATFORMS = {
  google:      { label:"Google Maps",    color:"#4285F4" },
  instagram:   { label:"Instagram",      color:"#E1306C" },
  facebook:    { label:"Facebook",       color:"#1877F2" },
  telegram:    { label:"Telegram",       color:"#26A5E4" },
  mediavacanze:{ label:"MediaVacanze",   color:"#FF6B35" },
  subito:      { label:"Subito.it",      color:"#CC0000" },
  idealista:   { label:"Idealista",      color:"#003399" },
  immobiliare: { label:"Immobiliare.it", color:"#0E4CB2" },
  airbnb:      { label:"Airbnb",         color:"#FF5A5F" },
  homeaway:    { label:"VRBO",           color:"#2196F3" },
  vrbo:        { label:"VRBO",           color:"#2196F3" },
};

var TELEGRAM_MAP = {
  ibiza:       ["ibizalife","ibizarental","ibizahouse","eivissalife","ibizaproperties"],
  formentera:  ["formenteralife","formenterarental","formenteracase"],
  sardegna:    ["sardegnarental","affittisardegna","sardegnacase","sardinia","sardiniarentals"],
  sicilia:     ["siciliaaffitti","sicilyrental","siciliavacanze","siciliacase"],
  puglia:      ["pugliaaffitti","pugliavacanze","apuliarentals","pugliacase"],
  mykonos:     ["mykonoslife","mykonosrental","mykonosgreece","mykonoshomes"],
  bali:        ["balilife","balirentals","balivilla","baliproperties"],
  roma:        ["romaaffitti","roomsrome","romacase","romaapartments","affittiroma"],
  milano:      ["milanoflatrent","milanorental","milanoaffitti","milanocasa"],
  napoli:      ["napoliaffitti","napolicase","naplesrent","napoliapartments"],
  firenze:     ["firenzeaffitti","florencerent","firenzecasa","florenceapartments"],
  venezia:     ["veneziaaffitti","venicerentals","veneziacasa"],
  torino:      ["torinoaffitti","torinocase","torinorent"],
  palermo:     ["palermoaffitti","palermocasa","palermovacanze"],
  rimini:      ["riminisummer","riminivacanze","riminiapartments"],
  toscana:     ["toscanarental","tuscanyrentals","toscanacase","tuscanyvillas"],
  amalfi:      ["amalficoast","costaamalfi","amalfirentals","amalfivilla"],
  bologna:     ["bolognaaffitti","bolognacasa","bolognaapartments"],
  bari:        ["bariaffitti","baricasa","barirentals"],
  default:     ["vacanzeitalia","affittivacanze","rentitaly","italyvillas","affittibrevi","caseitalia"],
};

var NLP_PROMPT = "Sei un parser di richieste di ricerca proprietari di immobili. Estrai i parametri dal testo e rispondi SOLO con JSON valido, nessun testo extra. " +
  "Schema: {\"destination\":\"citta o zona\",\"roomType\":\"intera|condivisa|stanza\",\"people\":2,\"dateFrom\":\"YYYY-MM o mese\",\"dateTo\":\"YYYY-MM o mese\"," +
  "\"budgetMax\":1500,\"budgetPeriod\":\"notte|settimana|mese\",\"durationType\":\"stagionale|annuale|breve\",\"licenza\":false} " +
  "Valori: roomType=intera se appartamento/villa/casa intera; condivisa se stanza in appartamento con altri; stanza se stanza privata con bagno. " +
  "licenza=true se menziona licenza, autorizzazione, locazione turistica. Metti null per campi non presenti. Non inventare dati.";

// ─── STORAGE ──────────────────────────────────────────────────────────────────
var storage = (function() {
  var isNative = typeof window !== "undefined" && window.storage && typeof window.storage.get === "function";
  if (isNative) return window.storage;
  return {
    get: function(k) {
      return Promise.resolve().then(function() {
        var v = localStorage.getItem(k);
        return v ? { key:k, value:v } : null;
      });
    },
    set: function(k, v) {
      return Promise.resolve().then(function() {
        localStorage.setItem(k, v);
        return { key:k, value:v };
      });
    },
    list: function(prefix) {
      return Promise.resolve().then(function() {
        var keys = [];
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (!prefix || k.startsWith(prefix)) keys.push(k);
        }
        return { keys:keys };
      });
    },
  };
})();

// ─── UTILS ────────────────────────────────────────────────────────────────────
function normKey(t) {
  return (t||"").toLowerCase().normalize("NFD")
    .replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
}

function detectCountry(dest) {
  var d = normKey(dest);
  var spain = ["ibiza","formentera","maiorca","mallorca","barcellona","madrid","valencia","siviglia","tenerife","gran canaria","lanzarote","fuerteventura","costa brava","costa del sol","marbella","menorca","minorca"];
  var italy = ["sardegna","sicilia","puglia","toscana","roma","milano","napoli","amalfi","cinque terre","venezia","firenze","bologna","palermo","rimini","riccione","gallipoli","otranto","taormina","siracusa","agrigento","trapani","bari","torino"];
  var greece = ["mykonos","santorini","creta","rodi","corfu","corfù","zakynthos","cefalonia","atene","skiathos","paros","naxos","ios","milos"];
  var bali = ["bali","lombok","seminyak","ubud","canggu","uluwatu"];
  if (spain.some(function(s){return d.includes(s);})) return "es";
  if (italy.some(function(s){return d.includes(s);})) return "it";
  if (greece.some(function(s){return d.includes(s);})) return "gr";
  if (bali.some(function(s){return d.includes(s);})) return "id";
  return "it";
}

function parseJSON(t) {
  if (!t) return null;
  var s = t.replace(/```json/g,"").replace(/```/g,"").trim();
  var a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b < 0) return null;
  try { return JSON.parse(s.slice(a, b+1)); } catch(e) { return null; }
}

function extractContacts(text) {
  var t = (text||"").replace(/\n/g," ");
  var em = t.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  var waM = t.match(/wa\.me\/([+\d]{8,15})|whatsapp[\s:]*([+\d][\d\s\-]{6,14})/i);
  var phM = t.match(/(?:\+|00)[1-9][\d\s\-]{8,16}/);
  return {
    email:    em ? em[0] : null,
    whatsapp: waM ? (waM[1]||waM[2]||"").replace(/\D/g,"") || null : null,
    phone:    (!waM && phM) ? phM[0].replace(/\s+/g,"") : null,
  };
}

// ─── AIRBNB via APIFY ────────────────────────────────────────────────────────
async function searchAirbnbApify(dest, keys) {
  var cin  = new Date(Date.now()+30*86400000).toISOString().split("T")[0];
  var cout = new Date(Date.now()+37*86400000).toISOString().split("T")[0];
  var runId = await apifyRun("apify~airbnb-scraper", {
    locationQueries: [dest],
    checkIn:  cin,
    checkOut: cout,
    adults: 2,
    maxListings: 20,
    currency: "EUR",
    includeReviews: false,
  }, keys.apify||"");
  var dsId  = await apifyWait(runId, keys.apify||"");
  var items = await apifyItems(dsId, keys.apify||"", 20);
  return items.filter(function(i){return i.name||i.title;}).map(function(item) {
    var rev = parseInt(item.reviewsCount||item.numberOfReviews||0);
    var rat = parseFloat(item.starRating||item.avgRating||0);
    return {
      platform: "airbnb",
      name:     item.name||item.title||"",
      type:     item.roomType||item.propertyType||"Appartamento",
      location: item.city||item.locationTitle||dest,
      price:    item.price ? item.price+"€/notte" : "",
      rating:   rat>0?rat:null,
      reviews:  rev>0?rev:null,
      is_private:    rev<150||item.isSuperhost,
      owner_managed: !item.isProfessionalHost,
      new_listing:   rev<10,
      src: item.url||("https://www.airbnb.com/rooms/"+(item.id||"")),
    };
  });
}

// ─── VRBO SEARCH ─────────────────────────────────────────────────────────────
async function searchVRBO(dest, keys) {
  var cin  = new Date(Date.now()+60*86400000).toISOString().split("T")[0];
  var cout = new Date(Date.now()+67*86400000).toISOString().split("T")[0];
  var vrboUrl = "https://www.vrbo.com/search?destination=" +
    encodeURIComponent(dest) +
    "&adultsCount=2&startDate=" + cin + "&endDate=" + cout;
  var runId = await apifyRun("decorative_chimta~vrbo-main-link-scraper", {
    url: vrboUrl,
    maxItems: 20,
  }, keys.apify||"");
  var dsId  = await apifyWait(runId, keys.apify||"");
  var items = await apifyItems(dsId, keys.apify||"", 20);
  return items.filter(function(i){return i.name||i.title;}).map(function(item) {
    var rev = parseInt(item.reviewCount||item.reviews||0);
    var rat = parseFloat(item.rating||item.avgRating||0);
    return {
      platform:  "homeaway",
      name:      item.name||item.title||"",
      type:      item.type||item.propertyType||"Villa / Casa vacanze",
      location:  item.city||item.location||dest,
      price:     item.price ? "~"+item.price+"€/notte" : "",
      rating:    rat>0?rat:null,
      reviews:   rev>0?rev:null,
      is_private:    rev<100,
      owner_managed: !item.manager && rev<100,
      new_listing:   rev<10,
      src: item.url||item.listingUrl||"https://www.vrbo.com",
    };
  });
}

// ─── AGENT v4: ENRICHMENT LOOP ───────────────────────────────────────────────
async function enrichLead(lead, serperKey) {
  var enriched = Object.assign({}, lead);
  var found = { email: lead.email, whatsapp: lead.whatsapp, phone: lead.phone };

  if (lead.website && (!found.email && !found.whatsapp)) {
    var contactPages = [
      lead.website.replace(/\/$/, "") + "/contact",
      lead.website.replace(/\/$/, "") + "/contacts",
      lead.website.replace(/\/$/, "") + "/contatti",
      lead.website.replace(/\/$/, "") + "/contatto",
      lead.website.replace(/\/$/, "") + "/about",
    ];
    for (var i = 0; i < contactPages.length; i++) {
      try {
        var res = await fetch("/api/scrape", {
          method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ url: contactPages[i], platform: "contact" })
        });
        if (res.ok) {
          var d = await res.json();
          var ct = extractContacts((d.html||d.text||JSON.stringify(d.results||"")));
          if (ct.email)    { found.email    = ct.email;    break; }
          if (ct.whatsapp) { found.whatsapp  = ct.whatsapp; break; }
          if (ct.phone && !found.phone) found.phone = ct.phone;
        }
      } catch(e) {}
    }
  }

  if ((!found.email && !found.whatsapp) && (IS_VERCEL || serperKey) && lead.name) {
    try {
      var queries = [
        lead.name + " " + (lead.location||"") + " whatsapp email contatti proprietario",
        lead.name + " " + (lead.location||"") + " telefono prenotazioni affitto",
      ];
      for (var qi2=0; qi2<queries.length; qi2++) {
        var res2 = await fetch("/api/serper", {
          method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ query: queries[qi2], serperKey: serperKey||"", type: "search" })
        });
        if (res2.ok) {
          var sd = await res2.json();
          var snippets = (sd.organic||[]).slice(0,4).map(function(r){
            return (r.snippet||"") + " " + (r.link||"");
          }).join(" ");
          var ct2 = extractContacts(snippets);
          if (ct2.email)    found.email    = found.email    || ct2.email;
          if (ct2.whatsapp) found.whatsapp  = found.whatsapp || ct2.whatsapp;
          if (ct2.phone)    found.phone    = found.phone    || ct2.phone;
          if (!lead.website && sd.organic && sd.organic[0]) {
            var firstLink = sd.organic[0].link;
            if (!/airbnb|booking|tripadvisor|vrbo|homeaway/i.test(firstLink)) {
              enriched.website = firstLink;
            }
          }
          if (found.email || found.whatsapp) break;
        }
      }
    } catch(e) {}
  }

  if (enriched.website && !found.email && !found.whatsapp) {
    var contactPages2 = [
      enriched.website.replace(/\/$/, "") + "/contact",
      enriched.website.replace(/\/$/, "") + "/contatti",
    ];
    for (var ci=0; ci<contactPages2.length; ci++) {
      try {
        var res3 = await fetch("/api/scrape", {
          method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ url: contactPages2[ci], platform: "contact" })
        });
        if (res3.ok) {
          var d3 = await res3.json();
          var ct3 = extractContacts(d3.text||"");
          if (ct3.email)    { found.email    = ct3.email;    break; }
          if (ct3.whatsapp) { found.whatsapp  = ct3.whatsapp; break; }
        }
      } catch(e) {}
    }
  }

  if (found.email    !== lead.email)    enriched.email    = found.email;
  if (found.whatsapp !== lead.whatsapp) enriched.whatsapp = found.whatsapp;
  if (found.phone    !== lead.phone)    enriched.phone    = found.phone;
  enriched.enriched = (found.email !== lead.email || found.whatsapp !== lead.whatsapp);
  return enriched;
}

async function runEnrichment(leads, apiKeys, onLog) {
  var toEnrich = leads.filter(function(l) {
    return (l.priority === "HIGH" || l.priority === "MEDIUM") &&
           !l.email && !l.whatsapp && (l.website || l.name);
  }).slice(0, 10);

  if (!toEnrich.length) return leads;
  onLog("Agente v4", "loading");

  var enriched = 0;
  var enrichedLeads = leads.map(function(l){ return Object.assign({},l); });

  for (var i = 0; i < toEnrich.length; i++) {
    try {
      var result = await enrichLead(toEnrich[i], apiKeys.serper);
      if (result.enriched) {
        enriched++;
        var idx = enrichedLeads.findIndex(function(l){ return l.id === result.id; });
        if (idx >= 0) enrichedLeads[idx] = result;
      }
    } catch(e) {}
  }

  onLog("Agente v4", "done:" + enriched);
  return enrichedLeads;
}

function detectSiteLevel(url) {
  if (!url || url.length < 5) return "none";
  var u = url.toLowerCase();
  var builders = ["wix.com","wixsite.com","squarespace.com","wordpress.com","weebly.com",
    "jimdo.com","webnode","godaddy.com","yolasite.com","strikingly.com","webflow.io",
    "site123.com","cargo.site","myshopify.com","blogspot.com"];
  for (var i = 0; i < builders.length; i++) {
    if (u.includes(builders[i])) return "builder";
  }
  return "professional";
}

// ─── SCORING ──────────────────────────────────────────────────────────────────
function computeScore(s, req) {
  var pts = 0, reasons = [], flags = [], matchReasons = [], penalties = [];

  if (s.whatsapp)                    { pts += 30; reasons.push("WhatsApp diretto"); }
  if (s.phone && !s.whatsapp)        { pts += 20; reasons.push("Telefono diretto"); }
  var eml = (s.email||"").toLowerCase();
  if (eml && /gmail|hotmail|yahoo|outlook|libero|virgilio|tiscali/.test(eml)) {
    pts += 10; reasons.push("Email personale");
  } else if (eml) {
    pts += 8; reasons.push("Email diretta");
  }

  if (s.is_private || s.owner_managed) { pts += 20; reasons.push("Gestore indipendente"); }
  if (s.no_agency)                     { pts += 10; reasons.push("Nessuna agenzia"); }
  if (s.licenza)                       { pts += 15; reasons.push("Licenza/autorizzazione"); }

  var siteLevel = detectSiteLevel(s.website);
  if (siteLevel === "none")         { pts += 25; reasons.push("Zero presenza online"); }
  else if (siteLevel === "builder") { pts += 20; reasons.push("Sito basilare"); }
  else                              { pts += 5;  reasons.push("Sito professionale"); }

  var rev = parseInt(s.reviews||0);
  if (rev > 0 && rev < 30)  { pts += 15; reasons.push("Pochissime recensioni ("+rev+")"); }
  else if (rev < 80)         { pts += 10; reasons.push("Poche recensioni ("+rev+")"); }
  else if (rev < 250)        { pts += 5; }
  else if (rev > 600)        { flags.push("Alta visibilità"); }

  var rat = parseFloat(s.rating||0);
  if (rat >= 4.8)      { pts += 10; reasons.push("Rating "+rat); }
  else if (rat >= 4.5) { pts += 7; }

  if (s.new_listing)   { pts += 8;  reasons.push("Annuncio recente"); }
  if (s.collab_open)   { pts += 12; reasons.push("Aperto a collaborazioni"); }

  if (s.chain_hotel)             { pts = Math.max(0, pts-30); flags.push("Catena alberghiera"); }
  if (s.booking_engine_advanced) { pts = Math.max(0, pts-20); flags.push("Booking engine avanzato"); }
  if (s.advanced_marketing)      { pts = Math.max(0, pts-10); flags.push("Marketing professionale"); }

  if (req) {
    if (req.budgetMax && s.price) {
      var nums = (s.price||"").match(/\d+/g);
      if (nums) {
        var pval = parseInt(nums[0]);
        var bmax = parseInt(req.budgetMax);
        if (pval > bmax * 1.3)  { pts = Math.max(0, pts-20); penalties.push("Prezzo sopra budget"); }
        else if (pval <= bmax)  { pts = Math.min(100, pts+10); matchReasons.push("In budget"); }
      }
    }
    if (req.roomType) {
      var combo = ((s.type||"")+" "+(s.name||"")).toLowerCase();
      if (req.roomType==="condivisa" && /condiviso|stanza|camera/.test(combo)) {
        pts = Math.min(100, pts+15); matchReasons.push("Stanza condivisa");
      }
      if (req.roomType==="intera" && /appartamento|villa|intero|casa/.test(combo)) {
        pts = Math.min(100, pts+12); matchReasons.push("Soluzione intera");
      }
      if (req.roomType==="stanza" && /privat|bagno|suite/.test(combo)) {
        pts = Math.min(100, pts+15); matchReasons.push("Stanza privata");
      }
    }
    if (req.licenza && s.licenza) {
      pts = Math.min(100, pts+15); matchReasons.push("Con licenza");
    }
  }

  var score = Math.min(100, Math.max(0, Math.round(pts)));
  var priority = score >= 70 ? "HIGH" : score >= 45 ? "MEDIUM" : "LOW";
  return { score:score, priority:priority, reasons:reasons, flags:flags,
    matchReasons:matchReasons, penalties:penalties };
}

// ─── API HELPERS ──────────────────────────────────────────────────────────────
async function callClaude(text, system, retries) {
  retries = retries || 0;
  var url = IS_VERCEL ? "/api/claude" : "https://api.anthropic.com/v1/messages";
  var body = IS_VERCEL
    ? JSON.stringify({ system:system, messages:[{role:"user",content:text}], max_tokens:600 })
    : JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:600, system:system, messages:[{role:"user",content:text}] });
  var res = await fetch(url, { method:"POST", headers:{"Content-Type":"application/json"}, body:body });
  if (!res.ok) {
    if ((res.status===529 || res.status===503 || res.status===429) && retries < 2) {
      await new Promise(function(r){setTimeout(r, (retries+1)*2000);});
      return callClaude(text, system, retries+1);
    }
    if (res.status===500 && IS_VERCEL) throw new Error("Claude 500 — aggiungi ANTHROPIC_API_KEY su Vercel");
    if (res.status===529) throw new Error("Claude sovraccarico (529) — riprova tra qualche secondo");
    throw new Error("Claude HTTP "+res.status);
  }
  var d = await res.json();
  return (d.content||[]).filter(function(b){return b.type==="text";}).map(function(b){return b.text;}).join("");
}

async function fetchScrape(url, platform) {
  var res = await fetch("/api/scrape", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ url:url, platform:platform })
  });
  var d = await res.json();
  if (d.blocked) throw new Error("Bot detection — " + (url.split("/")[2]||platform));
  if (d.error && (!d.results || !d.results.length)) throw new Error(d.error);
  return d.results||[];
}

async function fetchSerper(query, serperKey) {
  var res = await fetch("/api/serper", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ query:query, serperKey:serperKey||"" })
  });
  if (!res.ok) throw new Error("Serper HTTP "+res.status);
  return await res.json();
}

async function apifyRun(actorId, input, apiKey) {
  var res = IS_VERCEL
    ? await fetch("/api/apify", { method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ path:"/acts/"+actorId+"/runs?memory=128", method:"POST", body:input, token:apiKey||"" }) })
    : await fetch("https://api.apify.com/v2/acts/"+actorId+"/runs?token="+apiKey+"&memory=128",
        { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(input) });
  if (!res.ok) {
    var txt = await res.text();
    try { var j=JSON.parse(txt); txt=j.error&&j.error.message||txt; } catch(e) {}
    throw new Error("HTTP "+res.status+" — "+txt.slice(0,120));
  }
  var d = await res.json();
  if (!d.data||!d.data.id) throw new Error("Nessun runId da Apify");
  return d.data.id;
}

async function apifyWait(runId, apiKey) {
  for (var i = 0; i < 30; i++) {
    await new Promise(function(r){setTimeout(r,5000);});
    var res = IS_VERCEL
      ? await fetch("/api/apify", { method:"POST", headers:{"Content-Type":"application/json"},
          body:JSON.stringify({ path:"/actor-runs/"+runId, method:"GET", token:apiKey }) })
      : await fetch("https://api.apify.com/v2/actor-runs/"+runId+"?token="+apiKey);
    if (!res.ok) throw new Error("Poll HTTP "+res.status);
    var d = await res.json();
    var run = d.data;
    if (!run) throw new Error("Poll vuota");
    if (run.status==="SUCCEEDED") return run.defaultDatasetId;
    if (run.status==="FAILED")    throw new Error("Run FAILED");
    if (run.status==="ABORTED")   throw new Error("Run ABORTED");
  }
  throw new Error("Timeout 150s");
}

async function apifyItems(datasetId, apiKey, limit) {
  var res = IS_VERCEL
    ? await fetch("/api/apify", { method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ path:"/datasets/"+datasetId+"/items?limit="+(limit||50), method:"GET", token:apiKey }) })
    : await fetch("https://api.apify.com/v2/datasets/"+datasetId+"/items?token="+apiKey+"&limit="+(limit||50));
  var d = await res.json();
  return Array.isArray(d) ? d : (d.items||[]);
}

// ─── CHANNEL SCRAPERS ─────────────────────────────────────────────────────────

var MAPS_EXCLUDE_TYPES = [
  "real_estate_agency","travel_agency","car_rental","car_dealer","gas_station",
  "supermarket","grocery","store","shop","restaurant","bar","cafe","gym","spa",
  "bank","school","hospital","church","museum","tourist_attraction","park",
  "pharmacy","insurance_agency","lawyer","accounting","electrician","plumber",
  "stadium","night_club","casino","airport","transit_station","bus_station",
  "group","community","association","club",
];
var MAPS_INCLUDE_TYPES = [
  "lodging","hotel","motel","guest_house","bed_and_breakfast","apartment","resort",
  "villa","hostel","campground","vacation_rental","holiday_rental","agriturismo",
  "real_estate","property_management","rental_service","housing",
];

function isTouristAccommodation(p) {
  var name = (p.title||p.name||"").toLowerCase();
  var type = (p.type||p.category||"").toLowerCase();
  if (MAPS_EXCLUDE_TYPES.some(function(t){return type.includes(t);})) {
    if (!/(villa|hotel|b&b|appartamento|resort|hostel|agriturismo|rental|affitto|vacanz|suite|rooms?)/.test(name)) return false;
  }
  if (MAPS_INCLUDE_TYPES.some(function(t){return type.includes(t);})) return true;
  if (/(villa|hotel|b&b|b & b|appartamento|resort|hostel|agriturismo|rental|affitto|vacanz|suite|rooms?|albergo|pensione|locanda|masseria|trullo|chalet|bungalow|glamping|camping)/i.test(name)) return true;
  if (/(agenzia|studio|ufficio|negozio|farmacia|supermercato|centro|servizi)/i.test(name)) return false;
  return true;
}

async function searchGoogleMaps(dest, mode, req, keys) {
  var queries = [];
  if (mode === "villaggi") {
    queries = [dest + " resort villaggi turistici", dest + " hotel boutique"];
  } else if (mode === "agenzie") {
    queries = [dest + " agenzia affitti vacanze", dest + " property management"];
  } else if (mode === "proprietari") {
    queries = [
      dest + " affittacamere privato licenza turistica",
      dest + " proprietario diretto affitto appartamento",
      dest + " locazione turistica autorizzazione",
    ];
  } else {
    queries = [
      dest + " villa appartamento affitto vacanze privato",
      dest + " bed breakfast hotel boutique",
      dest + " casa vacanze privato proprietario",
    ];
  }

  var allPlaces = [], seenNames = {};
  for (var qi = 0; qi < queries.length; qi++) {
    try {
      var data = await fetchSerper(queries[qi], keys.serper);
      var places = data.places || data.local || [];
      places.forEach(function(p) {
        var k = (p.title||p.name||"").toLowerCase().replace(/\s+/g,"");
        if (!k || seenNames[k]) return;
        if (!isTouristAccommodation(p)) return;
        seenNames[k] = true;
        allPlaces.push(p);
      });
    } catch(e) {}
    if (allPlaces.length >= 20) break;
  }

  return allPlaces.slice(0,20).map(function(p) {
    var siteLevel = detectSiteLevel(p.website);
    var isChain = !!(p.name && /marriott|hilton|hyatt|ibis|nh hotel|holiday inn|best western|accor|melia|sheraton|wyndham|radisson|intercontinental|four seasons/i.test(p.name));
    var licenza = !!(p.name && /licenza|autorizzaz|locazione turistica|affittacamere|b&b/i.test(p.name+"|"+(p.type||"")));
    var mapsLink = p.link || p.mapsUrl;
    if (!mapsLink) {
      if (p.placeId) mapsLink = "https://www.google.com/maps/place/?q=place_id:" + p.placeId;
      else mapsLink = "https://www.google.com/maps/search/" + encodeURIComponent((p.title||dest));
    }
    return {
      platform:  "google",
      name:      p.title||p.name||"",
      type:      p.type||p.category||"Struttura",
      location:  p.address||dest,
      website:   p.website||null,
      phone:     p.phoneNumber||p.phone||null,
      rating:    p.rating ? parseFloat(p.rating) : null,
      reviews:   p.reviews ? parseInt(p.reviews) : null,
      licenza:   licenza,
      is_private:    !p.website || siteLevel==="none" || siteLevel==="builder",
      owner_managed: !p.website || siteLevel==="none",
      no_agency:     mode!=="agenzie",
      chain_hotel:   isChain,
      booking_engine_advanced: siteLevel==="professional" && (p.reviews||0)>300,
      src:       mapsLink,
    };
  });
}

async function searchInstagram(dest, keys) {
  var slug = normKey(dest);
  var tags = [slug+"villa", slug+"vacation", slug+"affitti", slug+"rental", slug+"accommodation"].slice(0,4);
  var runId = await apifyRun("apify~instagram-hashtag-scraper",{hashtags:tags,resultsLimit:20},keys.apify);
  var dsId  = await apifyWait(runId, keys.apify);
  var items = await apifyItems(dsId, keys.apify, 20);
  var seen  = {};
  return items.filter(function(i){
    var u=i.ownerUsername||""; if(!u||seen[u]) return false; seen[u]=true; return true;
  }).map(function(item) {
    var bio = (item.ownerBio||"")+" "+(item.caption||"");
    var ct  = extractContacts(bio);
    return {
      platform:  "instagram",
      name:      item.ownerFullName||item.ownerUsername||"",
      type:      "Profilo Instagram",
      location:  dest,
      instagram: "@"+(item.ownerUsername||""),
      website:   null,
      email:     ct.email,
      whatsapp:  ct.whatsapp,
      phone:     ct.phone,
      is_private:    true,
      owner_managed: true,
      no_agency:     true,
      new_listing:   false,
      src: "https://www.instagram.com/"+(item.ownerUsername||"")+"/",
    };
  });
}

// ─── FACEBOOK PAGES + GROUPS ──────────────────────────────────────────────────
async function searchFacebook(dest, keys) {
  var queries = [
    "affitti vacanze " + dest,
    "case vacanze " + dest,
    "villa rental " + dest,
  ];
  var all = [], seen = {};
  for (var qi = 0; qi < queries.length; qi++) {
    try {
      var runId = await apifyRun("apify~facebook-pages-scraper",{
        startUrls:[{
          url: "https://www.facebook.com/search/pages/?q=" + encodeURIComponent(queries[qi])
        }],
        maxPosts: 3,
        maxReviews: 0,
      }, keys.apify);
      var dsId = await apifyWait(runId, keys.apify);
      var items = await apifyItems(dsId, keys.apify, 10);
      items.filter(function(i){return i.name||i.title;}).forEach(function(item) {
        var k = (item.name||item.title||"").toLowerCase().replace(/\s/g,"");
        if (seen[k]) return; seen[k]=true;
        var ct = extractContacts((item.phone||"")+" "+(item.email||"")+" "+(item.about||"")+" "+(item.description||""));
        all.push({
          platform:  "facebook",
          name:      item.name||item.title||"",
          type:      "Pagina Facebook",
          location:  item.city||dest,
          website:   item.website||null,
          phone:     item.phone||ct.phone||null,
          email:     item.email||ct.email||null,
          whatsapp:  ct.whatsapp,
          is_private:    false,
          owner_managed: false,
          no_agency:     false,
          src: item.url||item.pageUrl||"",
        });
      });
      if (all.length >= 10) break;
    } catch(e) {}
  }
  return all;
}

// Cerca in gruppi Facebook via Google/Serper (site:facebook.com/groups)
async function searchFacebookGroups(dest, keys) {
  if (!IS_VERCEL && !keys.serper) return [];
  var queries = [
    'site:facebook.com/groups "' + dest + '" affitto appartamento proprietario',
    'site:facebook.com/groups "' + dest + '" case vacanze privati',
    'site:facebook.com/groups affitto privato "' + dest + '"',
  ];
  var all = [], seen = {};
  for (var qi = 0; qi < queries.length; qi++) {
    try {
      var data = await fetchSerper(queries[qi], keys.serper);
      (data.organic||[]).forEach(function(r) {
        if (!r.link || !r.link.includes("facebook.com/groups")) return;
        var k = r.link.slice(-30);
        if (seen[k]) return; seen[k] = true;
        var ct = extractContacts(r.snippet||"");
        all.push({
          platform:  "facebook",
          name:      r.title || ("Gruppo FB – " + dest),
          type:      "Gruppo Facebook",
          location:  dest,
          bio:       r.snippet||"",
          phone:     ct.phone||null,
          email:     ct.email||null,
          whatsapp:  ct.whatsapp||null,
          is_private:    true,
          owner_managed: true,
          no_agency:     true,
          src:       r.link,
        });
      });
    } catch(e) {}
    if (all.length >= 12) break;
  }
  return all;
}

// Cerca annunci su Telegram via Google/Serper (site:t.me)
async function searchTelegramSerper(dest, keys) {
  if (!IS_VERCEL && !keys.serper) return [];
  var query = 'site:t.me "' + dest + '" affitto appartamento proprietario';
  try {
    var data = await fetchSerper(query, keys.serper);
    var all = [], seen = {};
    (data.organic||[]).forEach(function(r) {
      if (!r.link || !r.link.includes("t.me")) return;
      var k = r.link.slice(-20);
      if (seen[k]) return; seen[k] = true;
      var ct = extractContacts(r.snippet||"");
      all.push({
        platform:  "telegram",
        name:      r.title || ("Canale Telegram – " + dest),
        type:      "Post Telegram",
        location:  dest,
        bio:       r.snippet||"",
        phone:     ct.phone||null,
        email:     ct.email||null,
        whatsapp:  ct.whatsapp||null,
        is_private:    true,
        owner_managed: true,
        no_agency:     true,
        src:       r.link,
      });
    });
    return all;
  } catch(e) { return []; }
}

async function searchTelegramPublic(dest) {
  var slug = normKey(dest).replace(/_/g,"");
  var channels = TELEGRAM_MAP[slug] || TELEGRAM_MAP.default;
  var all = [];
  for (var i = 0; i < Math.min(channels.length, 4); i++) {
    try {
      var url = "https://t.me/s/" + channels[i];
      var items = await fetchScrape(url, "telegram");
      items.forEach(function(item) {
        item.telegram_channel = channels[i];
        item.channel_url = "https://t.me/" + channels[i];
        if (item.msg_id) {
          item.src = "https://t.me/" + channels[i] + "/" + item.msg_id;
        } else {
          item.src = "https://t.me/s/" + channels[i];
        }
        all.push(item);
      });
    } catch(e) {}
  }
  return all;
}

async function searchMediaVacanze(dest, req) {
  var encoded = encodeURIComponent(dest);
  var url = "https://www.casevacanza.it/search?q=" + encoded + "&categoria=case-vacanze";
  var results = await fetchScrape(url, "casevacanza").catch(function(){return [];});
  if (!results.length) {
    var slug = normKey(dest).replace(/_/g,"-");
    url = "https://www.holidu.it/search?location=" + encoded;
    results = await fetchScrape(url, "holidu").catch(function(){return [];});
  }
  return results;
}

async function searchSubito(dest, keys) {
  var searchUrl = "https://www.subito.it/annunci-italia/affitto-vacanze/case-vacanza/?q=" + encodeURIComponent(dest);
  var runId = await apifyRun("apify~cheerio-scraper", {
    startUrls: [{ url: searchUrl }],
    pageFunction: `async function pageFunction(context) {
      const { $, request } = context;
      const items = [];
      $('[data-item-id]').each(function() {
        const el = $(this);
        const title = el.find('[class*="title"]').first().text().trim();
        const price = el.find('[class*="price"]').first().text().trim();
        const link  = el.find('a').first().attr('href');
        const phone = el.find('[class*="phone"]').first().text().trim();
        if (title || price) {
          items.push({ title, price, phone,
            url: link ? ('https://www.subito.it' + link) : request.url });
        }
      });
      return items;
    }`,
    maxRequestsPerCrawl: 1,
  }, keys.apify||"");
  var dsId  = await apifyWait(runId, keys.apify||"");
  var items = await apifyItems(dsId, keys.apify||"", 20);
  var flat = [];
  items.forEach(function(item) {
    if (Array.isArray(item)) flat = flat.concat(item);
    else if (item.title || item.price) flat.push(item);
  });
  return flat.filter(function(i){return i.title||i.price;}).map(function(item) {
    var ct = extractContacts((item.phone||"")+" "+(item.description||""));
    return {
      platform: "subito",
      name:     item.title||"Annuncio Subito",
      type:     "Affitto vacanze",
      price:    item.price||"",
      phone:    item.phone||ct.phone||null,
      email:    ct.email, whatsapp: ct.whatsapp,
      is_private: true, owner_managed: true, no_agency: true,
      src: item.url||searchUrl,
    };
  });
}

async function searchIdealista(dest, req) {
  var slug = normKey(dest).replace(/_/g,"-");
  var country = detectCountry(dest);
  var results = [];

  if (country === "es") {
    var habitUrl = "https://www.habitaclia.com/alquiler-en-" + slug + ".htm";
    results = await fetchScrape(habitUrl, "habitaclia").catch(function(){return [];});
    if (!results.length) {
      var fcUrl = "https://api.fotocasa.es/PropertySearchService/api/v2/properties?" +
        "culture=es-ES&isMap=false&isNewConstructionPromotions=false" +
        "&maxItems=20&order=score&pageIndex=1&propertyTypeId=2&transactionTypeId=2" +
        "&text=" + encodeURIComponent(dest);
      results = await fetchScrape(fcUrl, "fotocasa_api").catch(function(){return [];});
    }
  } else {
    var url = "https://www.immobiliare.it/affitto-case/" + slug + "/?localiMinimo=1";
    results = await fetchScrape(url, "immobiliare").catch(function(){return [];});
  }
  return results;
}

async function searchImmobiliare(dest, keys) {
  var country = detectCountry(dest);
  if (country === "it" || country === "id") {
    try {
      var runId = await apifyRun("igolaizola~immobiliare-it-scraper", {
        startUrls: [{
          url: "https://www.immobiliare.it/affitto-case/" +
            normKey(dest).replace(/_/g,"-") + "/?localiMinimo=1"
        }],
        maxItems: 20,
      }, keys.apify||"");
      var dsId  = await apifyWait(runId, keys.apify||"");
      var items = await apifyItems(dsId, keys.apify||"", 20);
      return items.filter(function(i){return i.title||i.address;}).map(function(item) {
        var isPrivate = !item.agency && item.advertiserType !== "agency";
        var ct = extractContacts((item.description||"")+" "+(item.phone||"")+" "+(item.email||""));
        return {
          platform:  "immobiliare",
          name:      item.title||item.address||"Annuncio Immobiliare",
          type:      item.propertyType||item.category||"Appartamento",
          location:  item.city||item.address||dest,
          price:     item.price ? item.price+"€/mese" : "",
          phone:     item.phone||item.phones&&item.phones[0]||ct.phone||null,
          email:     item.email||ct.email||null,
          is_private:    isPrivate,
          owner_managed: isPrivate,
          no_agency:     isPrivate,
          src: item.url||"https://www.immobiliare.it",
        };
      });
    } catch(e) {
      var slug = normKey(dest).replace(/_/g,"-");
      return fetchScrape("https://www.immobiliare.it/affitto-case/"+slug+"/", "immobiliare").catch(function(){return [];});
    }
  } else {
    var slug2 = normKey(dest).replace(/_/g,"-");
    return fetchScrape("https://www.habitaclia.com/alquiler-en-"+slug2+".htm", "habitaclia").catch(function(){return [];});
  }
}

// ─── RUN SEARCH ───────────────────────────────────────────────────────────────
async function runSearch(dest, mode, req, keys, onLog) {
  var hasAnyKey = keys.apify || keys.serper;
  if (!hasAnyKey && !IS_VERCEL) throw new Error("Configura almeno una API key.");

  var all = [], seen = {};

  function add(items) {
    (items||[]).forEach(function(s) {
      if (!s||!s.name) return;
      var k = normKey(s.name+s.location);
      if (seen[k]) return;
      seen[k] = true;
      var sc = computeScore(s, req);
      all.push(Object.assign({}, s, {
        id:          Date.now()+Math.random(),
        score:       sc.score,
        priority:    sc.priority,
        scoreReason: sc.reasons.slice(0,4).join(" · "),
        scoreFlags:  sc.flags,
        matchReasons:sc.matchReasons,
        penalties:   sc.penalties,
        status:      "new",
      }));
    });
  }

  function wrap(label, fn) {
    onLog(label, "loading");
    return fn().then(function(res) {
      add(res);
      onLog(label, "done:"+res.length);
    }).catch(function(e) {
      onLog(label, "error:"+e.message);
    });
  }

  var tasks = [];

  if (IS_VERCEL || keys.serper) {
    tasks.push(wrap("Google Maps", function(){return searchGoogleMaps(dest,mode,req,keys);}));
    tasks.push(wrap("Gruppi Facebook", function(){return searchFacebookGroups(dest,keys);}));
    tasks.push(wrap("Telegram Annunci", function(){return searchTelegramSerper(dest,keys);}));
  }

  if (IS_VERCEL) {
    tasks.push(wrap("MediaVacanze", function(){return searchMediaVacanze(dest,req);}));
    tasks.push(wrap("Idealista",    function(){return searchIdealista(dest,req);}));
    tasks.push(wrap("Telegram",     function(){return searchTelegramPublic(dest);}));
  }

  if (IS_VERCEL) {
    tasks.push(wrap("Instagram",    function(){return searchInstagram(dest,keys);}));
    tasks.push(wrap("Facebook",     function(){return searchFacebook(dest,keys);}));
    tasks.push(wrap("Immobiliare",  function(){return searchImmobiliare(dest,keys);}));
    tasks.push(wrap("Subito.it",    function(){return searchSubito(dest,keys);}));
    tasks.push(wrap("VRBO",         function(){return searchVRBO(dest,keys);}));
    tasks.push(wrap("Airbnb",       function(){return searchAirbnbApify(dest,keys);}));
  }

  if (!tasks.length) throw new Error("Nessun canale disponibile. Configura le API key.");

  await Promise.allSettled(tasks);

  all.sort(function(a,b) {
    if (req && a.matchReasons.length !== b.matchReasons.length) {
      return b.matchReasons.length - a.matchReasons.length;
    }
    return b.score - a.score;
  });

  var enriched = await runEnrichment(all, keys, onLog);

  enriched = enriched.map(function(s) {
    if (!s.enriched) return s;
    var sc = computeScore(s, req);
    return Object.assign({}, s, {
      score: sc.score, priority: sc.priority,
      scoreReason: sc.reasons.slice(0,4).join(" · "),
      scoreFlags: sc.flags, matchReasons: sc.matchReasons,
    });
  });
  enriched.sort(function(a,b) { return b.score-a.score; });

  return enriched;
}

// ─── COMPONENTS ───────────────────────────────────────────────────────────────

function ScoreRing(props) {
  var s = props.score||0;
  var c = s>=70?"#34D399":s>=45?"#FBBF24":"#6B7280";
  var dash = Math.round(125.6*s/100);
  return (
    <div style={{position:"relative",width:46,height:46,flexShrink:0}}>
      <svg width="46" height="46" style={{transform:"rotate(-90deg)"}}>
        <circle cx="23" cy="23" r="19" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5"/>
        <circle cx="23" cy="23" r="19" fill="none" stroke={c} strokeWidth="5"
          strokeDasharray={dash+" "+(119.4-dash)} strokeLinecap="round"/>
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <span style={{fontSize:12,fontWeight:900,color:c}}>{s}</span>
      </div>
    </div>
  );
}

function Chip(props) {
  if (!props.label) return null;
  var c = props.c||"#6366F1";
  return (
    <a href={props.href} target="_blank" rel="noopener noreferrer"
      style={{display:"inline-flex",alignItems:"center",gap:3,padding:"4px 10px",borderRadius:20,
        background:c+"18",border:"1px solid "+c+"35",color:c,fontSize:11,fontWeight:600,
        textDecoration:"none",marginRight:4,marginBottom:4}}>
      {props.icon} {props.label}
    </a>
  );
}

function FilterBadges(props) {
  var req = props.req;
  if (!req) return null;
  var roomLabel = req.roomType==="intera"?"Appartamento intero":req.roomType==="condivisa"?"Stanza condivisa":req.roomType==="stanza"?"Stanza privata":null;
  var durationLabel = req.durationType==="annuale"?"Annuale":req.durationType==="stagionale"?"Stagionale":req.durationType==="breve"?"Breve periodo":null;
  var badges = [
    req.destination && { bg:"rgba(99,102,241,0.15)", c:"#A5B4FC", label:"📍 "+req.destination },
    roomLabel        && { bg:"rgba(96,165,250,0.15)", c:"#60A5FA", label:"🏠 "+roomLabel },
    req.people       && { bg:"rgba(52,211,153,0.15)", c:"#34D399", label:"👥 "+req.people+" persone" },
    req.budgetMax    && { bg:"rgba(251,191,36,0.15)", c:"#FBBF24", label:"💶 max "+req.budgetMax+"€/"+(req.budgetPeriod||"mese") },
    durationLabel    && { bg:"rgba(139,92,246,0.15)", c:"#A78BFA", label:"📅 "+durationLabel },
    req.licenza      && { bg:"rgba(245,158,11,0.15)", c:"#F59E0B", label:"📋 Con licenza" },
    (req.dateFrom||req.dateTo) && { bg:"rgba(139,92,246,0.15)", c:"#A78BFA", label:(req.dateFrom||"")+(req.dateTo?" → "+req.dateTo:"") },
  ].filter(Boolean);
  if (!badges.length) return null;
  return (
    <div style={{padding:"8px 12px",background:"rgba(99,102,241,0.06)",borderRadius:10,
      border:"1px solid rgba(99,102,241,0.18)",marginTop:6}}>
      <div style={{fontSize:9,color:"#818CF8",fontWeight:700,textTransform:"uppercase",
        letterSpacing:"0.1em",marginBottom:6}}>Filtri estratti</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
        {badges.map(function(b,i){
          return <span key={i} style={{fontSize:11,padding:"3px 9px",borderRadius:20,
            background:b.bg,color:b.c,fontWeight:600}}>{b.label}</span>;
        })}
      </div>
    </div>
  );
}

function LeadCard(props) {
  var s = props.lead;
  var [open, setOpen] = useState(false);
  var [msgs, setMsgs] = useState(null);
  var [loadMsg, setLoadMsg] = useState(false);
  var [status, setStatus] = useState(s.status||"new");
  var sc = s.score||0;
  var c  = sc>=70?"#34D399":sc>=45?"#FBBF24":"#6B7280";
  var pm = PLATFORMS[s.platform]||{label:s.platform,color:"#6B7280"};

  var STATUS_COLORS = {
    new:"#6B7280", contacted:"#FBBF24", replied:"#60A5FA",
    qualified:"#34D399", active:"#6366F1", archived:"#374151"
  };
  var STATUS_LABELS = {
    new:"Nuovo", contacted:"Contattato", replied:"Risposto",
    qualified:"Qualificato", active:"Attivo", archived:"Archiviato"
  };

  async function genMsg() {
    if (msgs) return;
    setLoadMsg(true);
    try {
      var sys = "Sei un esperto di real estate. Genera messaggi professionali e diretti per proporre una collaborazione a commissione al proprietario di un immobile (12% commissione, zero costi fissi, tu gestisci prenotazioni e marketing). Tono rispettoso, non commerciale. Rispondi SOLO JSON: {\"whatsapp\":\"msg max 3 righe\",\"email_subject\":\"oggetto\",\"email_body\":\"corpo max 5 righe\"}";
      var prompt = "Struttura: "+s.name+"\nTipo: "+s.type+"\nLocation: "+s.location+(s.licenza?" (con licenza)":"");
      var raw = await callClaude(prompt, sys);
      var parsed = parseJSON(raw);
      setMsgs(parsed || { whatsapp:raw.slice(0,200), email_subject:"Proposta collaborazione – Property Scout", email_body:raw });
    } catch(e) { alert("Errore: "+e.message); }
    setLoadMsg(false);
  }

  function copy(t) { navigator.clipboard.writeText(t).catch(function(){}); }

  var stColor = STATUS_COLORS[status]||"#6B7280";

  return (
    <div className="ps-lead-card" style={{background:"rgba(255,255,255,0.025)",border:"1px solid "+c+"22",
      borderRadius:14,marginBottom:8,overflow:"hidden",animation:"fadeUp 0.2s ease",
      transition:"transform 0.15s ease, box-shadow 0.15s ease"}}>

      <div style={{padding:"12px 14px",display:"flex",gap:10,alignItems:"flex-start",
        cursor:"pointer"}} onClick={function(){setOpen(function(o){return !o;});}}>
        <ScoreRing score={sc}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:3,flexWrap:"wrap"}}>
            <span style={{fontSize:10,padding:"2px 8px",borderRadius:20,fontWeight:700,
              background:pm.color+"1A",border:"1px solid "+pm.color+"40",color:pm.color}}>{pm.label}</span>
            {s.type&&<span style={{fontSize:10,color:"#6B7280"}}>{s.type}</span>}
            {s.is_private&&<span style={{fontSize:10,padding:"2px 6px",borderRadius:20,
              background:"rgba(52,211,153,0.1)",border:"1px solid rgba(52,211,153,0.25)",color:"#34D399"}}>privato</span>}
            {s.licenza&&<span style={{fontSize:10,padding:"2px 6px",borderRadius:20,
              background:"rgba(245,158,11,0.12)",border:"1px solid rgba(245,158,11,0.3)",color:"#F59E0B"}}>📋 licenza</span>}
            {s.enriched&&<span style={{fontSize:10,padding:"2px 6px",borderRadius:20,
              background:"rgba(99,102,241,0.1)",border:"1px solid rgba(99,102,241,0.3)",color:"#A5B4FC"}}>✦ arricchito</span>}
            {s.priority==="HIGH"&&<span style={{fontSize:10,padding:"2px 6px",borderRadius:20,
              background:"rgba(52,211,153,0.15)",color:"#34D399",fontWeight:700}}>HIGH</span>}
          </div>
          <div className="lx-card-name" style={{fontSize:15,fontWeight:700,color:"#F1F5F9",marginBottom:3,
            overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</div>
          <div style={{fontSize:10,color:"#64748B",display:"flex",gap:8,flexWrap:"wrap"}}>
            {s.location&&<span>📍 {s.location}</span>}
            {s.price&&<span>💶 {s.price}</span>}
            {s.rating&&<span>⭐ {s.rating}{s.reviews?" ("+s.reviews+")":""}</span>}
          </div>
          {s.scoreReason&&<div style={{fontSize:10,color:c,marginTop:3}}>✓ {s.scoreReason}</div>}
          {s.matchReasons&&s.matchReasons.length>0&&(
            <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:4}}>
              {s.matchReasons.map(function(r,i){
                return <span key={i} style={{fontSize:10,padding:"2px 7px",borderRadius:20,
                  background:"rgba(16,185,129,0.1)",border:"1px solid rgba(16,185,129,0.25)",
                  color:"#34D399"}}>✓ {r}</span>;
              })}
            </div>
          )}
        </div>
        <span style={{color:"#475569",fontSize:12,flexShrink:0}}>{open?"▲":"▼"}</span>
      </div>

      {open&&(
        <div style={{borderTop:"1px solid rgba(255,255,255,0.05)",
          padding:"12px 14px",background:"rgba(0,0,0,0.15)"}}>

          <div style={{marginBottom:10}}>
            {s.whatsapp&&<Chip icon="💬" label={s.whatsapp}
              href={"https://wa.me/"+s.whatsapp.replace(/[^0-9+]/g,"")} c="#25D366"/>}
            {s.phone&&(
              <span>
                <Chip icon="📞" label={s.phone}
                  href={"tel:"+s.phone} c="#FBBF24"/>
                <Chip icon="💬 WA" label="Apri WA"
                  href={"https://wa.me/"+s.phone.replace(/[^0-9+]/g,"")} c="#25D366"/>
              </span>
            )}
            {s.email&&<Chip icon="✉" label={s.email}
              href={"mailto:"+s.email} c="#60A5FA"/>}
            {s.instagram&&<Chip icon="📸" label={s.instagram}
              href={"https://instagram.com/"+s.instagram.replace("@","")} c="#E1306C"/>}
            {s.telegram_channel&&<Chip icon="✈" label={"@"+s.telegram_channel}
              href={s.channel_url||("https://t.me/"+s.telegram_channel)} c="#26A5E4"/>}
            {s.website&&<Chip icon="🔗" label={s.website.replace(/^https?:\/\//,"").split("/")[0]}
              href={s.website} c="#C084FC"/>}
            {s.src&&<Chip icon="📋" label={s.platform==="telegram"?"Vai al post":"Scheda"}
              href={s.src} c="#64748B"/>}
          </div>

          {s.bio&&<div style={{fontSize:11,color:"#94A3B8",fontStyle:"italic",
            marginBottom:10,padding:"6px 10px",background:"rgba(255,255,255,0.02)",
            borderRadius:8,lineHeight:1.6,borderLeft:"2px solid rgba(99,102,241,0.3)"}}>{s.bio}</div>}

          <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
            <select value={status} onChange={function(e){setStatus(e.target.value);props.onStatus(s.id,e.target.value);}}
              onClick={function(e){e.stopPropagation();}}
              style={{fontSize:11,padding:"5px 9px",borderRadius:8,
                background:stColor+"18",border:"1px solid "+stColor+"40",
                color:stColor,cursor:"pointer",fontFamily:"inherit"}}>
              {Object.keys(STATUS_LABELS).map(function(k){
                return <option key={k} value={k}>{STATUS_LABELS[k]}</option>;
              })}
            </select>
            <button onClick={function(e){e.stopPropagation();var t=(s.whatsapp?"https://wa.me/"+s.whatsapp.replace(/[^0-9+]/g,""):s.email||s.phone||"");navigator.clipboard.writeText(t).catch(function(){});}}
              style={{fontSize:11,padding:"5px 10px",borderRadius:8,border:"1px solid rgba(255,255,255,0.1)",
                background:"rgba(255,255,255,0.04)",color:"#94A3B8",cursor:"pointer"}}>
              📋 Copia
            </button>
            <button onClick={function(e){e.stopPropagation();genMsg();}}
              style={{fontSize:11,padding:"5px 12px",borderRadius:8,
                border:"1px solid rgba(99,102,241,0.35)",
                background:"rgba(99,102,241,0.1)",color:"#A5B4FC",cursor:"pointer",fontWeight:600}}>
              {loadMsg?"⏳...":"✉ Genera messaggio"}
            </button>
          </div>

          {s.scoreReason&&(
            <div style={{marginTop:10,padding:"8px 10px",background:"rgba(255,255,255,0.02)",
              borderRadius:8,border:"1px solid rgba(255,255,255,0.05)"}}>
              <div style={{fontSize:9,color:"#475569",textTransform:"uppercase",
                letterSpacing:"0.08em",marginBottom:4}}>Score {s.score} — Motivazioni</div>
              <div style={{fontSize:11,color:"#64748B",lineHeight:1.7}}>{s.scoreReason}</div>
              {s.scoreFlags&&s.scoreFlags.length>0&&(
                <div style={{marginTop:4}}>
                  {s.scoreFlags.map(function(f,i){
                    return <div key={i} style={{fontSize:10,color:"#F87171"}}>⚠ {f}</div>;
                  })}
                </div>
              )}
              {s.penalties&&s.penalties.length>0&&(
                <div style={{marginTop:4}}>
                  {s.penalties.map(function(p,i){
                    return <div key={i} style={{fontSize:10,color:"#F87171"}}>⚠ {p}</div>;
                  })}
                </div>
              )}
            </div>
          )}

          {msgs&&(
            <div className="lx-msg-grid" style={{marginTop:10,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div style={{padding:10,background:"rgba(37,211,102,0.05)",
                border:"1px solid rgba(37,211,102,0.18)",borderRadius:10}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{fontSize:10,fontWeight:700,color:"#25D366",textTransform:"uppercase"}}>💬 WhatsApp</span>
                  <button onClick={function(){copy(msgs.whatsapp);}}
                    style={{fontSize:10,padding:"2px 7px",borderRadius:5,border:"1px solid rgba(37,211,102,0.3)",
                      background:"transparent",color:"#25D366",cursor:"pointer"}}>Copia</button>
                </div>
                <div style={{fontSize:12,color:"#CBD5E1",lineHeight:1.7,whiteSpace:"pre-wrap"}}>{msgs.whatsapp}</div>
                {s.whatsapp&&<a href={"https://wa.me/"+s.whatsapp.replace(/[^0-9+]/g,"")+"?text="+encodeURIComponent(msgs.whatsapp)}
                  target="_blank" rel="noopener noreferrer"
                  style={{display:"inline-block",marginTop:7,fontSize:11,padding:"4px 10px",borderRadius:7,
                    background:"rgba(37,211,102,0.15)",color:"#25D366",textDecoration:"none",fontWeight:700}}>
                  Invia su WA →
                </a>}
              </div>
              <div style={{padding:10,background:"rgba(96,165,250,0.05)",
                border:"1px solid rgba(96,165,250,0.18)",borderRadius:10}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{fontSize:10,fontWeight:700,color:"#60A5FA",textTransform:"uppercase"}}>✉ Email</span>
                  <button onClick={function(){copy(msgs.email_subject+"\n\n"+msgs.email_body);}}
                    style={{fontSize:10,padding:"2px 7px",borderRadius:5,border:"1px solid rgba(96,165,250,0.3)",
                      background:"transparent",color:"#60A5FA",cursor:"pointer"}}>Copia</button>
                </div>
                <div style={{fontSize:11,fontWeight:700,color:"#60A5FA",marginBottom:5}}>
                  Oggetto: {msgs.email_subject}
                </div>
                <div style={{fontSize:12,color:"#CBD5E1",lineHeight:1.7,whiteSpace:"pre-wrap"}}>{msgs.email_body}</div>
                {s.email&&<a href={"mailto:"+s.email+"?subject="+encodeURIComponent(msgs.email_subject)+"&body="+encodeURIComponent(msgs.email_body)}
                  style={{display:"inline-block",marginTop:7,fontSize:11,padding:"4px 10px",borderRadius:7,
                    background:"rgba(96,165,250,0.15)",color:"#60A5FA",textDecoration:"none",fontWeight:700}}>
                  Apri Email →
                </a>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResultsView(props) {
  var leads    = props.leads||[];
  var onStatus = props.onStatus;
  var [search, setSearch] = useState("");
  var [filter, setFilter] = useState("all");
  var [sort,   setSort]   = useState("score");

  var STATUS_LABELS = {
    new:"Nuovo", contacted:"Contattato", replied:"Risposto",
    qualified:"Qualificato", active:"Attivo", archived:"Archiviato"
  };

  var filtered = leads.filter(function(l) {
    if (filter!=="all" && l.status!==filter) return false;
    if (search) {
      var q = search.toLowerCase();
      return (l.name||"").toLowerCase().includes(q)||(l.location||"").toLowerCase().includes(q);
    }
    return true;
  }).sort(function(a,b) {
    if (sort==="score")    return b.score-a.score;
    if (sort==="name")     return (a.name||"").localeCompare(b.name||"");
    if (sort==="priority") {
      var pO = {HIGH:0,MEDIUM:1,LOW:2};
      return (pO[a.priority]||2)-(pO[b.priority]||2);
    }
    return 0;
  });

  var high  = leads.filter(function(l){return l.priority==="HIGH";}).length;
  var hasWA = leads.filter(function(l){return l.whatsapp;}).length;
  var hasEM = leads.filter(function(l){return l.email;}).length;
  var hasLic = leads.filter(function(l){return l.licenza;}).length;

  function handleExcel() {
    var wb = XLSX.utils.book_new();
    var h = ["Score","Priority","Nome","Tipo","Location","WhatsApp","Tel","Email","Sito","Prezzo","Rating","Recensioni","Licenza","Score Motivazioni","Status","Piattaforma","Link"];
    var rows = leads.map(function(l) {
      return [l.score+"%",l.priority,l.name,l.type,l.location,
        l.whatsapp||"",l.phone||"",l.email||"",l.website||"",
        l.price||"",l.rating||"",l.reviews||"",l.licenza?"Sì":"",l.scoreReason||"",
        l.status||"",l.platform||"",l.src||""];
    });
    var ws = XLSX.utils.aoa_to_sheet([h].concat(rows));
    ws["!cols"] = h.map(function(){return{wch:18};});
    XLSX.utils.book_append_sheet(wb,ws,"Tutti i Lead");
    var highLeads = leads.filter(function(l){return l.priority==="HIGH";});
    if (highLeads.length) {
      var ws2 = XLSX.utils.aoa_to_sheet([h].concat(highLeads.map(function(l) {
        return [l.score+"%",l.priority,l.name,l.type,l.location,
          l.whatsapp||"",l.phone||"",l.email||"",l.website||"",
          l.price||"",l.rating||"",l.reviews||"",l.licenza?"Sì":"",l.scoreReason||"",
          l.status||"",l.platform||"",l.src||""];
      })));
      ws2["!cols"]=ws["!cols"];
      XLSX.utils.book_append_sheet(wb,ws2,"HIGH Priority");
    }
    XLSX.writeFile(wb,"PropertyScout_"+new Date().toISOString().slice(0,10)+".xlsx");
  }

  return (
    <div style={{marginTop:8,width:"100%"}}>
      <div className="lx-stats" style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
        {[
          {l:"Lead",      v:leads.length, c:"#94A3B8"},
          {l:"HIGH",      v:high,         c:"#34D399"},
          {l:"WhatsApp",  v:hasWA,        c:"#25D366"},
          {l:"Email",     v:hasEM,        c:"#60A5FA"},
          {l:"Licenza",   v:hasLic,       c:"#F59E0B"},
        ].map(function(st,i){
          return (
            <div key={i} className="lx-stat" style={{padding:"6px 12px",borderRadius:10,
              background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",textAlign:"center"}}>
              <div className="lx-stat-num" style={{fontSize:20,fontWeight:800,color:st.c}}>{st.v}</div>
              <div style={{fontSize:9,color:"#475569",textTransform:"uppercase",letterSpacing:"0.06em"}}>{st.l}</div>
            </div>
          );
        })}
        <button onClick={handleExcel}
          style={{marginLeft:"auto",fontSize:12,padding:"8px 16px",borderRadius:10,
            background:"linear-gradient(135deg,#1D6F42,#2E9E5F)",border:"none",
            color:"#fff",cursor:"pointer",fontWeight:700}}>
          📊 Excel
        </button>
      </div>

      <div className="lx-filters" style={{display:"flex",gap:7,marginBottom:12,flexWrap:"wrap"}}>
        <input value={search} onChange={function(e){setSearch(e.target.value);}}
          placeholder="Cerca per nome o location..."
          style={{flex:1,minWidth:140,padding:"6px 12px",borderRadius:8,
            background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",
            color:"#F1F5F9",fontSize:12,outline:"none"}}/>
        <select value={filter} onChange={function(e){setFilter(e.target.value);}}
          style={{fontSize:11,padding:"6px 10px",borderRadius:8,
            background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",
            color:"#94A3B8",cursor:"pointer"}}>
          <option value="all">Tutti gli status</option>
          {Object.keys(STATUS_LABELS).map(function(k){
            return <option key={k} value={k}>{STATUS_LABELS[k]}</option>;
          })}
        </select>
        <select value={sort} onChange={function(e){setSort(e.target.value);}}
          style={{fontSize:11,padding:"6px 10px",borderRadius:8,
            background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",
            color:"#94A3B8",cursor:"pointer"}}>
          <option value="score">Score</option>
          <option value="priority">Priorità</option>
          <option value="name">Nome</option>
        </select>
      </div>

      {filtered.map(function(lead) {
        return <LeadCard key={lead.id} lead={lead} onStatus={onStatus}/>;
      })}
      {!filtered.length&&(
        <div style={{textAlign:"center",padding:"30px",color:"#374151",fontSize:12}}>
          Nessun lead trovato
        </div>
      )}
    </div>
  );
}

function LogPanel(props) {
  var logs = props.logs||[];
  return (
    <div style={{position:"fixed",bottom:20,right:16,width:340,maxHeight:260,
      background:"#0A0F1E",border:"1px solid rgba(99,102,241,0.3)",borderRadius:12,
      zIndex:150,display:"flex",flexDirection:"column",boxShadow:"0 8px 32px rgba(0,0,0,0.6)"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"8px 12px",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
        <span style={{fontSize:11,fontWeight:700,color:"#818CF8",textTransform:"uppercase",
          letterSpacing:"0.1em"}}>Log ricerca</span>
        <button onClick={props.onClose}
          style={{fontSize:12,width:20,height:20,borderRadius:5,border:"none",
            background:"rgba(255,255,255,0.08)",color:"#94A3B8",cursor:"pointer"}}>×</button>
      </div>
      <div style={{overflowY:"auto",flex:1,padding:"4px 0"}}>
        {!logs.length&&<div style={{padding:"10px 12px",fontSize:11,color:"#4B5563",textAlign:"center"}}>
          Avvia una ricerca per vedere i log
        </div>}
        {logs.map(function(log) {
          var c = log.level==="error"?"#F87171":log.level==="success"?"#34D399":log.level==="warn"?"#FBBF24":"#94A3B8";
          var icon = log.level==="error"?"✗":log.level==="success"?"✓":log.level==="warn"?"⚠":"→";
          return (
            <div key={log.id} style={{padding:"4px 12px",borderBottom:"1px solid rgba(255,255,255,0.03)"}}>
              <span style={{fontSize:9,color:"#4B5563",marginRight:5}}>{log.time}</span>
              <span style={{fontSize:9,color:c,marginRight:4,fontWeight:700}}>{icon}</span>
              <span style={{fontSize:11,color:c}}>{log.msg}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SettingsModal(props) {
  var [apify,  setApify]  = useState(props.keys.apify||"");
  var [serper, setSerper] = useState(props.keys.serper||"");

  var fields = [
    {
      label:"Apify Token",
      desc:"apify.com → Settings → Integrations — per Instagram, Facebook, Immobiliare.it, Subito",
      link:"https://console.apify.com/account/integrations",
      val:apify, set:setApify,
    },
    {
      label:"Serper.dev API Key",
      desc:"serper.dev → 2.500 ricerche gratuite — per Google Maps + Gruppi FB + Telegram",
      link:"https://serper.dev/api-key",
      val:serper, set:setSerper,
    },
  ];

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.9)",backdropFilter:"blur(8px)",
      zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:"#0F1629",border:"1px solid rgba(99,102,241,0.3)",
        borderRadius:18,padding:28,maxWidth:480,width:"100%",
        boxShadow:"0 24px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(99,102,241,0.1)"}}>
        <div style={{fontSize:16,fontWeight:800,marginBottom:4,display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:20}}>🏠</span>
          <span>Property<span style={{color:"#F59E0B"}}>Scout</span> — Configura API</span>
        </div>
        <div style={{fontSize:11,color:"#475569",marginBottom:20}}>
          Solo dati reali — zero risultati inventati
        </div>

        {fields.map(function(f,i){
          return (
            <div key={i} style={{marginBottom:18}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                <span style={{fontSize:11,fontWeight:700,color:"#CBD5E1"}}>{f.label}</span>
                {f.val&&f.val.length>10&&<span style={{fontSize:10,color:"#34D399"}}>✓ attiva</span>}
              </div>
              <div style={{fontSize:10,color:"#475569",marginBottom:6}}>
                {f.desc} — <a href={f.link} target="_blank" rel="noopener noreferrer"
                  style={{color:"#818CF8",textDecoration:"none"}}>{f.link.replace("https://","")}</a>
              </div>
              <input value={f.val} onChange={function(e){f.set(e.target.value);}} type="password"
                placeholder="Incolla la tua API key..."
                style={{width:"100%",background:"rgba(255,255,255,0.04)",
                  border:"1px solid rgba(99,102,241,0.2)",borderRadius:8,
                  padding:"9px 12px",color:"#F1F5F9",fontSize:12,fontFamily:"monospace",outline:"none"}}/>
            </div>
          );
        })}

        <div style={{padding:"10px 14px",background:"rgba(99,102,241,0.05)",borderRadius:10,
          border:"1px solid rgba(99,102,241,0.12)",marginBottom:18,fontSize:11,color:"#64748B",lineHeight:1.9}}>
          <strong style={{color:"#E2E8F0"}}>💡 Tip:</strong> Aggiungi le key su Vercel<br/>
          <span style={{fontSize:10,color:"#475569"}}>Settings → Environment Variables → APIFY_TOKEN + SERPER_API_KEY</span><br/><br/>
          <strong style={{color:"#E2E8F0"}}>Con Serper:</strong> Google Maps · Gruppi Facebook · Telegram annunci<br/>
          <strong style={{color:"#E2E8F0"}}>Con Apify:</strong> Instagram · Facebook Pagine · Subito · Immobiliare · VRBO
        </div>

        <div style={{display:"flex",gap:8}}>
          <button onClick={function(){props.onSave({apify:apify,serper:serper});}}
            style={{flex:1,padding:"11px",borderRadius:9,border:"none",
              background:"linear-gradient(135deg,#3730A3,#6366F1)",
              color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",
              boxShadow:"0 4px 16px rgba(99,102,241,0.35)"}}>
            Salva
          </button>
          <button onClick={props.onClose}
            style={{padding:"11px 16px",borderRadius:9,border:"1px solid rgba(255,255,255,0.08)",
              background:"transparent",color:"#64748B",fontSize:13,cursor:"pointer"}}>
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function App() {
  var [msgs,         setMsgs]         = useState([]);
  var [input,        setInput]        = useState("");
  var [busy,         setBusy]         = useState(false);
  var [apiKeys,      setApiKeys]      = useState({apify:"",serper:""});
  var [showSettings, setShowSettings] = useState(false);
  var [searchMode,   setSearchMode]   = useState("all");
  var [showLog,      setShowLog]      = useState(false);
  var [logs,         setLogs]         = useState([]);
  var [parsedReq,    setParsedReq]    = useState(null);
  var [allLeads,     setAllLeads]     = useState([]);
  var endRef = useRef(null);
  var inpRef = useRef(null);

  useEffect(function() {
    if (IS_VERCEL) {
      fetch("/api/config").then(function(r){ return r.ok ? r.json() : null; }).then(function(cfg) {
        if (cfg && cfg.keys && (cfg.keys.apify || cfg.keys.serper)) {
          var fromEnv = { apify: cfg.keys.apify||"", serper: cfg.keys.serper||"" };
          setApiKeys(fromEnv);
          storage.set("ps:keys", JSON.stringify(fromEnv)).catch(function(){});
          return;
        }
        loadKeysFromStorage();
      }).catch(function(){ loadKeysFromStorage(); });
    } else {
      loadKeysFromStorage();
    }

    storage.get("ps:leads").then(function(r) {
      if (r&&r.value) { try { setAllLeads(JSON.parse(r.value)); } catch(e){} }
      else {
        // migrate from old key
        storage.get("luxy:leads").then(function(r2) {
          if (r2&&r2.value) { try { setAllLeads(JSON.parse(r2.value)); } catch(e){} }
        }).catch(function(){});
      }
    }).catch(function(){});
  },[]);

  function loadKeysFromStorage() {
    storage.get("ps:keys").then(function(r) {
      if (r&&r.value) {
        try { setApiKeys(JSON.parse(r.value)); return; } catch(e){}
      }
      // migrate from old storage key
      return storage.get("luxy:keys").then(function(r2) {
        if (r2&&r2.value) {
          try {
            var old2 = JSON.parse(r2.value);
            var migrated = { apify: old2.apify||"", serper: old2.serper||"" };
            setApiKeys(migrated);
            storage.set("ps:keys", JSON.stringify(migrated)).catch(function(){});
          } catch(e){}
        }
      });
    }).catch(function(){});
  }

  function addLog(level, msg) {
    setLogs(function(prev) {
      return [{
        time: new Date().toLocaleTimeString("it-IT"),
        level: level, msg: msg,
        id: Date.now()+Math.random()
      }].concat(prev).slice(0,100);
    });
  }

  function pushMsg(role, content, leads) {
    setMsgs(function(prev) {
      return prev.concat([{role:role,content:content,leads:leads||null,id:Date.now()+Math.random()}]);
    });
    setTimeout(function(){ if (endRef.current) endRef.current.scrollIntoView({behavior:"smooth"}); },100);
  }

  async function saveKeys(keys) {
    setApiKeys(keys);
    try { await storage.set("ps:keys",JSON.stringify(keys)); } catch(e){}
    setShowSettings(false);
  }

  function handleStatus(id, status) {
    setAllLeads(function(prev) {
      var updated = prev.map(function(l) {
        return l.id===id ? Object.assign({},l,{status:status}) : l;
      });
      storage.set("ps:leads",JSON.stringify(updated)).catch(function(){});
      return updated;
    });
  }

  async function send() {
    var text = input.trim();
    if (!text||busy) return;
    setInput("");
    pushMsg("user", text);
    setBusy(true);
    setLogs([]);
    addLog("info", "Analisi richiesta...");

    try {
      var req = null;
      try {
        var raw = await callClaude(text, NLP_PROMPT);
        req = parseJSON(raw);
        if (req && req.destination) {
          setParsedReq(req);
          var parts = [];
          if (req.destination) parts.push("dest="+req.destination);
          if (req.roomType)    parts.push("tipo="+req.roomType);
          if (req.budgetMax)   parts.push("budget="+req.budgetMax);
          if (req.durationType) parts.push(req.durationType);
          if (req.licenza)     parts.push("con licenza");
          addLog("success","Filtri: "+parts.join(" | "));
        }
      } catch(e) {
        addLog("warn","Parse NLP fallito: "+e.message);
      }

      var dest = (req&&req.destination) ? req.destination : text.split(/[\s,]+/)[0];
      addLog("info","Ricerca proprietari: "+dest+" ("+searchMode+")");

      var leads = await runSearch(dest, searchMode, req, apiKeys, function(label, status) {
        if (status==="loading") addLog("info", label+" → avviato");
        else if (status.startsWith("done:")) addLog("success", label+" → "+status.replace("done:","")+". risultati");
        else if (status.startsWith("error:")) addLog("error", label+" → "+status.replace("error:",""));
      });

      setBusy(false);

      setAllLeads(function(prev) {
        var merged = leads.concat(prev.filter(function(p) {
          return !leads.find(function(l){return l.id===p.id;});
        }));
        storage.set("ps:leads",JSON.stringify(merged)).catch(function(){});
        return merged;
      });

      var high = leads.filter(function(l){return l.priority==="HIGH";}).length;
      var wa   = leads.filter(function(l){return l.whatsapp;}).length;
      var lic  = leads.filter(function(l){return l.licenza;}).length;
      pushMsg("assistant",
        "Trovati "+leads.length+" proprietari per "+dest+" — "+high+" HIGH priority · "+wa+" con WhatsApp"+(lic?" · "+lic+" con licenza":""),
        leads
      );

    } catch(e) {
      setBusy(false);
      addLog("error","Errore: "+e.message);
      pushMsg("assistant","Errore: "+e.message);
    }
  }

  function handleKey(e) {
    if (e.key==="Enter"&&!e.shiftKey) { e.preventDefault(); send(); }
  }

  var SUGGESTIONS = [
    "Appartamenti Roma - trova proprietari privati con licenza",
    "Milano affitti brevi - proprietari diretti luglio agosto",
    "Ibiza villa luglio agosto budget 3000 settimana",
    "Sardegna casa vacanze agosto 2026 privato",
    "Mykonos villa stagionale maggio-settembre",
    "Roma","Milano","Firenze","Napoli",
  ];

  var hasKeys = IS_VERCEL || apiKeys.apify || apiKeys.serper;
  var hasErrors = logs.some(function(l){return l.level==="error";});
  var lastMsg = msgs.filter(function(m){return m.leads;}).pop()||null;

  return (
    <div style={{height:"100vh",display:"flex",flexDirection:"column",
      background:"#09090B",color:"#F1F5F9",fontFamily:"Inter,system-ui,sans-serif"}}>
      <style dangerouslySetInnerHTML={{__html:
        "@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-7px)}} " +
        "@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}} " +
        "@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.6}} " +
        "html,body,#root{margin:0;padding:0;border:0;} " +
        "body{background:radial-gradient(ellipse at 60% -10%, #1a1535 0%, #09090B 55%) fixed;} " +
        "textarea:focus,input:focus,select:focus{outline:none} " +
        "::-webkit-scrollbar{width:3px} ::-webkit-scrollbar-thumb{background:#4338CA;border-radius:2px} " +
        "*{box-sizing:border-box} " +
        ".ps-lead-card:hover{transform:translateY(-1px);box-shadow:0 4px 24px rgba(99,102,241,0.1);} " +
        ".ps-mode-btn{transition:all 0.15s ease;} " +
        ".ps-suggestion-btn:hover{background:rgba(99,102,241,0.08) !important;border-color:rgba(99,102,241,0.2) !important;color:#C7D2FE !important;} " +
        "@media(max-width:640px){" +
          ".lx-header{padding:8px 12px !important;}" +
          ".lx-modes{padding:5px 10px !important;}" +
          ".lx-messages{padding:10px 10px !important;}" +
          ".lx-input{padding:8px 10px 12px !important;}" +
          ".lx-logo{width:28px !important;height:28px !important;}" +
          ".lx-title{font-size:13px !important;}" +
          ".lx-sub{display:none !important;}" +
          ".lx-btn-text{display:none !important;}" +
          ".lx-card-name{font-size:13px !important;}" +
          ".lx-stats{gap:5px !important;}" +
          ".lx-stat{min-width:55px !important;padding:5px 7px !important;}" +
          ".lx-stat-num{font-size:15px !important;}" +
          ".lx-filters{flex-wrap:wrap !important;}" +
          ".lx-msg-grid{grid-template-columns:1fr !important;}" +
        "}"
      }}/>

      {showSettings&&<SettingsModal keys={apiKeys} onSave={saveKeys} onClose={function(){setShowSettings(false);}}/>}
      {showLog&&<LogPanel logs={logs} onClose={function(){setShowLog(false);}}/>}

      {/* HEADER */}
      <div className="lx-header" style={{borderBottom:"1px solid rgba(99,102,241,0.15)",
        padding:"10px 14px",display:"flex",alignItems:"center",gap:10,
        background:"rgba(9,9,11,0.95)",backdropFilter:"blur(12px)",
        position:"sticky",top:0,zIndex:100,flexShrink:0}}>
        <div className="lx-logo" style={{width:34,height:34,borderRadius:9,
          background:"linear-gradient(135deg,#1E1B4B,#312E81)",
          border:"1.5px solid rgba(99,102,241,0.4)",display:"flex",alignItems:"center",
          justifyContent:"center",flexShrink:0,boxShadow:"0 0 16px rgba(99,102,241,0.2)"}}>
          <span style={{fontSize:13,fontWeight:900,letterSpacing:"-0.5px",color:"#fff"}}>
            P<span style={{color:"#F59E0B"}}>S</span>
          </span>
        </div>
        <div style={{minWidth:0}}>
          <div className="lx-title" style={{fontSize:15,fontWeight:800,letterSpacing:"-0.3px",whiteSpace:"nowrap"}}>
            Property<span style={{color:"#F59E0B"}}>Scout</span>
          </div>
          <div className="lx-sub" style={{fontSize:9,color:"#475569",textTransform:"uppercase",letterSpacing:"0.12em"}}>
            Owner Discovery Platform
          </div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:5,alignItems:"center",flexShrink:0}}>
          <button onClick={function(){setShowLog(function(o){return !o;});}}
            style={{fontSize:10,padding:"4px 9px",borderRadius:20,cursor:"pointer",fontWeight:700,
              background:hasErrors?"rgba(248,113,113,0.12)":"rgba(255,255,255,0.05)",
              border:"1px solid "+(hasErrors?"rgba(248,113,113,0.35)":"rgba(255,255,255,0.1)"),
              color:hasErrors?"#F87171":"#64748B"}}>
            {showLog?"✕":"📊"}<span className="lx-btn-text">{logs.length>0?" ("+logs.length+")":""}</span>
          </button>
          <button onClick={function(){setShowSettings(true);}}
            style={{fontSize:10,padding:"4px 11px",borderRadius:20,cursor:"pointer",fontWeight:600,
              background:hasKeys?"rgba(52,211,153,0.1)":"rgba(251,191,36,0.1)",
              border:"1px solid "+(hasKeys?"rgba(52,211,153,0.3)":"rgba(251,191,36,0.3)"),
              color:hasKeys?"#34D399":"#F59E0B"}}>
            {hasKeys?"⚙":"⚠"}<span className="lx-btn-text"> {hasKeys?"API":"Configura"}</span>
          </button>
        </div>
      </div>

      {/* MODE SELECTOR */}
      <div className="lx-modes" style={{padding:"6px 14px",borderBottom:"1px solid rgba(255,255,255,0.04)",
        background:"rgba(9,9,11,0.8)",flexShrink:0,overflowX:"auto"}}>
        <div style={{display:"flex",gap:4,maxWidth:720,margin:"0 auto",width:"max-content",minWidth:"100%"}}>
          {SEARCH_MODES.map(function(m) {
            var isA = searchMode===m.id;
            return (
              <button key={m.id} onClick={function(){setSearchMode(m.id);}}
                className="ps-mode-btn"
                style={{fontSize:11,padding:"5px 11px",borderRadius:8,whiteSpace:"nowrap",
                  border:"1px solid "+(isA?"rgba(99,102,241,0.5)":"rgba(255,255,255,0.06)"),
                  background:isA?"rgba(99,102,241,0.15)":"transparent",
                  color:isA?"#A5B4FC":"#64748B",cursor:"pointer",fontWeight:isA?700:400}}>
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* MESSAGES */}
      <div className="lx-messages" style={{flex:1,overflowY:"auto",padding:"16px 14px"}}>
        <div style={{maxWidth:720,margin:"0 auto"}}>

          {/* Empty state */}
          {!msgs.length&&(
            <div style={{animation:"fadeUp 0.5s ease"}}>
              <div style={{textAlign:"center",padding:"20px 0 16px"}}>

                {/* Hero logo */}
                <div style={{width:72,height:72,borderRadius:18,
                  background:"linear-gradient(135deg,#1E1B4B 0%,#312E81 60%,#3730A3 100%)",
                  border:"2px solid rgba(99,102,241,0.35)",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  margin:"0 auto 14px",
                  boxShadow:"0 0 48px rgba(99,102,241,0.2), 0 16px 32px rgba(0,0,0,0.4)"}}>
                  <span style={{fontSize:26,fontWeight:900,letterSpacing:"-1px",color:"#fff"}}>
                    P<span style={{color:"#F59E0B"}}>S</span>
                  </span>
                </div>

                <div style={{fontSize:22,fontWeight:800,letterSpacing:"-0.5px",marginBottom:6}}>
                  Property<span style={{color:"#F59E0B"}}>Scout</span>
                </div>
                <div style={{fontSize:13,color:"#475569",lineHeight:2,maxWidth:420,margin:"0 auto 4px"}}>
                  Trova proprietari di appartamenti reali con cui collaborare<br/>
                  <span style={{fontSize:11,color:"#374151"}}>Ricerca su 9 canali · AI scoring · Contatti diretti</span>
                </div>

                {/* Channel pills */}
                <div style={{display:"flex",flexWrap:"wrap",gap:5,justifyContent:"center",marginTop:10,marginBottom:20}}>
                  {[
                    {l:"Google Maps",c:"#4285F4"},{l:"Facebook Gruppi",c:"#1877F2"},
                    {l:"Telegram",c:"#26A5E4"},{l:"Immobiliare.it",c:"#0E4CB2"},
                    {l:"Subito.it",c:"#CC0000"},{l:"Airbnb",c:"#FF5A5F"},
                    {l:"Instagram",c:"#E1306C"},{l:"VRBO",c:"#2196F3"},
                    {l:"MediaVacanze",c:"#FF6B35"},
                  ].map(function(ch,i){
                    return <span key={i} style={{fontSize:10,padding:"3px 10px",borderRadius:20,
                      background:ch.c+"12",border:"1px solid "+ch.c+"30",color:ch.c,fontWeight:600}}>
                      {ch.l}
                    </span>;
                  })}
                </div>
              </div>

              <div style={{display:"flex",flexDirection:"column",gap:6,maxWidth:640,margin:"0 auto"}}>
                {SUGGESTIONS.map(function(s,i) {
                  return (
                    <button key={i} onClick={function(){setInput(s);if(inpRef.current)inpRef.current.focus();}}
                      className="ps-suggestion-btn"
                      style={{textAlign:"left",padding:"11px 16px",borderRadius:10,
                        background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.06)",
                        color:"#64748B",fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",gap:8,
                        transition:"all 0.15s ease"}}>
                      <span style={{color:"#6366F1",flexShrink:0,fontSize:10}}>▸</span>{s}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Messages */}
          {msgs.map(function(m) {
            var isLast = m===lastMsg;
            return (
              <div key={m.id} style={{marginBottom:14,animation:"fadeUp 0.25s ease",
                display:"flex",flexDirection:"column",
                alignItems:m.role==="user"?"flex-end":"flex-start"}}>
                {m.role==="user" ? (
                  <div style={{maxWidth:"80%",padding:"9px 14px",
                    borderRadius:"13px 13px 4px 13px",
                    background:"linear-gradient(135deg,#3730A3,#6366F1)",
                    fontSize:13,color:"#fff",lineHeight:1.5,
                    boxShadow:"0 4px 16px rgba(99,102,241,0.25)"}}>
                    {m.content}
                  </div>
                ) : (
                  <div style={{width:"100%"}}>
                    <div style={{display:"inline-block",padding:"9px 13px",
                      borderRadius:"4px 13px 13px 13px",
                      background:"rgba(255,255,255,0.03)",
                      border:"1px solid rgba(99,102,241,0.12)",
                      fontSize:13,color:"#CBD5E1",lineHeight:1.5,maxWidth:"100%"}}>
                      {m.content}
                    </div>
                    {isLast&&parsedReq&&<FilterBadges req={parsedReq}/>}
                    {m.leads&&m.leads.length>0&&(
                      <ResultsView leads={m.leads} onStatus={handleStatus}/>
                    )}
                    {m.leads&&m.leads.length===0&&(
                      <div style={{fontSize:11,color:"#374151",marginTop:6}}>
                        Nessun risultato trovato. Controlla i log.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Loading */}
          {busy&&(
            <div style={{padding:"12px 16px",borderRadius:"4px 13px 13px 13px",
              background:"rgba(255,255,255,0.03)",border:"1px solid rgba(99,102,241,0.15)",
              display:"inline-block",animation:"fadeUp 0.2s ease"}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{display:"flex",gap:4}}>
                  {[0,1,2].map(function(i) {
                    return <div key={i} style={{width:6,height:6,borderRadius:"50%",
                      background:"#6366F1",
                      animation:"bounce 1.2s ease-in-out "+(i*0.2)+"s infinite"}}/>;
                  })}
                </div>
                <span style={{fontSize:12,color:"#64748B"}}>Scansione proprietari in corso...</span>
              </div>
            </div>
          )}

          <div ref={endRef}/>
        </div>
      </div>

      {/* INPUT */}
      <div className="lx-input" style={{borderTop:"1px solid rgba(99,102,241,0.1)",
        padding:"10px 12px 13px",background:"rgba(9,9,11,0.95)",backdropFilter:"blur(12px)",flexShrink:0}}>
        <div style={{maxWidth:720,margin:"0 auto",display:"flex",gap:6,alignItems:"flex-end"}}>
          <textarea ref={inpRef} value={input}
            onChange={function(e){setInput(e.target.value);}}
            onKeyDown={handleKey}
            placeholder="Es: Roma appartamenti privati con licenza · Ibiza villa luglio agosto · Milano affitti brevi"
            rows={2} disabled={busy}
            style={{flex:1,background:"rgba(255,255,255,0.04)",
              border:"1px solid rgba(99,102,241,0.2)",borderRadius:10,
              padding:"9px 12px",color:"#F1F5F9",fontSize:13,resize:"none",
              fontFamily:"inherit",lineHeight:1.5,opacity:busy?0.5:1,
              transition:"border-color 0.15s ease"}}/>
          <button onClick={send} disabled={busy||!input.trim()}
            style={{width:42,height:42,borderRadius:10,border:"none",
              background:busy||!input.trim()
                ?"rgba(99,102,241,0.08)"
                :"linear-gradient(135deg,#3730A3,#6366F1)",
              color:"#fff",fontSize:17,cursor:busy||!input.trim()?"not-allowed":"pointer",
              flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
              boxShadow:busy||!input.trim()?"none":"0 4px 16px rgba(99,102,241,0.35)",
              transition:"all 0.15s ease"}}>
            {busy?"⏳":"↑"}
          </button>
        </div>
        <div style={{maxWidth:720,margin:"3px auto 0",fontSize:10,color:"#374151",textAlign:"center"}}>
          9 canali · Google Maps · FB Gruppi · Telegram · Immobiliare · Subito · Airbnb · Instagram · VRBO · MediaVacanze
        </div>
      </div>
    </div>
  );
}
