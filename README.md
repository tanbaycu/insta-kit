# insta-kit

> Autonomous cross-platform growth pipeline — TikTok comment mining → Instagram audience acquisition.

**Author:** [tanbaycu](https://github.com/tanbaycu) · **License:** Personal Use Only — see [LICENSE](./LICENSE)

---

## Overview

**insta-kit** is a Node.js + Python automation suite that extracts Instagram handles from TikTok comment sections, validates account quality via browser-based heuristics, executes follow campaigns through a Puppeteer-driven stealth layer, and periodically prunes non-reciprocal follows via Instagram's internal GraphQL API.

---

## Project Structure

```
insta-kit/
├── 1.js                    # Stage 1 — TikTok comment scraper (Puppeteer)
├── 3.js                    # Stage 2 — Instagram profile validator (Puppeteer)
├── 2.js                    # Stage 3 — Follow executor (stealth, randomized delay)
├── 6.js                    # Stage 4 — Unfollow pruner (non-reciprocal detection)
├── 4_api_follow.py         # API-layer follow executor (high-throughput, header-spoofed)
├── start_chrome.bat        # Launches Chrome with remote debug port (required)
│
├── gilgamesh/
│   ├── 2_gil.js            # Dedicated follow executor for secondary account
│   └── start_chrome_gil.bat
│
├── ig_list.txt             # [pipeline] Raw extracted handles (Stage 1 output)
├── ig_done.txt             # [pipeline] Confirmed-followed handle log
│
└── package.json
```

> **Note:** All runtime data files (`ig_list.txt`, `ig_done.txt`, session logs, etc.) are excluded from version control. Create empty versions locally before first run — see **Setup** below.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | ≥ 18.x |
| Python | ≥ 3.10 |
| Google Chrome | Latest stable |
| Puppeteer | Bundled via `npm install` |

---

## Setup

```bash
# 1. Clone and install dependencies
git clone https://github.com/<your-org>/insta-kit.git
cd insta-kit
npm install

# 2. Initialize required pipeline data files
echo. > ig_list.txt
echo. > ig_done.txt
echo. > list_video_tiktok.txt

# 3. Populate TikTok video links (one URL per line)
#    Edit list_video_tiktok.txt with target video URLs

# 4. Launch Chrome with remote debugging enabled
start_chrome.bat          # Windows — main account
# gilgamesh\start_chrome_gil.bat  — secondary account

# 5. Sign in to Instagram inside the launched Chrome window
```

---

## Pipeline

```
[TikTok Videos] ──1.js──► ig_list.txt
                                │
                    ──3.js──► (validated handles)
                                │
                    ──2.js──► ig_done.txt
                                │
                (periodically) ──6.js──► unfollow non-reciprocal
```

Run each stage in a separate terminal for continuous parallelism:

```bash
# Terminal 1 — Scrape
node 1.js

# Terminal 2 — Validate
node 3.js

# Terminal 3 — Follow
node 2.js

# Terminal 4 — Prune (run periodically, every few days)
node 6.js
```

**`6.js` interactive prompt:**
- `1` — Unfollow all non-reciprocal accounts
- `2` — Unfollow only accounts followed by this tool (`ig_done.txt` cross-reference)

---

## Secondary Account — Gilgamesh Engine (`2_gil.js`)

`2_gil.js` is architecturally the most advanced executor in the suite. It is not a simplified copy of `2.js` — it implements a distinct, hardened follow engine designed for resilience and stealth.

### Key Mechanisms

| Mechanism | Description |
|---|---|
| **Page Visibility Spoofing** | Overrides `document.visibilityState` and suppresses `visibilitychange` events at document level, preventing Instagram from detecting tab-switching or backgrounding — keeps the session active indefinitely |
| **Search-Based Navigation** | Instead of direct URL injection (`/username/`), navigates via Instagram's native search bar with human-simulated typing (`delay: 90ms/char`) — mimics organic user behavior to bypass pattern detection |
| **Multi-Attempt Follow Retry** | `for (let i = 0; i < 5; i++)` retry loop per profile — retries up to 5 times per target with incremental waits before marking as failed |
| **Dual-Path Click Fallback** | Primary: `ElementHandle.click()` with randomized click delay (30–80ms). Fallback: `page.evaluate(e => e.click())` in-page JS click — survives Puppeteer `detached frame` errors |
| **Post-Click State Verification** | After clicking Follow, reads the button's `innerText` to confirm state changed to `following / đang theo dõi / requested` before logging success — no false positives |
| **Auto-Reset on 2 Consecutive Failures** | `consecutiveErrors >= 2` triggers a hard reload to `instagram.com` — flushes rate-limit signals and soft-block states without restarting the process |
| **In-Memory Dedup Lock** | `isProcessingSet` (Set) prevents re-queuing the same username mid-cycle in concurrent contexts — race-condition safe |
| **Dynamic Random Rest** | 10,000–18,000ms randomized inter-follow delay — significantly longer than `2.js`, tuned specifically to evade Gilgamesh account-level rate limiting |
| **Session File Hot-Reload** | Re-reads session and done-list files on every loop iteration — allows external injection of new targets while the bot is running, zero restart required |
| **Isolated Data Namespace** | All I/O (`id_list_gil.txt`, `ig_done_gil.txt`, `session_follow_gilgamesh.txt`) is fully decoupled from the main account pipeline |

### Why it's stronger than `2.js`

- `2.js` navigates by direct URL; `2_gil.js` uses the **search interface** — far harder to fingerprint as automated
- `2_gil.js` includes **visibility state spoofing** — missing from `2.js`
- **5× retry loop** vs single-attempt in `2.js`
- **Dual-path click fallback** handles detached frame errors that cause `2.js` to skip profiles
- **Auto-reset circuit breaker** vs manual intervention in `2.js`

```bash
# Launch dedicated Chrome instance (remote debug port 9223)
gilgamesh\start_chrome_gil.bat

# Sign in to the Gilgamesh Instagram account in Chrome

# Run executor
node gilgamesh/2_gil.js
```

---

## API Executor (Python)

`4_api_follow.py` interfaces directly with Instagram's private API for high-throughput follow operations — bypasses browser overhead with spoofed headers.

```bash
pip install requests
python 4_api_follow.py
```

> Requires a valid session cookie configured inside the script.

---

## Data Files Reference

| File | Purpose | Tracked |
|---|---|---|
| `ig_list.txt` | Raw scraped handles | ✗ |
| `ig_done.txt` | Followed handle log | ✗ |
| `ig_unfollowed_history.txt` | Unfollowed log | ✗ |
| `list_video_tiktok.txt` | TikTok input queue | ✗ |
| `cookies.txt` | Session cookies | ✗ |
| `gilgamesh/id_list_gil.txt` | Target IDs for secondary account | ✗ |

---

## Legal Disclaimer

This tool interfaces with third-party platforms in ways that may violate their Terms of Service. Use at your own risk. The author assumes no liability for account restrictions or legal consequences arising from use of this software.

See [LICENSE](./LICENSE) for full terms — personal use only.

---

*insta-kit — engineered for scale. Built by [tanbaycu](https://github.com/tanbaycu).*
