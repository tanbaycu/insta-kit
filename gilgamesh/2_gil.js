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
            let searchIcon = await page.evaluateHandle(() => {
                let existingInput = document.querySelector('input[placeholder="Tìm kiếm"], input[placeholder="Search"]');
                if(existingInput) return null; 
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
            
            await inputEl.click({ clickCount: 3 }); 
            await page.keyboard.press('Backspace');
            await delay(500);
            
            await inputEl.type(username, { delay: 90 });
            await delay(3500); 

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
                        try {
                            await foundBtnHandle.click({ delay: Math.floor(Math.random() * 50) + 30 });
                        } catch (e) {
                            try { await page.evaluate(e => e.click(), foundBtnHandle); } catch (e2) {}
                        }

                        await delay(1500);
                        let textAfter = await page.evaluate(e => (e.innerText || e.textContent || '').trim().toLowerCase(), foundBtnHandle);
                        
                        if (textAfter.includes('đang theo dõi') || textAfter.includes('following') || textAfter.includes('đã yêu cầu') || textAfter.includes('requested')) {
                            followResult = true;
                        } else {
                            try { await foundBtnHandle.click({ delay: Math.floor(Math.random() * 60) + 40 }); } catch (e) {}
                            followResult = true; 
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
                    consecutiveErrors = 0; 
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

        if (consecutiveErrors >= 2) {
            console.log(`\n=> 🔄 [TAB ${tabId}] Failed 2 times in a row. Reloading the Instagram origin page to prevent loop blocks...`);
            try {
                await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
                await delay(4000);
            } catch (navErr) {
                console.log(`=> ❌ [TAB ${tabId}] Error while reloading the origin page:`, navErr.message);
            }
            consecutiveErrors = 0; 
        }

        let delayNum = Math.floor(Math.random() * 8000) + 10000;
        console.log(`  [TAB ${tabId}] Resting randomly for ${Math.round(delayNum / 1000)}s...`);
        await delay(delayNum);
    }
}

(async () => {
    console.log("==========================================");
    console.log("   🚀 GILGAMESH AUTO FOLLOW PROGRAM 🚀 ");
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
            console.log(`  - Checked File [${file}]: contains ${count} accounts.`);
        }
    }

    let validSessionIds = [];
    let excludedLog = [];

    allList.forEach(id => {
        if (!excludeMap.has(id)) {
            validSessionIds.push(id);
        } else {
            excludedLog.push(`@${id} -> Skipped due to existing in file: ${excludeMap.get(id)}`);
        }
    });

    console.log(`\n=> ✅ COMPLETED PARSING AND CLEANING UP [id_list_gil.txt]!`);
    console.log(`   + Total new IDs NEEDING PROCESSING: ${validSessionIds.length} accounts`);

    if (validSessionIds.length === 0) {
        console.log("\n❌ Out of work! All IDs have been followed.");
        process.exit();
    }

    let sessionName = `session_follow_gilgamesh.txt`;
    fs.writeFileSync(sessionName, validSessionIds.join('\n'));
    fs.writeFileSync('session_excluded_report_gil.txt', excludedLog.join('\n'));
    
    console.log(`\n=> ✅ Initializing [1] automated tab...`);

    try {
        const browser = await puppeteer.connect({
            browserURL: 'http://127.0.0.1:9223',
            defaultViewport: null
        });

        await runWorker(1, browser, sessionName);
    } catch (err) {
        console.error("CHROME CONNECTION ERROR (Browser might be closed or disconnected):", err);
    }
})();
