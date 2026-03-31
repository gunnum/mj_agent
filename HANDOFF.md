# Midjourney Agent Handoff

This folder is a standalone local service for Midjourney Explore search and feed access.

It is intentionally decoupled from `dnews` runtime:
- no `dnews` queue
- no `dnews` backend API
- no `dnews` database dependency

The service runs locally, opens a persistent Chrome profile, and uses the logged-in browser context to query Midjourney Explore APIs.

## What It Can Do

- report browser/login health
- open the Midjourney Explore page in Chrome
- search Explore images by keyword
- fetch `styles_top`
- fetch `video_top`

## Proven Endpoints

These are the Midjourney endpoints verified during local testing:

- `GET /api/explore-vector-search?prompt=<keyword>&page=<n>&_ql=explore`
- `GET /api/explore-srefs?page=<n>&_ql=explore&feed=styles_top`
- `GET /api/explore?page=<n>&feed=video_top&_ql=explore`

## Current Local API

- `GET /health`
- `GET /api/login/status`
- `POST /api/browser/open`
- `GET /api/explore/search?prompt=red&page=1`
- `GET /api/explore/styles-top?page=1`
- `GET /api/explore/video-top?page=1`

## Search Result Notes

- Search result items do not include a detail page URL field directly.
- A usable detail page can be derived as:

```text
https://www.midjourney.com/jobs/<id>
```

Example:

```text
https://www.midjourney.com/jobs/bd6d4e48-8a7c-4d18-b14a-0b62f1fe45f0
```

## Why It Works

Midjourney blocks plain backend scraping with Cloudflare and auth checks.

The stable path is:

1. launch a persistent Chrome profile
2. keep the user logged in interactively
3. open Midjourney Explore in that profile
4. execute same-origin `fetch` calls from the page context

Earlier DOM-driven search automation was more fragile. The current implementation avoids depending on the search input DOM and calls the verified Explore endpoints directly from the logged-in browser page context.

## File Map

- `package.json`: project metadata and scripts
- `src/server.ts`: local HTTP server and route handling
- `src/browser.ts`: Midjourney browser session and API fetch logic
- `src/config.ts`: runtime config parsing
- `src/types.ts`: response and status types
- `src/utils.ts`: helper functions
- `.env.example`: environment template
- `README.md`: quickstart

## Setup

```bash
cd midjourney-agent
npm install
cp .env.example .env
npm run start
```

## Recommended Runtime

Use a dedicated Chrome profile for the agent.

Recommended env:

```bash
MJ_USER_DATA_DIR="$HOME/.dnews-midjourney-profile/explore-debug"
MJ_HEADLESS=false
```

`MJ_HEADLESS=false` is recommended because:
- first-time login and Cloudflare challenge are easier to complete
- debugging is simpler
- some flows are more reliable with a visible browser

## First Run

1. start the service
2. call `POST /api/browser/open`
3. complete Midjourney login / Cloudflare in the Chrome window if needed
4. call search

Example:

```bash
curl -X POST http://127.0.0.1:18123/api/browser/open
curl "http://127.0.0.1:18123/api/explore/search?prompt=red&page=1"
```

## Verified Local Result

`search=red page=1` was verified successfully.

The service hit:

```text
https://www.midjourney.com/api/explore-vector-search?prompt=red&page=1&_ql=explore
```

and returned `200 OK`.

## Deployment Notes For Air Bot

This should be deployed as a local or workstation-side bot, not as a pure remote backend crawler.

Reason:
- Midjourney login is tied to a real browser session
- Cloudflare challenges need browser state
- credentials and cookies live in the Chrome profile

Deployment expectations:
- macOS preferred
- Google Chrome installed
- interactive browser access available
- persistent disk for the Chrome profile directory

## Known Constraints

- No task queue yet
- No persistence layer yet for search results
- No admin UI yet
- `loginState` is heuristic, based on current page content/url
- Midjourney may change DOM or endpoint contracts

## Suggested Next Steps

1. add normalized output format with `detail_url`
2. add file/SQLite persistence
3. add batch pagination fetch
4. add simple auth token in front of the local API if needed
5. add one-click startup shell script for operators
