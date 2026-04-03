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

async function runWorker(tabId, browser) {
    const page = await browser.newPage();
    console.log(`\n=> [TAB ${tabId}]: Started!`);

    while (true) { 
        if (!fs.existsSync('ig_list.txt')) {
            await delay(5000);
            continue;
        }

        let rawList = fs.readFileSync('ig_list.txt', 'utf8');
        let allUsers = rawList.split('\n').map(u => cleanName(u)).filter(Boolean);

        let checkedSet = new Set();
        if (fs.existsSync('ig_checked.txt')) {
            fs.readFileSync('ig_checked.txt', 'utf8').split('\n').forEach(line => {
                let id = cleanName(line);
                if(id) checkedSet.add(id);
            });
        }
        
        let doneSet = new Set();
        if (fs.existsSync('ig_done.txt')) {
            fs.readFileSync('ig_done.txt', 'utf8').split('\n').forEach(line => {
                let id = cleanName(line);
                if(id) doneSet.add(id);
            });
        }

        let todoUsers = allUsers.filter(u => !checkedSet.has(u) && !doneSet.has(u) && !isProcessingSet.has(u));

        if (todoUsers.length === 0) {
            if (checkedCountGlobal % 5 === 0 && tabId === 1) { 
                console.log(`[⏳] Waiting for new IDs in ig_list.txt... (Checked: ${checkedSet.size} accounts)`);
            }
            checkedCountGlobal++;
            await delay(5000 + Math.random() * 2000);
            continue;
        }

        let username = todoUsers[0]; 
        
        isProcessingSet.add(username);
        
        console.log(`\n▶ [TAB ${tabId}] Analyzing profile: @${username}`);
        let url = `https://www.instagram.com/${username}/`;

        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
            
            let stats = await page.evaluate(async () => {
                const sleep = ms => new Promise(res => setTimeout(res, ms));
                let followersStr = '';
                let followingStr = '';

                // Text-scan strategy: reads raw innerText from header elements instead of relying on DOM structure
                // Meta frequently restructures the <ul><li> layout, making CSS selectors unreliable
                for (let i = 0; i < 15; i++) {
                    let elements = Array.from(document.querySelectorAll('header a, header li, header span, header div'));
                    for (let el of elements) {
                        let text = (el.innerText || el.textContent || '').toLowerCase().trim();
                        // Extract strings that contain a number alongside follower/following keyword (short strings only)
                        if ((text.includes('người theo dõi') || text.includes('followers')) && /\d/.test(text) && text.length < 50) {
                            followersStr = text;
                        }
                        if ((text.includes('đang theo dõi') || text.includes('following')) && /\d/.test(text) && text.length < 50) {
                            followingStr = text;
                        }
                    }
                    if (followersStr && followingStr) break;
                    await sleep(1000);
                }

                if (!followersStr || !followingStr) return null;
                
                const parseNum = (str) => {
                    let match = str.match(/[\d.,km]+/i);
                    if (!match) return 0;
                    let s = match[0].replace(/,/g, ''); 
                    if (str.toLowerCase().includes('k')) return parseFloat(s) * 1000;
                    if (str.toLowerCase().includes('m')) return parseFloat(s) * 1000000;
                    return parseInt(s, 10);
                };
                
                let followers = parseNum(followersStr);
                let following = parseNum(followingStr);
                
                return { followers, following };
            });

            let isPassed = true;
            let rejectReason = '';

            if (!stats) {
                isPassed = false;
                rejectReason = 'Could not retrieve stats (URL invalid or private account).';
            } else if (stats.followers < 10 || stats.following < 10) {
                isPassed = false;
                rejectReason = `Below minimum threshold (${stats.followers} followers, ${stats.following} following).`;
            } else if (stats.followers >= (stats.following * 10) && stats.following > 0) {
                isPassed = false;
                rejectReason = `Skewed ratio — likely a brand/influencer account (${stats.followers} followers / ${stats.following} following).`;
            }

            if (!isPassed) {
                console.log(`=> ⏩ [TAB ${tabId}] REJECTED @${username}: ${rejectReason}`);
                fs.appendFileSync('ig_checked.txt', username + '\n');
            } else {
                console.log(`=> ✅ [TAB ${tabId}] PASSED @${username} (${stats.followers} FL | ${stats.following} Following). Saved to ig_valid_list.txt`);
                fs.appendFileSync('ig_valid_list.txt', username + '\n');
                fs.appendFileSync('ig_checked.txt', username + '\n');
            }
        } catch (err) {
            console.log(`=> ❌ [TAB ${tabId}] TIMEOUT ERROR @${username}: Connection lost or rate limited.`);
            fs.appendFileSync('ig_checked.txt', username + '\n'); 
        }

        isProcessingSet.delete(username);

        let delayNum = Math.floor(Math.random() * 4000) + 3000;
        console.log(`  [TAB ${tabId}] Resting randomly for ${Math.round(delayNum / 1000)}s...`);
        await delay(delayNum);
    }
}

(async () => {
    console.log("==========================================");
    console.log("   🔬 ACCOUNT VALIDATOR (3.JS) 🔬  ");
    console.log("     [MULTI-TAB PARALLEL SUPPORT]    ");
    console.log("==========================================\n");
    
    rl.question('Enter number of parallel tabs (recommended: 1-5): ', async (tabs) => {
        rl.close();
        let numTabs = parseInt(tabs.trim()) || 1;
        if(numTabs <= 0) numTabs = 1;
        if(numTabs > 10) numTabs = 10;
        
        console.log(`\n=> ✅ Spawning [${numTabs}] validation workers...`);

        try {
            const browser = await puppeteer.connect({
                browserURL: 'http://127.0.0.1:9222',
                defaultViewport: null
            });

            let workers = [];
            for (let i = 1; i <= numTabs; i++) {
                workers.push(runWorker(i, browser));
                await delay(2000); 
            }

            await Promise.all(workers);

        } catch (err) {
            console.error("CHROME CONNECTION ERROR — browser may be closed or unreachable.", err);
        }
    });
})();
