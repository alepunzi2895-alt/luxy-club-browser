# LuXy Club — Partner Discovery v3

Sistema di discovery fornitori turistici con 8 canali reali, NLP, scoring AI e generazione messaggi.

## 8 Canali

| Canale | Metodo | API key |
|---|---|---|
| Google Maps | Serper.dev | Serper key (2.500/mese gratis) |
| Instagram | Apify | Apify token |
| Facebook Pages | Apify | Apify token |
| Telegram pubblici | Fetch t.me/s/ | Nessuna |
| MediaVacanze | Scraping HTML | Nessuna |
| Subito.it | Scraping HTML | Nessuna |
| Idealista | Scraping HTML | Nessuna |
| Immobiliare.it | Apify | Apify token |

## Variabili Vercel

Settings > Environment Variables:
- ANTHROPIC_API_KEY — NLP + message generator
- SERPER_API_KEY — Google Maps (opzionale, va anche nell'app)

## Deploy

```bash
git add .
git commit -m "LuXy v3"
git push origin main --force
```

Costo mensile: ~0 EUR per uso normale.
