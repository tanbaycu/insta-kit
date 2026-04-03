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
    console.log(`\n=> [TAB ${tabId}]: Đã khởi động!`);

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
                console.log(`[⏳] Đang đợi ID mới từ ig_list.txt... (Đã kiểm tra: ${checkedSet.size} tài khoản).`);
            }
            checkedCountGlobal++;
            await delay(5000 + Math.random() * 2000);
            continue;
        }

        let username = todoUsers[0]; 
        
        isProcessingSet.add(username);
        
        console.log(`\n▶ [TAB ${tabId}] Đang phân tích Profile: @${username}`);
        let url = `https://www.instagram.com/${username}/`;

        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
            
            let stats = await page.evaluate(async () => {
                const sleep = ms => new Promise(res => setTimeout(res, ms));
                let followersStr = '';
                let followingStr = '';

                // Thuật toán xuyên giáp: Ép đọc Chữ Text "Người Theo Dõi" thay vì đợi bắt thẻ DOM ul li cũ đã bị Meta giả mạo
                for (let i = 0; i < 15; i++) {
                    let elements = Array.from(document.querySelectorAll('header a, header li, header span, header div'));
                    for (let el of elements) {
                        let text = (el.innerText || el.textContent || '').toLowerCase().trim();
                        // Trích xuất những chuỗi text CÓ CHỨA số kèm từ khóa (chiều dài dải ngắn để tránh đọc nhầm tiểu sử)
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
                rejectReason = 'Không lấy được thông số (URL sai hoặc Private).';
            } else if (stats.followers < 10 || stats.following < 10) {
                isPassed = false;
                rejectReason = `Không đủ tiêu chuẩn (${stats.followers} Followers, ${stats.following} Following).`;
            } else if (stats.followers >= (stats.following * 10) && stats.following > 0) {
                isPassed = false;
                rejectReason = `Tài khoản lệch tỷ lệ / Thương hiệu (${stats.followers} Followers và ${stats.following} Following).`;
            }

            if (!isPassed) {
                console.log(`=> ⏩ [TAB ${tabId}] LOẠI BỎ @${username}: ${rejectReason}`);
                fs.appendFileSync('ig_checked.txt', username + '\n');
            } else {
                console.log(`=> ✅ [TAB ${tabId}] ĐẠT YÊU CẦU @${username} (${stats.followers} FL | ${stats.following} Đang FL). Đã lưu vào ig_valid_list.txt`);
                fs.appendFileSync('ig_valid_list.txt', username + '\n');
                fs.appendFileSync('ig_checked.txt', username + '\n');
            }
        } catch (err) {
            console.log(`=> ❌ [TAB ${tabId}] LỖI TIMEOUT @${username}: Mất kết nối hoặc giới hạn mạng.`);
            fs.appendFileSync('ig_checked.txt', username + '\n'); 
        }

        isProcessingSet.delete(username);

        let delayNum = Math.floor(Math.random() * 4000) + 3000;
        console.log(`  [TAB ${tabId}] Nghỉ ngẫu nhiên ${Math.round(delayNum / 1000)}s...`);
        await delay(delayNum);
    }
}

(async () => {
    console.log("==========================================");
    console.log("   🔬 CHƯƠNG TRÌNH LỌC TÀI KHOẢN (3.JS) 🔬  ");
    console.log("     [HỖ TRỢ CHẠY NHIỀU TAB SONG SONG]    ");
    console.log("==========================================\n");
    
    rl.question('Nhập số lượng Tab chạy song song (Khuyên dùng 1-5): ', async (tabs) => {
        rl.close();
        let numTabs = parseInt(tabs.trim()) || 1;
        if(numTabs <= 0) numTabs = 1;
        if(numTabs > 10) numTabs = 10;
        
        console.log(`\n=> ✅ Bắt đầu khởi tạo [${numTabs}] Tab...`);

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
            console.error("LỖI KẾT NỐI CHROME DO ĐÓNG TRÌNH DUYỆT HOẶC MẤT MẠNG", err);
        }
    });
})();
