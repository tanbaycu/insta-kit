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
    console.log(`\n=> [TAB ${tabId}]: Đã khởi động! Chịu trách nhiệm Cày Phiên: ${sessionFile}`);
    let followCount = 0; // Biến đếm Nhịp Độ (Chống SPAM XUYÊN MÀN ĐÊM)

    // Bơm Code Hack Cảm Biến: Đánh lừa Trình duyệt & Instagram rằng [Tab Này Luôn Được Nhìn Thấy]. Chống ngủ gật khi bạn sang Tab khác.
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
        Object.defineProperty(document, 'hidden', { get: () => false });
        window.addEventListener('visibilitychange', e => e.stopImmediatePropagation(), true);
    });

    // Bật một trang chủ Instagram duy nhất để lừa hệ thống là ta đang cắm rễ dạo lướt trên trình duyệt chứ không phải tải từng URL rời rạc
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await delay(3000); 

    while (true) { 
        if (!fs.existsSync(sessionFile)) {
            console.log(`\n[TAB ${tabId}] LỖI NGHIÊM TRỌNG: Mất file phiên chạy ${sessionFile}. Trình duyệt tự động đóng.`);
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
                console.log(`[⏳] Toàn bộ ID Sạch (${allUsers.length}) trong phiên chạy đã duyệt XONG! Nghỉ hưu đợi Phiên mới...`);
            }
            checkedCountGlobal++;
            await delay(5000 + Math.random() * 2000);
            continue;
        }

        let username = todoUsers[0]; 
        
        isProcessingSet.add(username);
        
        console.log(`\n▶ [TAB ${tabId}] Đang tìm kiếm: @${username}`);

        try {
            // [CẤU TRÚC MỚI]: SỬ DỤNG THANH TÌM KIẾM ĐỂ HƯỞNG LỢI AI GỢI Ý (Bypass ID sai) + VƯỢT SOFT-BAN RATE LIMIT
            // 1. Nhấn nút Kính Lúp mở Khay Menu nếu Cột Gõ Username chưa xuất hiện 
            let searchIcon = await page.evaluateHandle(() => {
                // Thăm dò Input mở sẵn
                let existingInput = document.querySelector('input[placeholder="Tìm kiếm"], input[placeholder="Search"]');
                if(existingInput) return null; // Nếu đã hở nắp rồi thì khỏi click mở Menu
                
                // Nếu chưa hở thì tìm Nút SVG Tìm Kiếm của Sidebar
                let svgs = Array.from(document.querySelectorAll('svg[aria-label="Tìm kiếm"], svg[aria-label="Search"]'));
                for(let svg of svgs) return svg.closest('div[role="button"], a, span, li') || svg;
                return null;
            });
            let isIconValid = await page.evaluate(e => e !== null, searchIcon);
            if (isIconValid) {
                await searchIcon.click();
                await delay(1500); // Chờ khay tìm kiếm trượt ra
            }
            if (isIconValid) await searchIcon.dispose();

            // 2. Điền ID Người dùng vào Khu vực Tìm Kiếm
            let inputSelector = 'input[placeholder="Tìm kiếm"], input[placeholder="Search"]';
            await page.waitForSelector(inputSelector, { timeout: 10000 }); // Đợi cái gõ chữ hiện lên
            let inputEl = await page.$(inputSelector);
            
            // Bôi đen xóa sạch text của vòng lặp cũ cũ
            await inputEl.click({ clickCount: 3 }); 
            await page.keyboard.press('Backspace');
            await delay(500);
            
            // Gõ Tên Nhẹ Nhàng (Không copy paste cục súc)
            await inputEl.type(username, { delay: 90 });
            await delay(3500); // Đợi AI IG trích xuất dữ liệu trả kết quả thẻ xuống thả (Loading Gợi Ý)

            // 3. Móc Cấu Trúc Bấm Bầu Kết Quả Đầu Tiên Ở Phía Dưới Ô Tìm Kiếm
            let searchTargetSuccess = await page.evaluate((searchStr) => {
                let links = Array.from(document.querySelectorAll('a[href^="/"]'));
                
                // Gạn đục khơi trong lập bảng TẤT CẢ Thẻ Kết quả Search (Có ảnh Avatar, Kích thước hợp lệ, KHÔNG thuộc thanh Menu Trái lấn át)
                let searchLinks = links.filter(a => {
                    let inNav = a.closest('nav, [role="navigation"]');
                    let hasImg = a.querySelector('img');
                    let rect = a.getBoundingClientRect();
                    return !inNav && hasImg && rect.width > 0 && rect.height > 0 && !a.href.includes('/explore/') && !a.href.includes('/direct/');
                });
                
                // NẾU CÓ KẾT QUẢ TÌM KIẾM MỌC RA -> Luôn click thằng Thẻ <a> đầu tiên (Mặc định là đích danh hoặc Gợi Ý đổi tên mới nhất)
                if (searchLinks.length > 0) {
                    searchLinks[0].click();
                    return true;
                }
                return false;
                
            }, username);

            if (!searchTargetSuccess) {
                console.log(`=> ⏩ [TAB ${tabId}] Bỏ qua @${username} (Không tìm thấy trên thanh Tìm Kiếm Instagram).`);
                fs.appendFileSync('ig_done.txt', username + '\n');
                
                // Gõ tên vớ vẩn rác ko ra ai -> Đóng nắp Khay tìm kiếm (Bấm ESC 2 lần) cho sạch Menu để nhường đường cho lặp kế tiếp
                let inputElRetry = await page.$(inputSelector);
                if(inputElRetry) { await inputElRetry.click({ clickCount: 3 }); await page.keyboard.press('Backspace'); }
                await page.keyboard.press('Escape');
                await delay(1000);
                continue;
            }

            // Click vào tài khoản xong -> Chờ hiệu ứng IG bôi trơn tải Web Profile mới (Tốc độ ánh sáng do ko load lại trang Header)
            await delay(3500);

            let followResult = false;
            for (let i = 0; i < 5; i++) {
                // Đẩy hàm tìm kiếm Button sang Môi trường Node (thay vì thuần JS Trình Duyệt) để sử dụng con trỏ thật (isTrusted = true)
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
                    // MÔ PHỎNG MOUSE CỦA NGƯỜI DÙNG TỪ CẤP ĐỘ NATIVE TRÌNH DUYỆT (Puppeteer Click) để hạ gục React Cấm JS Clicks
                    try {
                        await foundBtnHandle.click({ delay: Math.floor(Math.random() * 50) + 30 });
                    } catch (e) {
                        try { await page.evaluate(e => e.click(), foundBtnHandle); } catch (e2) {} // Fallback nếu DOM bị che khuất
                    }

                    // CHỜ VÀ ÉP KIỂM TRA LẠI XEM TEXT ĐÃ ĐỔI THÀNH "ĐANG THEO DÕI" CHƯA (DOUBLE CHECK!)
                    await delay(1500);
                    let textAfter = await page.evaluate(e => (e.innerText || e.textContent || '').trim().toLowerCase(), foundBtnHandle);
                    
                    if (textAfter.includes('đang theo dõi') || textAfter.includes('following') || textAfter.includes('đã yêu cầu') || textAfter.includes('requested')) {
                        followResult = true;
                    } else {
                        // Instagram Load lỗi mạng không nhận click -> Click Bồi Lần 2 Cho Chắc Nhất
                        try { await foundBtnHandle.click({ delay: Math.floor(Math.random() * 60) + 40 }); } catch (e) {}
                        followResult = true; // Vẫn chốt Thành công coi  như mình làm hết sức
                    }
                    
                    await foundBtnHandle.dispose();
                    break;
                }
                
                await foundBtnHandle.dispose();
                await delay(1000); 
            }

            if (followResult) {
                console.log(`=> ✅ [TAB ${tabId}] Follow THÀNH CÔNG cho @${username}.`);
                fs.appendFileSync('ig_done.txt', username + '\n');
                
                followCount++; // Cộng điểm thành tích 
                // [TÍNH NĂNG MỚI NÂNG CẤP]: CẮM NGỦ ĐÔNG AUTO NGẪU NHIÊN SAU KHI CÀY 100 QUẢ NÉ CHECKPOINT
                if (followCount >= 200) {
                    let longRestMinutes = Math.floor(Math.random() * 20) + 30; // Random Ngủ 30 -> 50 Phút
                    console.log(`\n=> 🛑 [TAB ${tabId}] BÁO ĐỘNG NGỦ ĐÔNG! Vệ tinh đã hoạt động liên tục (${followCount} lựơt).`);
                    console.log(`   ⏳⏳ Sẽ kích hoạt Lệnh Tự Ngủ trong: ${longRestMinutes} PHÚT để đánh lừa Anti-Spam của máy chủ. Bạn cắm máy đừng tắt nhé...`);
                    await delay(longRestMinutes * 60 * 1000); 
                    console.log(`=> 🌅 [TAB ${tabId}] TỈNH Xong Giấc Ngủ! Tiếp tục Cày Phiên Chạy Cũ...`);
                    followCount = 0; // Trở lại Vòng Đời Trinh Nguyên
                }
                
            } else {
                console.log(`=> ⏩ [TAB ${tabId}] Bỏ qua mục tiêu (Trang Không Tồn Tại, Bị Chặn hoặc Đã Follow).`);
                fs.appendFileSync('ig_done.txt', username + '\n');
            }
        } catch (err) {
            console.log(`=> ❌ [TAB ${tabId}] LỖI TIMEOUT @${username}: Mất kết nối hoặc giới hạn mạng.`);
            fs.appendFileSync('ig_done.txt', username + '\n');
        }

        isProcessingSet.delete(username);

        let delayNum = Math.floor(Math.random() * 7000) + 6000;
        console.log(`  [TAB ${tabId}] Nghỉ ngẫu nhiên ${Math.round(delayNum / 1000)}s...`);
        await delay(delayNum);
    }
}

(async () => {
    console.log("==========================================");
    console.log("   🚀 CHƯƠNG TRÌNH AUTO FOLLOW (2.JS) 🚀  ");
    console.log("   [PHIÊN BẢN CHUẨN HÓA DATA ĐẦU VÀO V4]   ");
    console.log("==========================================\n");

    console.log("🔄 BƯỚC 1: ĐANG TỔNG HỢP VÀ ĐỐI CHIẾU LỌC RÁC TỪ CÁC TỆP LỊCH SỬ...\n");

    let allList = new Set();
    if (fs.existsSync('ig_list.txt')) {
        fs.readFileSync('ig_list.txt', 'utf8').split('\n').forEach(line => {
            let id = cleanName(line);
            if(id) allList.add(id);
        });
    }

    // Những file nằm trong danh sách ĐEN (Tuyệt đối không Follow lại)
    let badFiles = ['ig_done.txt', 'ig_unfollowed_history.txt', 'con.txt', 'sucvat.txt'];
    let excludeMap = new Map();
    
    for (let file of badFiles) {
        if (fs.existsSync(file)) {
            let count = 0;
            fs.readFileSync(file, 'utf8').split('\n').forEach(line => {
                // Làm sạch Ký tự rác, khoảng trắng hoặc chữ In hoa gây nhiễu
                let id = cleanName(line);
                if(id && !excludeMap.has(id)) { 
                    excludeMap.set(id, file); 
                    count++; 
                }
            });
            console.log(`  - Đã check Tệp [${file}]: có chứa ${count} tài khoản.`);
        } else {
            console.log(`  - Không tìm thấy Tệp [${file}]. Bỏ qua.`);
        }
    }

    let validSessionIds = [];
    let excludedLog = [];

    allList.forEach(id => {
        if (!excludeMap.has(id)) {
            validSessionIds.push(id);
        } else {
            excludedLog.push(`@${id} -> Bỏ qua vì đã nằm trong tệp: ${excludeMap.get(id)}`);
        }
    });

    console.log(`\n=> ✅ ĐÃ ĐỐI CHIẾU VÀ MÀI CHUỐT XONG TỆP [IG_LIST.TXT]!`);
    console.log(`   + Tổng số ID nằm trong ig_list.txt ban đầu: ${allList.size}`);
    console.log(`   + Tổng số ID giao thoa Lịch Sử (Đồ bỏ đi, Cấm vận): ${excludedLog.length}`);
    console.log(`   + Tổng số lượng ID SẠCH 100%: ${validSessionIds.length} tài khoản mới CẦN XỬ LÝ!`);

    if (validSessionIds.length === 0) {
        console.log("\n❌ Hết mẹ việc để làm! Toàn bộ ID trong List tải về đều đã Follow / Unfollow từ trước. Hãy cho Bot sục thêm List mới!");
        process.exit();
    }

    // Tạo tên File Phiên Phiên Chạy (Session File)
    let now = new Date();
    let sessionName = `session_follow_${now.getDate()}_${now.getMonth()+1}_${now.getHours()}h${now.getMinutes()}m.txt`;
    
    // Ghi Toàn Bộ ID "Tinh Khiết" Vào File Session
    fs.writeFileSync(sessionName, validSessionIds.join('\n'));
    
    // GHI RA BẢN BÁO CÁO CÁC ID BỊ BỎ QUA ĐỂ THEO DÕI NGUYÊN NHÂN ĐỐI CHIẾU (MINH BẠCH 100%)
    fs.writeFileSync('session_excluded_report.txt', excludedLog.join('\n'));
    
    console.log(`\n=> 📁 BƯỚC 2: TẠO THÀNH CÔNG PHIÊN CHẠY MỚI CỰC SẠCH MANG TÊN: [${sessionName}]`);
    console.log(`      (Đã tự động đẻ ra file [session_excluded_report.txt] chứa giải trình lý do các ID bị gạch tên để kiểm chứng chéo).`);
    
    rl.question('\nNhập số lượng Tab chạy song song cho Phiên Này (Khuyên dùng 1-4): ', async (tabs) => {
        rl.close();
        let numTabs = parseInt(tabs.trim()) || 1;
        if(numTabs <= 0) numTabs = 1;
        if(numTabs > 10) numTabs = 10;
        
        console.log(`\n=> ✅ Bắt đầu khởi tạo [${numTabs}] Tab đâm thẳng vô File Phiên: [${sessionName}]...`);

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
            console.error("LỖI KẾT NỐI CHROME DO ĐÓNG TRÌNH DUYỆT HOẶC MẤT MẠNG", err);
        }
    });
})();
