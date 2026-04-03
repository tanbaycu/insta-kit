const puppeteer = require('puppeteer');
const fs = require('fs');
const readline = require('readline');

async function delay(time) {
    return new Promise(resolve => setTimeout(resolve, time));
}

let globalIgSet = new Set();
const loadSet = (filename) => {
    if (fs.existsSync(filename)) {
        fs.readFileSync(filename, 'utf8').split('\n').filter(Boolean).forEach(id => globalIgSet.add(id.trim()));
    }
}
loadSet('ig_list.txt');
loadSet('ig_valid_list.txt');
loadSet('ig_done.txt');

async function scrapeTab(browser, link, tabId) {
    let url = link.split('?')[0];
    const page = await browser.newPage();
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log(`\n[WORKER ${tabId}] 🟢 Video loaded successfully: ${url}`);
        
        await delay(5000); 

        let loopCount = 1;
        while (true) {
            const clickedAny = await page.evaluate(async () => {
                const sleep = ms => new Promise(res => setTimeout(res, ms));
                const els = Array.from(document.querySelectorAll('span, p, div, button')).filter(el => {
                    let txt = (el.textContent || "").toLowerCase().trim();
                    if (txt.length === 0 || txt.length > 50) return false;
                    if (txt.includes('ẩn') || txt.includes('hide')) return false; 
                    return (txt.includes('xem') && txt.includes('trả lời')) || 
                           (txt.includes('xem thêm') && /\d/.test(txt)) || 
                           (txt.includes('view') && txt.includes('rep')) ||
                           (txt.includes('view more'));
                });
                let c = 0;
                let clickedSet = new Set();
                for (let el of els) {
                    try { 
                        if (clickedSet.has(el.parentElement) || clickedSet.has(el)) continue;
                        if (el.offsetParent !== null) {
                            el.click(); 
                            c++;
                            clickedSet.add(el);
                            clickedSet.add(el.parentElement);
                            await sleep(1000); 
                        }
                    } catch(e) {}
                }
                return c > 0;
            });

            if (clickedAny) await delay(1800); 

            const newIGs = await page.evaluate(async () => {
                let foundIGsArray = [];
                const targetElements = Array.from(document.querySelectorAll(
                    'p[data-e2e^="comment-level"] span, p[data-e2e^="comment-level"], span[data-e2e^="comment-level"], span[dir="auto"]'
                )).filter(el => {
                    const className = (el.className || '').toLowerCase();
                    if (className.includes('username') || className.includes('author') || className.includes('name')) return false;
                    if (el.parentElement && (el.parentElement.className || '').toLowerCase().includes('username')) return false;
                    return true;
                });

                for (let textEl of targetElements) {
                    if (textEl.dataset.igChecked) continue;
                    const text = (textEl.textContent || "").trim();
                    if (text === '' || text.length > 200) continue; 
                    const systemWords = ['âm thanh', 'doanh', 'với tư cách', 'community', 'reply', 'đã trả lời', 'bản quyền'];
                    if (systemWords.some(w => text.toLowerCase().includes(w))) continue;

                    textEl.dataset.igChecked = "true";
                    let igUsername = null;

                    const regexRules = [
                        /(?:ig|instagram|insta|in-tư)\s*[:=\-]?\s*@?([A-Za-z0-9_.]+)/i,
                        /kb\s*ig\s*[a-z]*\s*@?([A-Za-z0-9_.]+)/i,
                        /follow\s*ig\s*([A-Za-z0-9_.]+)/i,
                        /chéo\s*ig\s*([A-Za-z0-9_.]+)/i,
                        /ib\s*ig\s*([A-Za-z0-9_.]+)/i,
                        /id\s*:\s*@?([A-Za-z0-9_.]+)/i
                    ];

                    const banList = ['done', 'nha', 'nhé', 'đây', 'tim', 'add', 'rep', 'chéo', 'flop', 'ib', 'hello', 'theo', 'dõi', 'ạ', 'aa', 'ig', 'id', 'kb', 'xin', 'tui', 'tới', 'lunn', 'hăm', 'các', 'mom', 'hết', 'nè', 'acc', 'phụ', 'rút', 'tym', 'tự', 'k', 'ko', 'khong', 'để', 'của', 'mình', 'là', 'thả', 'đi', 'tớ', 'chào', 'bạn', 'muốn', 'luôn', 'rồi', 'vậy', 'quá', 'đang', 'cùng', 'chống', 'nhiều', 'người', 'thích', 'như', 'vậy', 'kiểu', 'gì', 'thế', 'nào', 'cũng', 'được', 'ngta', 'trả', 'lời', 'thêm', 'câu', 'xem', 'view', 'replies', 'ngay', 'truoc', 'hours', 'minutes', 'seconds', 'ngày', 'giờ', 'phút', 'giây', 'trước', 'tiktok', 'shop', 'follow', 'nhau', 'link', 'nhắn', 'inb', 'chút', 'mai', 'tối', 'sáng', 'qua', 'nay', 'ai', 'cần', 'nhanh', 'này', 'cho', 'nhaaa'];

                    for (let regex of regexRules) {
                        let match = text.match(regex);
                        if (match && match[1]) {
                            let temp = match[1].trim().toLowerCase();
                            if (temp.length >= 4 && !banList.includes(temp)) {
                                igUsername = match[1].trim();
                                break;
                            }
                        }
                    }

                    if (!igUsername) {
                        let cleanText = text.replace(/[,()!]/g, ' ').replace(/\.$/, ''); 
                        const words = cleanText.split(/\s+/);
                        for (let word of words) {
                            if (/^[A-Za-z0-9_.]+$/.test(word) && (word.includes('_') || word.includes('.')) && word.length >= 4) {
                                let wLower = word.toLowerCase();
                                if (!banList.includes(wLower) && !wLower.startsWith('http') && !wLower.includes('.com')) {
                                    igUsername = word;
                                    break;
                                }
                            }
                        }
                        if (!igUsername && words.length <= 10) {
                            for (let word of words) {
                                if (/^[A-Za-z0-9]+$/.test(word) && word.length >= 5) { 
                                    if (!banList.includes(word.toLowerCase())) {
                                        igUsername = word;
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    if (igUsername) {
                        igUsername = igUsername.replace(/^@/, '').replace(/\.$/, '').replace(/_$/, '');
                        let uLower = igUsername.toLowerCase();
                        if (uLower.length < 4 || banList.includes(uLower) || uLower.startsWith('http') || uLower.includes('.com') || uLower.includes('.vn')) {
                            igUsername = null;
                        }
                    }

                    if (igUsername) {
                        let hasLiked = false;
                        // AUTO-LIKE COMMENT to attract attention to the account
                        try {
                            let curr = textEl;
                            let likeBtn = null;
                            // Walk up the DOM tree up to 10 levels
                            for (let k = 0; k < 10; k++) {
                                if (!curr) break;
                                // Locate the heart icon via TikTok's SVG path signature
                                let svgs = curr.querySelectorAll('svg');
                                for (let svg of svgs) {
                                    let path = svg.querySelector('path');
                                    if (path) {
                                        let d = path.getAttribute('d') || '';
                                        // TikTok heart SVG path identifier (starts with M24 12, curves to M24 34.91)
                                        if (d.startsWith('M24 12') || d.includes('25.06 38.07')) {
                                            likeBtn = svg;
                                            break;
                                        }
                                    }
                                }
                                if (likeBtn) break;
                                curr = curr.parentElement;
                            }
                            // Trigger the like action
                            if (likeBtn) {
                                // Actual clickable target is 1-2 levels outside the SVG
                                let targetClick = likeBtn.closest('div[role="button"], button') || likeBtn.parentElement;
                                if (targetClick) {
                                    targetClick.click();
                                    hasLiked = true;
                                }
                            }
                        } catch(e) {}

                        foundIGsArray.push({ username: igUsername, text: text, liked: hasLiked });
                    }
                }
                return foundIGsArray;
            });

            let appendedCount = 0;
            if (newIGs && newIGs.length > 0) {
                // Reload done list every loop to prevent duplicate writes across parallel tabs
                if (fs.existsSync('ig_done.txt')) {
                    fs.readFileSync('ig_done.txt', 'utf8').split('\n').filter(Boolean).forEach(id => globalIgSet.add(id.trim()));
                }

                for (let o of newIGs) {
                    let cleanIG = o.username.replace(/^@/, ''); 
                    if (!globalIgSet.has(cleanIG)) {
                        globalIgSet.add(cleanIG);
                        fs.appendFileSync('ig_list.txt', cleanIG + '\n'); 
                        let tymStatus = o.liked ? '❤️ LIKED' : '🖤 NO LIKE';
                        console.log(`[TAB ${tabId}] 💾 [Saved] [${tymStatus}] => ${cleanIG} (from: "${o.text.substring(0, 30)}")`);
                        appendedCount++;
                    }
                }
            }
            
            console.log(`[TAB ${tabId}] --- Scroll #${loopCount}: Expand replies [${clickedAny?'YES':'NO'}] | New IDs collected: ${appendedCount} (Global pool: ${globalIgSet.size})`);

            await page.evaluate((wasClicked) => {
                const scrollableDivs = Array.from(document.querySelectorAll('div')).filter(d => {
                    let style = window.getComputedStyle(d);
                    return (style.overflowY === 'auto' || style.overflowY === 'scroll') && d.scrollHeight > d.clientHeight;
                });
                let scrollContainer = window;
                if (scrollableDivs.length > 0) {
                    scrollContainer = scrollableDivs.find(d => d.querySelector('[data-e2e^="comment-level"]')) || scrollableDivs[scrollableDivs.length - 1];
                }
                let scrollStep = wasClicked ? 400 : 1400; 
                scrollContainer.scrollBy({ top: scrollStep, behavior: 'smooth' });
            }, clickedAny);
            
            loopCount++;
            await delay(1500); 
        }

    } catch (err) {
        console.error(`[TAB ${tabId}] ❌ FATAL TAB ERROR:`, err.message);
    }
}

(async () => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    
    rl.question('\n[INPUT] Enter TikTok Link #1: ', (link1) => {
        if(!link1 || link1.length < 5) {
            console.log("At least one link is required."); process.exit(1);
        }
        rl.question('[INPUT] Enter TikTok Link #2 (leave blank + press Enter to run single tab): ', async (link2) => {
            rl.close();
            console.log("\n🚀 Initializing parallel comment scraping...");
            
            try {
                const browser = await puppeteer.connect({
                    browserURL: 'http://127.0.0.1:9222',
                    defaultViewport: null,
                    protocolTimeout: 0 
                });
        
                console.log(`=> Loaded ${globalIgSet.size} IDs into dedup guard set.`);
                console.log(`=> Launching into comments...\n`);
                
                let tasks = [];
                tasks.push(scrapeTab(browser, link1, 1));
                
                if (link2 && link2.trim().length > 10) {
                    tasks.push(scrapeTab(browser, link2.trim(), 2));
                }
                
                // Fire both workers simultaneously
                await Promise.all(tasks);

            } catch(e) { console.error("Failed to connect to Chrome. Make sure start_chrome.bat is running.", e); }
        });
    });
})();
