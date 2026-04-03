const puppeteer = require('puppeteer');
const fs = require('fs');
const readline = require('readline');

async function delay(time) {
    return new Promise(resolve => setTimeout(resolve, time));
}

const isProcessingSet = new Set();
let checkedCountGlobal = 0;

const cleanName = (str) => {
    if (!str) return '';
    return str.trim().replace(/^@/, '').toLowerCase();
}

async function runWorker(tabId, browser, sessionFile) {
    const page = await browser.newPage();
    console.log(`\n=> [TAB ${tabId}]: Started for Gilgamesh! Handling Session: ${sessionFile}`);
    let consecutiveErrors = 0;

    // Visibility spoofing: overrides visibilityState so Instagram never detects
    // tab-switching or backgrounding — keeps the session alive indefinitely
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
        Object.defineProperty(document, 'hidden', { get: () => false });
        window.addEventListener('visibilitychange', e => e.stopImmediatePropagation(), true);
    });

    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await delay(3000); 

    while (true) { 
        if (!fs.existsSync(sessionFile)) {
            console.log(`\n[TAB ${tabId}] CRITICAL ERROR: Session file ${sessionFile} is missing. Closing browser.`);
            break;
        }

        let rawList = fs.readFileSync(sessionFile, 'utf8');
        let allUsers = rawList.split('\n').map(u => cleanName(u)).filter(Boolean);

        let doneSet = new Set();
        if (fs.existsSync('ig_done_gil.txt')) {
            fs.readFileSync('ig_done_gil.txt', 'utf8').split('\n').forEach(line => {
                let id = cleanName(line);
                if(id) doneSet.add(id);
            });
        }

        let todoUsers = allUsers.filter(u => !doneSet.has(u) && !isProcessingSet.has(u));

        if (todoUsers.length === 0) {
            if (checkedCountGlobal % 5 === 0) { 
                console.log(`[⏳] All clean IDs (${allUsers.length}) in the current session have been processed! Waiting for a new session...`);
            }
            checkedCountGlobal++;
            await delay(5000 + Math.random() * 2000);
            continue;
        }

        let username = todoUsers[0]; 
        isProcessingSet.add(username);
        
        console.log(`\n▶ [TAB ${tabId}] Searching for: @${username}`);

        let successInThisTurn = false;
        try {
            // Step 1: Open the search panel if not already visible
            let searchIcon = await page.evaluateHandle(() => {
                let existingInput = document.querySelector('input[placeholder="Tìm kiếm"], input[placeholder="Search"]');
                if(existingInput) return null; // Already open — skip click
                let svgs = Array.from(document.querySelectorAll('svg[aria-label="Tìm kiếm"], svg[aria-label="Search"]'));
                for(let svg of svgs) return svg.closest('div[role="button"], a, span, li') || svg;
                return null;
            });
            let isIconValid = await page.evaluate(e => e !== null, searchIcon);
            if (isIconValid) {
                await searchIcon.click();
                await delay(1500);
            }
            if (isIconValid) await searchIcon.dispose();

            let inputSelector = 'input[placeholder="Tìm kiếm"], input[placeholder="Search"]';
            await page.waitForSelector(inputSelector, { timeout: 10000 });
            let inputEl = await page.$(inputSelector);
            
            // Clear previous query
            await inputEl.click({ clickCount: 3 }); 
            await page.keyboard.press('Backspace');
            await delay(500);
            
            // Type with human-like keystroke cadence (avoids clipboard paste fingerprint)
            await inputEl.type(username, { delay: 90 });
            await delay(3500); // Wait for Instagram suggestion API to resolve

            // Step 2: Click first valid search result (avatar card, excludes nav/explore links)
            let searchTargetSuccess = await page.evaluate((searchStr) => {
                let links = Array.from(document.querySelectorAll('a[href^="/"]'));
                let searchLinks = links.filter(a => {
                    let inNav = a.closest('nav, [role="navigation"]');
                    let hasImg = a.querySelector('img');
                    let rect = a.getBoundingClientRect();
                    return !inNav && hasImg && rect.width > 0 && rect.height > 0 && !a.href.includes('/explore/') && !a.href.includes('/direct/');
                });
                if (searchLinks.length > 0) {
                    searchLinks[0].click();
                    return true;
                }
                return false;
            }, username);

            if (!searchTargetSuccess) {
                console.log(`=> ⏩ [TAB ${tabId}] Skipped @${username} (Not found on Instagram search bar).`);
                fs.appendFileSync('ig_done_gil.txt', username + '\n');
                let inputElRetry = await page.$(inputSelector);
                if(inputElRetry) { await inputElRetry.click({ clickCount: 3 }); await page.keyboard.press('Backspace'); }
                await page.keyboard.press('Escape');
                await delay(1000);
                consecutiveErrors++;
            } else {
                await delay(3500);

                let followResult = false;
                // Multi-attempt retry loop — up to 5 attempts per profile
                for (let i = 0; i < 5; i++) {
                    let foundBtnHandle = await page.evaluateHandle(() => {
                        let textElements = Array.from(document.querySelectorAll('header div, header a, header span, header button'));
                        for (let el of textElements) {
                            let text = (el.innerText || el.textContent || '').trim().toLowerCase();
                            if (text === 'follow' || text === 'theo dõi' || text === 'theo dõi lại' || text === 'follow back') {
                                return el.closest('button, div[role="button"], a') || el;
                            }
                        }
                        return null;
                    });

                    let isClickable = await page.evaluate(e => e !== null, foundBtnHandle);
                    
                    if (isClickable) {
                        // Primary: Puppeteer native click with randomized delay (isTrusted = true)
                        try {
                            await foundBtnHandle.click({ delay: Math.floor(Math.random() * 50) + 30 });
                        } catch (e) {
                            // Fallback: in-page JS click if Puppeteer frame is detached
                            try { await page.evaluate(e => e.click(), foundBtnHandle); } catch (e2) {}
                        }

                        // Post-click state verification — reads button text to confirm follow success
                        await delay(1500);
                        let textAfter = await page.evaluate(e => (e.innerText || e.textContent || '').trim().toLowerCase(), foundBtnHandle);
                        
                        if (textAfter.includes('đang theo dõi') || textAfter.includes('following') || textAfter.includes('đã yêu cầu') || textAfter.includes('requested')) {
                            followResult = true;
                        } else {
                            // Network lag — secondary click to confirm
                            try { await foundBtnHandle.click({ delay: Math.floor(Math.random() * 60) + 40 }); } catch (e) {}
                            followResult = true; // Mark as best-effort success
                        }
                        
                        await foundBtnHandle.dispose();
                        break;
                    }
                    
                    await foundBtnHandle.dispose();
                    await delay(1000); 
                }

                if (followResult) {
                    console.log(`=> ✅ [TAB ${tabId}] Successfully FOLLOWED @${username}.`);
                    fs.appendFileSync('ig_done_gil.txt', username + '\n');
                    successInThisTurn = true;
                    consecutiveErrors = 0; // Reset circuit breaker
                } else {
                    console.log(`=> ⏩ [TAB ${tabId}] Target skipped (Page not found, blocked, or already followed).`);
                    fs.appendFileSync('ig_done_gil.txt', username + '\n');
                    consecutiveErrors++;
                }
            }
        } catch (err) {
            console.log(`=> ❌ [TAB ${tabId}] TIMEOUT ERROR @${username}: Connection issue or network limit.`);
            fs.appendFileSync('ig_done_gil.txt', username + '\n');
            consecutiveErrors++;
        }

        isProcessingSet.delete(username);

        // Auto-reset circuit breaker: 2 consecutive failures triggers a hard reload to flush rate-limit state
        if (consecutiveErrors >= 2) {
            console.log(`\n=> 🔄 [TAB ${tabId}] 2 consecutive failures detected. Reloading Instagram origin page to reset soft-block state...`);
            try {
                await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
                await delay(4000);
            } catch (navErr) {
                console.log(`=> ❌ [TAB ${tabId}] Failed to reload origin page:`, navErr.message);
            }
            consecutiveErrors = 0; // Reset after recovery
        }

        let delayNum = Math.floor(Math.random() * 8000) + 10000;
        console.log(`  [TAB ${tabId}] Resting randomly for ${Math.round(delayNum / 1000)}s...`);
        await delay(delayNum);
    }
}

(async () => {
    console.log("==========================================");
    console.log("   🚀 GILGAMESH AUTO FOLLOW ENGINE 🚀 ");
    console.log("==========================================\n");

    let allList = new Set();
    if (fs.existsSync('id_list_gil.txt')) {
        fs.readFileSync('id_list_gil.txt', 'utf8').split('\n').forEach(line => {
            let id = cleanName(line);
            if(id) allList.add(id);
        });
    }

    let badFiles = ['ig_done_gil.txt']; 
    let excludeMap = new Map();
    
    for (let file of badFiles) {
        if (fs.existsSync(file)) {
            let count = 0;
            fs.readFileSync(file, 'utf8').split('\n').forEach(line => {
                let id = cleanName(line);
                if(id && !excludeMap.has(id)) { 
                    excludeMap.set(id, file); 
                    count++; 
                }
            });
            console.log(`  - Indexed blacklist file [${file}]: ${count} accounts loaded.`);
        }
    }

    let validSessionIds = [];
    let excludedLog = [];

    allList.forEach(id => {
        if (!excludeMap.has(id)) {
            validSessionIds.push(id);
        } else {
            excludedLog.push(`@${id} -> Excluded — found in file: ${excludeMap.get(id)}`);
        }
    });

    console.log(`\n=> ✅ DEDUPLICATION COMPLETE FOR [id_list_gil.txt]!`);
    console.log(`   + Clean IDs ready to process: ${validSessionIds.length} accounts`);

    if (validSessionIds.length === 0) {
        console.log("\n❌ Nothing to do! All IDs have been followed. Feed the pipeline with fresh data.");
        process.exit();
    }

    let sessionName = `session_follow_gilgamesh.txt`;
    fs.writeFileSync(sessionName, validSessionIds.join('\n'));
    fs.writeFileSync('session_excluded_report_gil.txt', excludedLog.join('\n'));
    
    console.log(`\n=> ✅ Spawning [1] automated worker...`);

    try {
        const browser = await puppeteer.connect({
            browserURL: 'http://127.0.0.1:9223',
            defaultViewport: null
        });

        await runWorker(1, browser, sessionName);
    } catch (err) {
        console.error("CHROME CONNECTION ERROR (browser may be closed or disconnected):", err);
    }
})();
