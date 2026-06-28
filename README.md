# WordFinder - Web Crawler for Keyword Discovery

WordFinder is a small web crawler that scans a bounded part of a website and
finds pages where a selected keyword or phrase appears. It is designed as a
portfolio-ready proof of concept for terminology, brand, and content audits.

The app has a FastAPI backend and a plain HTML/CSS/JavaScript frontend. The
scan runs over a WebSocket connection so results, graph updates, and counters
appear live while the crawl is running.

Live demo:

```text
https://wordfinder.bogdanistrate.ro
```

Terms page:

```text
https://wordfinder.bogdanistrate.ro/terms
```

## Features

- Start from a website URL and crawl only the same domain.
- Limit crawl depth, page count, and concurrency.
- Live crawl map, scan feed, stats, and result cards.
- Match modes:
  - exact word
  - partial match
  - phrase
- Optional case-sensitive matching.
- Optional simple English plural matching with "Include plurals".
- Search scope options:
  - visible text
  - visible text plus metadata
  - full HTML
- CSV export for spreadsheet review and JSON export for structured handoff to
  other tools.
- `/health` endpoint for container and reverse-proxy checks.
- Public Terms page and footer links for the portfolio deployment.

## Security And Safety

WordFinder is intended to be safe enough for a public demo when deployed with
strict limits and an access token.

Implemented protections include:

- SSRF protection for crawl targets.
- Blocking private, loopback, link-local, reserved, and non-global IP ranges.
- URL re-validation across redirects.
- Robots.txt checks.
- Response size cap after decompression.
- Bounded depth, page count, and concurrency.
- WebSocket access token support.
- The frontend sends the access token in the first WebSocket message instead
  of placing it in the WebSocket URL, so normal access logs do not capture it.
- Per-IP rate limiting when the app receives a trusted client IP.
- Global and per-IP active scan limits.
- Production nginx real-IP handling for CloudFront, with forwarded client-IP
  headers overwritten before they reach the app.
- Production nginx security headers, including CSP, HSTS, frame blocking,
  referrer policy, and `nosniff`.
- The frontend avoids inline style attributes, so production CSP can stay
  strict without allowing `unsafe-inline`.

For public deployments, set `WORDFINDER_ACCESS_TOKEN` and keep crawl limits
conservative.

When WordFinder runs behind CloudFront, nginx, or another reverse proxy, make
sure the proxy chain derives the real viewer IP from trusted proxy hops and
then overwrites `X-Forwarded-For` / `X-Real-IP` before enabling
`WORDFINDER_TRUST_PROXY=true`. Otherwise, client-supplied `X-Forwarded-For`
values can make per-IP limits unreliable.

## Run Locally

Backend:

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Then open:

```text
http://localhost:8000
```

There is no frontend build step. The frontend is plain HTML/CSS/JS served by
FastAPI from the `frontend/` folder.

## Run With Docker

```bash
docker build -t wordfinder-web-crawler .
docker run --rm -p 8000:8000 wordfinder-web-crawler
```

Health check:

```bash
curl http://localhost:8000/health
```

Expected response:

```json
{"status":"ok"}
```

## Tests

Backend tests:

```bash
cd backend
python -m unittest test_crawler test_access_control
```

Frontend checks:

```bash
node frontend/graph-utils.test.js
node frontend/number-controls.test.js
node frontend/style.test.js
node frontend/app-order.test.js
node frontend/app-state.test.js
node frontend/favicon.test.js
node frontend/index.test.js
node frontend/terms.test.js
node --check frontend/app.js
```

Infrastructure template checks:

```bash
node infra/aws/wordfinder-runtime/user-data.test.js
```

The frontend checks also cover the CSP-sensitive results panel behavior: the
results section starts hidden with the native HTML `hidden` attribute and is
shown again when a scan produces matched pages, without relying on inline
`style="display:none"`.

Python syntax check:

```bash
python -m py_compile backend/main.py backend/crawler.py backend/test_crawler.py backend/test_access_control.py
```

## Runtime Configuration

Environment variables:

- `WORDFINDER_ACCESS_TOKEN` - optional access key required by `/ws/crawl`.
- `WORDFINDER_SCANS_PER_MINUTE` - per-IP scan start limit, default `4`.
- `WORDFINDER_MAX_ACTIVE_SESSIONS` - global active WebSocket scan cap, default `4`.
- `WORDFINDER_MAX_ACTIVE_SESSIONS_PER_IP` - active scan cap per IP, default `2`.
- `WORDFINDER_TRUST_PROXY` - set to `true` only behind a trusted proxy that
  overwrites `X-Forwarded-For` / `X-Real-IP`.
- `WORDFINDER_MAX_DEPTH` - server-side crawl depth cap, default `4`.
- `WORDFINDER_MAX_PAGES` - server-side page cap, default `200`.
- `WORDFINDER_MAX_CONCURRENCY` - server-side concurrency cap, default `10`.
- `WORDFINDER_MAX_RESPONSE_BYTES` - response body cap after decompression,
  default `5242880` (5 MB).
- `WORDFINDER_ALLOWED_ORIGINS` - comma-separated browser origins allowed by
  CORS when frontend and backend are served from different origins.
- `WORDFINDER_HOST` / `WORDFINDER_PORT` / `WORDFINDER_DEV_RELOAD` - used when
  running `python backend/main.py` directly.

When `WORDFINDER_ACCESS_TOKEN` is set, users must enter the same value in the
Access key field before starting a scan.

## How To Use

1. Enter a start URL.
2. Enter a keyword or phrase.
3. Adjust advanced settings if needed.
4. Choose matching behavior:
   - match mode
   - search scope
   - case sensitivity
   - include plurals
5. Click "Start scan".
6. Review live graph, stats, feed, and results.
7. Export matched pages as CSV or JSON.

CSV is the easiest format for spreadsheets. JSON keeps the same result data in
a structured package that can be imported into dashboards, automation tools,
AI assistants, or content QA systems without manually reshaping columns.

## Architecture

```text
backend/
  crawler.py                 async crawler, matching, robots.txt, limits
  main.py                    FastAPI app, /health, /ws/crawl
  test_crawler.py            crawler and matching tests
  test_access_control.py     auth, rate-limit, session-limit tests

frontend/
  index.html                 app shell
  style.css                  dark UI, layout, responsive styling
  app.js                     WebSocket client, UI state, exports
  graph-utils.js             graph/matching presentation helpers
  number-controls.js         numeric input helpers
```

## Matching Decisions

The matching behavior is intentionally explicit in the UI because word matching
has real tradeoffs.

- Exact word avoids false positives such as finding `energy` inside
  `bioenergy`.
- Partial match is useful for technical checks but can be noisier.
- Phrase mode matches multi-word phrases with flexible spacing.
- Include plurals adds simple English plural forms such as `service/services`
  and `battery/batteries`. It is not full stemming and does not include
  synonyms or translations.
- Visible text is the default because it represents what readers see.
- Metadata and full HTML are available for broader technical audits, but they
  can produce noisier matches.

## Deployment

The production deployment is live on AWS:

- GitHub repository with `dev` branch and PRs into `main`.
- GitHub Actions for tests, Docker image publishing, and deployment.
- Public GitHub Container Registry (GHCR) package for the Docker image.
- Dedicated AWS EC2 `t3.small` instance for WordFinder.
- Dedicated CloudFront distribution for `wordfinder.bogdanistrate.ro`.
- Route 53 alias record for the WordFinder CloudFront distribution.
- AWS Systems Manager Session Manager for administration; no public SSH.
- AWS Systems Manager Parameter Store `SecureString` for production secrets.
- Deployment from GitHub Actions to EC2 through SSM Run Command.
- nginx in front of the app container, configured to trust CloudFront origin
  CIDRs, overwrite forwarded IP headers, and add browser security headers.
- Dependabot for dependency update PRs and `pip-audit` in CI for backend
  dependency vulnerability checks.

Current production URL:

```text
https://wordfinder.bogdanistrate.ro
```

Production secrets such as `WORDFINDER_ACCESS_TOKEN` should not be committed,
stored in Terraform state, or hardcoded in user data.

Remaining optional hardening for a larger production setup would include a
CloudFront-to-origin verification secret, HTTPS between CloudFront and origin,
and AWS WAF rules. The current deployment relies on the access token, strict
crawl limits, security groups, and SSM-only administration for the public demo.

## Terms And License

- Public terms are served at `/terms`.
- The footer links to Bogdan Istrate's LinkedIn profile and the Terms page.
- The source code is released under the MIT License. See [LICENSE](LICENSE).

## Limitations

- JavaScript-rendered content is not executed.
- Authenticated pages are not crawled.
- Infinite scroll and client-side pagination are out of scope.
- Words split across inline HTML tags may not match.
- Crawling is single-process and intended for bounded website sections, not
  internet-scale indexing.
