# EXR Bulk Crawl — Residential Proxy Setup

The EXR scraper (`scripts/edgar/scrape-exr-facility-rents.mjs`) is wired for
residential proxy rotation. Without a proxy, PerimeterX flags the datacenter
IP after a small burst (validated 5/10/26 — first request works, subsequent
requests 403). With a residential proxy, each request rotates through a
different home IP and the bot challenge is defeated at the network layer.

## What you need

A residential proxy account from one of:

| Provider | Plan | Endpoint pattern | ~Cost |
|---|---|---|---|
| **Bright Data** | Residential or ISP | `brd.superproxy.io:22225` | ~$8/GB |
| **Smartproxy** | Residential | `gate.smartproxy.com:10000` | ~$4-7/GB |
| **Oxylabs** | Residential | `pr.oxylabs.io:7777` | ~$8/GB |

The full EXR crawl uses ~150-200 MB total for ~4,400 facilities, so the
**marginal cost is under $2 for a complete refresh**. Monthly: $50-100
depending on how often you run it.

## Setup

1. Sign up with the provider of your choice.
2. From the provider's dashboard, copy:
   - Proxy host (e.g. `brd.superproxy.io`)
   - Proxy port (e.g. `22225`)
   - Username (e.g. `brd-customer-{customer_id}-zone-residential`)
   - Password
3. Set environment variables:
   ```bash
   export EXR_PROXY_HOST=brd.superproxy.io
   export EXR_PROXY_PORT=22225
   export EXR_PROXY_USERNAME=brd-customer-{customer_id}-zone-residential
   export EXR_PROXY_PASSWORD=your_password_here
   ```
4. Run a 5-facility smoke test first:
   ```bash
   cd /c/Users/danie/OneDrive/Desktop/MASTER\ FOLDER\ -\ CLAUDE/ps-acquisition-tracker
   node scripts/edgar/scrape-exr-facility-rents.mjs --limit=5
   ```
   Expect 5/5 ✓ on the smoke test.
5. If smoke test passes, run the full crawl:
   ```bash
   node scripts/edgar/scrape-exr-facility-rents.mjs
   ```
   Estimated time: ~6-7 hours (4,400 facilities × ~5s each + occasional
   browser restarts). Run via GitHub Actions (workflow timeout = 6 hr; might
   need to chunk into 2 runs).

## Daily refresh integration

Once the proxy is provisioned, add the EXR scrape to the daily refresh
workflow at `.github/workflows/refresh-rents.yml`. Add EXR provider env vars
as **GitHub repository secrets**:
- `EXR_PROXY_HOST`
- `EXR_PROXY_PORT`
- `EXR_PROXY_USERNAME`
- `EXR_PROXY_PASSWORD`

Then add a workflow job step:
```yaml
- name: Run EXR scraper (proxy-enabled)
  env:
    EXR_PROXY_HOST: ${{ secrets.EXR_PROXY_HOST }}
    EXR_PROXY_PORT: ${{ secrets.EXR_PROXY_PORT }}
    EXR_PROXY_USERNAME: ${{ secrets.EXR_PROXY_USERNAME }}
    EXR_PROXY_PASSWORD: ${{ secrets.EXR_PROXY_PASSWORD }}
  run: node scripts/edgar/scrape-exr-facility-rents.mjs
```

## What you get

After the bulk crawl completes:
- ~4,400 EXR facilities with per-facility CC + DU rents
- Schema.org `makesOffer` extraction per facility (proven on the smoke test)
- Cross-validated against EXR FY2025 10-K MD&A in-place rent ($19.91/SF/yr)
- Available immediately as `getExrFacilityRents` / `getExrMSARentMedian` in
  the analyzer's rent anchor + multi-buyer comparison
- Storvex's coverage claim becomes: ~5,800 facilities (PSA 260 + CUBE 1,549
  + EXR 4,400 = the three largest public REITs across the country)

## Operational notes

- **Sticky sessions**: most providers default to a new IP per request, but you
  can configure a sticky session (`session-{id}`) if you want the same IP for
  ~10 minutes. For our purposes, rotating per-request is what defeats the
  PerimeterX cooldown — leave default.
- **GeoIP**: residential proxies route through random US residential IPs by
  default. If you ever want a specific market (e.g. all CA traffic), most
  providers support `country-us-state-CA` in the username string.
- **Failover**: if you hit a rate limit at one provider, the same env var
  pattern works for any of the three — just swap the credentials. Brand-
  agnostic.
