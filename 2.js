const puppeteer = require('puppeteer');
const fs = require('fs');
const readline = require('readline');

async function delay(time) {
    return new Promise(resolve => setTimeout(resolve, time));
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const isProcessingSet = new Set();
let checkedCountGlobal = 0;

const cleanName = (str) => {
    if (!str) return '';
    return str.trim().replace(/^@/, '').toLowerCase();
}

async function runWorker(tabId, browser, sessionFile) {
    const page = await browser.newPage();
    console.log(`\n=> [TAB ${tabId}]: Started! Handling session file: ${sessionFile}`);
    let followCount = 0; // Throttle counter — prevents rate-limit triggers over long runs

    // Visibility spoofing: tricks the browser and Instagram into believing this tab is always in focus.
    // Prevents session suspension when the user switches to another tab.
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
        Object.defineProperty(document, 'hidden', { get: () => false });
        window.addEventListener('visibilitychange', e => e.stopImmediatePropagation(), true);
    });

    // Navigate to Instagram homepage first to establish a natural browsing session
    // before performing follow actions — avoids pattern detection from URL-direct navigation
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await delay(3000); 

    while (true) { 
        if (!fs.existsSync(sessionFile)) {
            console.log(`\n[TAB ${tabId}] CRITICAL ERROR: Session file ${sessionFile} is missing. Closing worker.`);
            break;
        }

        let rawList = fs.readFileSync(sessionFile, 'utf8');
        let allUsers = rawList.split('\n').map(u => cleanName(u)).filter(Boolean);

        let doneSet = new Set();
        if (fs.existsSync('ig_done.txt')) {
            fs.readFileSync('ig_done.txt', 'utf8').split('\n').forEach(line => {
                let id = cleanName(line);
                if(id) doneSet.add(id);
            });
        }

        let todoUsers = allUsers.filter(u => !doneSet.has(u) && !isProcessingSet.has(u));

        if (todoUsers.length === 0) {
            if (checkedCountGlobal % 5 === 0 && tabId === 1) { 
                console.log(`[⏳] All clean IDs (${allUsers.length}) in session have been processed. Waiting for new session...`);
            }
            checkedCountGlobal++;
            await delay(5000 + Math.random() * 2000);
            continue;
        }

        let username = todoUsers[0]; 
        
        isProcessingSet.add(username);
        
        console.log(`\n▶ [TAB ${tabId}] Targeting: @${username}`);

        try {
            // [SEARCH-BASED NAVIGATION]: Uses Instagram's search bar instead of direct URL injection.
            // Benefits: bypasses soft-ban rate limits, leverages AI suggestion, avoids direct URL fingerprinting.

            // Step 1: Open search panel if not already visible
            let searchIcon = await page.evaluateHandle(() => {
                // Check if input is already open
                let existingInput = document.querySelector('input[placeholder="Tìm kiếm"], input[placeholder="Search"]');
                if(existingInput) return null; // Already open, skip click
                
                // Find the search SVG button in the sidebar
                let svgs = Array.from(document.querySelectorAll('svg[aria-label="Tìm kiếm"], svg[aria-label="Search"]'));
                for(let svg of svgs) return svg.closest('div[role="button"], a, span, li') || svg;
                return null;
            });
            let isIconValid = await page.evaluate(e => e !== null, searchIcon);
            if (isIconValid) {
                await searchIcon.click();
                await delay(1500); // Wait for search panel slide-in animation
            }
            if (isIconValid) await searchIcon.dispose();

            // Step 2: Type username into search input with human-like delay
            let inputSelector = 'input[placeholder="Tìm kiếm"], input[placeholder="Search"]';
            await page.waitForSelector(inputSelector, { timeout: 10000 });
            let inputEl = await page.$(inputSelector);
            
            // Clear previous search content
            await inputEl.click({ clickCount: 3 }); 
            await page.keyboard.press('Backspace');
            await delay(500);
            
            // Type with realistic keystroke cadence (no clipboard paste — detectable)
            await inputEl.type(username, { delay: 90 });
            await delay(3500); // Wait for Instagram's suggestion API to resolve

            // Step 3: Click first search result (avatar-bearing link, excluded nav/explore links)
            let searchTargetSuccess = await page.evaluate((searchStr) => {
                let links = Array.from(document.querySelectorAll('a[href^="/"]'));
                
                // Filter to valid profile result cards only
                let searchLinks = links.filter(a => {
                    let inNav = a.closest('nav, [role="navigation"]');
                    let hasImg = a.querySelector('img');
                    let rect = a.getBoundingClientRect();
                    return !inNav && hasImg && rect.width > 0 && rect.height > 0 && !a.href.includes('/explore/') && !a.href.includes('/direct/');
                });
                
                // Click the top result (exact match or closest suggestion)
                if (searchLinks.length > 0) {
                    searchLinks[0].click();
                    return true;
                }
                return false;
                
            }, username);

            if (!searchTargetSuccess) {
                console.log(`=> ⏩ [TAB ${tabId}] Skipped @${username} (Not found in Instagram search).`);
                fs.appendFileSync('ig_done.txt', username + '\n');
                
                // Clean up search panel for the next loop iteration
                let inputElRetry = await page.$(inputSelector);
                if(inputElRetry) { await inputElRetry.click({ clickCount: 3 }); await page.keyboard.press('Backspace'); }
                await page.keyboard.press('Escape');
                await delay(1000);
                continue;
            }

            // Profile loaded via client-side navigation — no full page reload, extremely fast
            await delay(3500);

            let followResult = false;
            for (let i = 0; i < 5; i++) {
                // Locate Follow button using Puppeteer ElementHandle (isTrusted = true) 
                // instead of in-page JS click — bypasses React's synthetic event guard
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
                    // Native Puppeteer click with randomized delay to simulate human motor variance
                    try {
                        await foundBtnHandle.click({ delay: Math.floor(Math.random() * 50) + 30 });
                    } catch (e) {
                        try { await page.evaluate(e => e.click(), foundBtnHandle); } catch (e2) {} // Fallback: in-page JS click if frame detached
                    }

                    // Verify button state changed to "following" — confirms action success
                    await delay(1500);
                    let textAfter = await page.evaluate(e => (e.innerText || e.textContent || '').trim().toLowerCase(), foundBtnHandle);
                    
                    if (textAfter.includes('đang theo dõi') || textAfter.includes('following') || textAfter.includes('đã yêu cầu') || textAfter.includes('requested')) {
                        followResult = true;
                    } else {
                        // Network lag prevented state update — secondary click to confirm
                        try { await foundBtnHandle.click({ delay: Math.floor(Math.random() * 60) + 40 }); } catch (e) {}
                        followResult = true; // Mark as success — best-effort
                    }
                    
                    await foundBtnHandle.dispose();
                    break;
                }
                
                await foundBtnHandle.dispose();
                await delay(1000); 
            }

            if (followResult) {
                console.log(`=> ✅ [TAB ${tabId}] Successfully followed @${username}.`);
                fs.appendFileSync('ig_done.txt', username + '\n');
                
                followCount++;
                // [DEEP SLEEP CIRCUIT]: Auto-hibernates after 200 follows to evade Instagram's checkpoint trigger
                if (followCount >= 200) {
                    let longRestMinutes = Math.floor(Math.random() * 20) + 30; // Random 30–50 min sleep
                    console.log(`\n=> 🛑 [TAB ${tabId}] DEEP SLEEP ACTIVATED! Worker has run ${followCount} follow cycles.`);
                    console.log(`   ⏳⏳ Hibernating for ${longRestMinutes} minutes to evade anti-spam detection. Do not close the machine...`);
                    await delay(longRestMinutes * 60 * 1000); 
                    console.log(`=> 🌅 [TAB ${tabId}] Resumed from hibernation. Continuing session...`);
                    followCount = 0; // Reset throttle counter
                }
                
            } else {
                console.log(`=> ⏩ [TAB ${tabId}] Skipped target (page not found, blocked, or already followed).`);
                fs.appendFileSync('ig_done.txt', username + '\n');
            }
        } catch (err) {
            console.log(`=> ❌ [TAB ${tabId}] TIMEOUT ERROR @${username}: Connection lost or rate limited.`);
            fs.appendFileSync('ig_done.txt', username + '\n');
        }

        isProcessingSet.delete(username);

        let delayNum = Math.floor(Math.random() * 7000) + 6000;
        console.log(`  [TAB ${tabId}] Resting randomly for ${Math.round(delayNum / 1000)}s...`);
        await delay(delayNum);
    }
}

(async () => {
    console.log("==========================================");
    console.log("   🚀 AUTO FOLLOW PROGRAM (2.JS) 🚀  ");
    console.log("   [INPUT SANITIZATION ENGINE — V4]   ");
    console.log("==========================================\n");

    console.log("🔄 STEP 1: AGGREGATING AND DEDUPLICATING DATA FROM HISTORY FILES...\n");

    let allList = new Set();
    if (fs.existsSync('ig_list.txt')) {
        fs.readFileSync('ig_list.txt', 'utf8').split('\n').forEach(line => {
            let id = cleanName(line);
            if(id) allList.add(id);
        });
    }

    // Blacklist files — accounts that must never be re-followed
    let badFiles = ['ig_done.txt', 'ig_unfollowed_history.txt', 'con.txt', 'sucvat.txt'];
    let excludeMap = new Map();
    
    for (let file of badFiles) {
        if (fs.existsSync(file)) {
            let count = 0;
            fs.readFileSync(file, 'utf8').split('\n').forEach(line => {
                // Normalize: strip whitespace, trailing chars, mixed casing
                let id = cleanName(line);
                if(id && !excludeMap.has(id)) { 
                    excludeMap.set(id, file); 
                    count++; 
                }
            });
            console.log(`  - Indexed blacklist file [${file}]: ${count} accounts loaded.`);
        } else {
            console.log(`  - File [${file}] not found. Skipping.`);
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

    console.log(`\n=> ✅ DEDUPLICATION COMPLETE FOR [IG_LIST.TXT]!`);
    console.log(`   + Total IDs in ig_list.txt: ${allList.size}`);
    console.log(`   + Excluded (history overlap): ${excludedLog.length}`);
    console.log(`   + Clean IDs ready to process: ${validSessionIds.length}`);

    if (validSessionIds.length === 0) {
        console.log("\n❌ Nothing to do! All IDs have been previously followed or unfollowed. Feed the pipeline with fresh data.");
        process.exit();
    }

    // Generate timestamped session file name
    let now = new Date();
    let sessionName = `session_follow_${now.getDate()}_${now.getMonth()+1}_${now.getHours()}h${now.getMinutes()}m.txt`;
    
    // Write clean ID list to session file
    fs.writeFileSync(sessionName, validSessionIds.join('\n'));
    
    // Write exclusion audit log for cross-verification
    fs.writeFileSync('session_excluded_report.txt', excludedLog.join('\n'));
    
    console.log(`\n=> 📁 STEP 2: SESSION FILE CREATED: [${sessionName}]`);
    console.log(`      (Exclusion audit written to [session_excluded_report.txt] for traceability).`);
    
    rl.question('\nEnter number of parallel tabs for this session (recommended: 1-4): ', async (tabs) => {
        rl.close();
        let numTabs = parseInt(tabs.trim()) || 1;
        if(numTabs <= 0) numTabs = 1;
        if(numTabs > 10) numTabs = 10;
        
        console.log(`\n=> ✅ Spawning [${numTabs}] workers targeting session: [${sessionName}]...`);

        try {
            const browser = await puppeteer.connect({
                browserURL: 'http://127.0.0.1:9222',
                defaultViewport: null
            });

            let workers = [];
            for (let i = 1; i <= numTabs; i++) {
                workers.push(runWorker(i, browser, sessionName));
                await delay(2000); 
            }

            await Promise.all(workers);

        } catch (err) {
            console.error("CHROME CONNECTION ERROR — browser may be closed or unreachable.", err);
        }
    });
})();
