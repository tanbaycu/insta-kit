const puppeteer = require('puppeteer');
const fs = require('fs');
const readline = require('readline');

async function delay(time) {
    return new Promise(function(resolve) { setTimeout(resolve, time) });
}

// Load a file into a Set — returns empty Set if file does not exist
function loadSet(filename) {
    if (fs.existsSync(filename)) {
        return new Set(fs.readFileSync(filename, 'utf8').split('\n').map(u => u.trim()).filter(Boolean));
    }
    return new Set();
}

function appendList(filename, item) {
    fs.appendFileSync(filename, item + '\n');
}

// ---------------------------------------------------------------
// Search-modal scanner: checks whether each username in rawList
// appears inside the specified Instagram modal (followers/following)
// ---------------------------------------------------------------
async function checkListViaSearch(page, myUsername, rawList, routeSuffix, modalName, checkedFile, foundFile, notFoundFile) {
    let checkedSet = loadSet(checkedFile);
    let userList = rawList.filter(u => !checkedSet.has(u));
    let total = userList.length;

    if (total === 0) {
        console.log(`\n🎉 All entries in the [${modalName}] gate have been processed previously!`);
        return;
    }

    console.log(`\n⏳ Opening [${modalName}] modal... ${total} accounts pending verification.`);
    
    // Always start from the profile root before opening a modal
    await page.goto(`https://www.instagram.com/${myUsername}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(4000); 

    // Click the followers/following count link to open modal
    let btnClicked = await page.evaluate((suffix) => {
        let links = Array.from(document.querySelectorAll(`a[href$="/${suffix}/"]`));
        if (links.length > 0) {
            links[0].click();
            return true;
        }
        let allLinks = Array.from(document.querySelectorAll('a, header ul li'));
        let target = allLinks.find(a => (a.href || '').includes(`/${suffix}/`));
        if (target) {
            target.click();
            return true;
        }
        return false;
    }, routeSuffix);

    if (!btnClicked) {
        console.log(`❌ Error: Could not click the [${modalName}] button on profile page. Retrying next cycle...`);
        return;
    }
    
    await delay(4000); 

    for (let i = 0; i < total; i++) {
        let u = userList[i].trim();
        if (!u) continue;

        await page.evaluate((textToType) => {
            let ipt = document.querySelector('div[role="dialog"] input');
            if (ipt) {
                let nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                nativeInputValueSetter.call(ipt, textToType);
                ipt.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, u);

        await delay(4000);

        let isFound = await page.evaluate((searchUsername) => {
            let links = Array.from(document.querySelectorAll('div[role="dialog"] div.x1n2onr6 a[role="link"]'));
            for(let a of links) {
                let href = a.getAttribute('href').replace(/\//g, '');
                if (href.toLowerCase() === searchUsername.toLowerCase()) return true;
            }
            return false;
        }, u);

        if (isFound) {
            appendList(foundFile, u);
        } else {
            appendList(notFoundFile, u);
        }
        appendList(checkedFile, u);
        
        console.log(`[${modalName}] - [${i+1}/${total}]: Scanning @${u} -> ${isFound ? '🟢 FOUND (saved to found file)' : '🔴 NOT FOUND (saved to not-found file)'}`);
        
        await delay(500); 
    }
    console.log(`\n=> [${modalName}]: Full scan complete!`);

    await page.evaluate(() => {
        let closeBtn = document.querySelector('div[role="dialog"] svg[aria-label="Đóng"], div[role="dialog"] svg[aria-label="Close"]');
        if (closeBtn) {
            let cb = closeBtn.closest('button, [role="button"]');
            if (cb) cb.click();
        }
    });

    await delay(1500);
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

(async () => {
    console.log("==========================================");
    console.log("    🔪 UNFOLLOW PRUNER (6.JS) 🔪    ");
    console.log("    [DUAL-CHECKPOINT INSPECTION MODE]    ");
    console.log("==========================================\n");
    console.log("PROTECTION GUIDE — Two modes available to prevent unfollowing friends:");
    console.log("[1]. INVESTIGATE (No unfollows): Scans ig_done.txt, identifies non-reciprocal accounts, writes them to 'sucvat.txt'. You can manually edit sucvat.txt to protect specific accounts before executing.");
    console.log("[2]. EXECUTE: Unfollows all accounts listed in 'sucvat.txt' with no exceptions.\n");

    rl.question('Enter your choice (1 or 2): ', async (choice) => {
        rl.close();
        let mode = choice.trim();

        const CORE_USERNAME = "tanbaycu"; // Primary account handle
        
        let targetUsers = [];
        
        if (mode === '1') {
            console.log("\n=> ✅ MODE 1 SELECTED: INVESTIGATION (writes to sucvat.txt only)");
            if (!fs.existsSync('ig_done.txt')) {
                console.log("❌ ERROR: ig_done.txt not found. No follow history exists yet.");
                process.exit(1);
            }
            let rawDoneList = fs.readFileSync('ig_done.txt', 'utf8').split('\n').filter(Boolean).map(u => u.trim());
            targetUsers = Array.from(new Set(rawDoneList));
            console.log(`📦 Loaded ${targetUsers.length} accounts into the inspection queue.`);
        } else if (mode === '2') {
            console.log("\n=> ✅ MODE 2 SELECTED: EXECUTE UNFOLLOW (processes sucvat.txt)");
            if (!fs.existsSync('sucvat.txt')) {
                console.log("❌ ERROR: sucvat.txt not found. Run Mode 1 first to generate the target list.");
                process.exit(1);
            }
            targetUsers = Array.from(loadSet('sucvat.txt'));
            if(targetUsers.length === 0){
                 console.log("❌ sucvat.txt is empty — no targets to process.");
                 process.exit(1);
            }
            console.log(`📦 Confirmed unfollow targets: ${targetUsers.length} accounts.`);
        } else {
            console.log("❌ Invalid input. Only '1' or '2' are accepted.");
            process.exit(1);
        }

        try {
            console.log(`\n🚀 Connecting to browser...`);
            const browser = await puppeteer.connect({
                browserURL: 'http://127.0.0.1:9222',
                defaultViewport: null
            });
            const page = await browser.newPage();
            
            if (mode === '1') {
                // ==========================================
                // PHASE 1+2: CROSS-REFERENCE INSPECTION
                // ==========================================
                console.log("\n================[ STEP 1: VERIFY 'FOLLOWING' LIST ]================");
                await checkListViaSearch(
                    page, CORE_USERNAME, targetUsers, 'following', 'FOLLOWING',
                    '6_v1_checked.txt', '6_v1_co.txt', '6_v1_khong.txt'
                );
                
                let actuallyFollowing = Array.from(loadSet('6_v1_co.txt'));
                if (actuallyFollowing.length === 0) {
                    console.log("\n🎉 Step 1 complete: No mutually-followed accounts found in scope.");
                    process.exit(0);
                }

                console.log("\n================[ STEP 2: VERIFY 'FOLLOWERS' LIST ]================");
                await checkListViaSearch(
                    page, CORE_USERNAME, actuallyFollowing, 'followers', 'FOLLOWERS',
                    '6_v2_checked.txt', 'con.txt', 'sucvat.txt'
                );
                
                let traitorsCount = loadSet('sucvat.txt').size;
                console.log(`\n🎉 INVESTIGATION COMPLETE! Found [${traitorsCount}] non-reciprocal accounts.`);
                console.log("🚨 IMPORTANT 🚨:");
                console.log("1. Accounts that followed back => saved in 'con.txt'.");
                console.log("2. Non-reciprocal accounts => saved in 'sucvat.txt'.");
                console.log("👉 Open 'sucvat.txt' and manually remove any friends/important accounts before proceeding.");
                console.log("👉 When ready, run 'node 6.js' and enter [2] to execute the unfollow.");
                process.exit(0);

            } else if (mode === '2') {
                // ==========================================
                // PHASE 3: EXECUTE UNFOLLOW
                // ==========================================
                console.log("\n================[ EXECUTING UNFOLLOW — 'SUCVAT.TXT' ]================");
                let historySet = loadSet('ig_unfollowed_history.txt');
                let toKill = targetUsers.filter(u => !historySet.has(u));

                if (toKill.length === 0) {
                    console.log("\n🎉 All targets in this list have already been unfollowed previously.");
                    process.exit(0);
                }

                console.log("Pacing at 15–25s intervals between each unfollow to avoid rate-limit blocks...\n");

                for (let i = 0; i < toKill.length; i++) {
                    let target = toKill[i];
                    console.log(`[${i+1}/${toKill.length}] 🎯 Navigating to: @${target}`);
                    
                    try {
                        await page.goto(`https://www.instagram.com/${target}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
                        await delay(3500);

                        let unfollowClicked = await page.evaluate(async () => {
                            const sleep = ms => new Promise(res => setTimeout(res, ms));
                            let buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
                            let btnFollowing = buttons.find(btn => {
                                let text = btn.innerText ? btn.innerText.trim().toLowerCase() : '';
                                return text === 'đang theo dõi' || text === 'following';
                            });

                            if (btnFollowing) {
                                btnFollowing.click();
                                await sleep(1500);

                                let confirmBtns = Array.from(document.querySelectorAll('button, div[role="button"] span'));
                                let btnConfirm = confirmBtns.find(btn => {
                                    let txt = btn.textContent.trim().toLowerCase();
                                    return txt === 'bỏ theo dõi' || txt === 'unfollow';
                                });

                                if (btnConfirm) {
                                    let clickTarget = btnConfirm.closest('button, [role="button"]') || btnConfirm;
                                    clickTarget.click();
                                    return true;
                                }
                            }
                            return false;
                        });

                        if (unfollowClicked) {
                            console.log(`  => ✅ Successfully unfollowed. Logged to history.`);
                            appendList('ig_unfollowed_history.txt', target);
                        } else {
                            console.log(`  => ⏩ Skipped. Instagram blocked the action or account was already unfollowed manually.`);
                            appendList('ig_unfollowed_history.txt', target); 
                        }
                    } catch (e) {
                        console.log(`  => ❌ Page error — account may be deleted or restricted.`);
                    }

                    let delayNum = Math.floor(Math.random() * 8000) + 12000;
                    console.log(`  (Cooling down for ${Math.round(delayNum/1000)}s to evade block detection...)\n`);
                    await delay(delayNum);
                }

                console.log("🏁 UNFOLLOW EXECUTION COMPLETE!");
                process.exit(0);
            }
        } catch (err) {
            console.error("FATAL ERROR — network or Chrome connection failure:", err);
            process.exit(1);
        }
    });

})();
