const puppeteer = require('puppeteer');
const fs = require('fs');
const readline = require('readline');

async function delay(time) {
    return new Promise(function(resolve) { setTimeout(resolve, time) });
}

// Đọc danh sách an toàn
function loadSet(filename) {
    if (fs.existsSync(filename)) {
        return new Set(fs.readFileSync(filename, 'utf8').split('\n').map(u => u.trim()).filter(Boolean));
    }
    return new Set();
}

function appendList(filename, item) {
    fs.appendFileSync(filename, item + '\n');
}

// -------------------------------------------------------------
// Hàm dùng ô Tìm Kiếm để soi 1 danh sách Username trong 1 Modal
// -------------------------------------------------------------
async function checkListViaSearch(page, myUsername, rawList, routeSuffix, modalName, checkedFile, foundFile, notFoundFile) {
    let checkedSet = loadSet(checkedFile);
    let userList = rawList.filter(u => !checkedSet.has(u));
    let total = userList.length;

    if (total === 0) {
        console.log(`\n🎉 Tất cả danh sách nhiệm vụ của Cổng ${modalName} đã được duyệt xong từ trước!`);
        return;
    }

    console.log(`\n⏳ Mở cổng ${modalName}... Còn ${total} đối tượng chưa kiểm duyệt!`);
    
    // Luôn bắt đầu từ tổng hành dinh gốc
    await page.goto(`https://www.instagram.com/${myUsername}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(4000); 

    // Bấm nút Gọi Bảng trực tiếp
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
        console.log(`❌ Lỗi: Không thể móc nút ${modalName} trên tường nhà. Đang thử lại tiến trình...`);
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
        
        console.log(`[${modalName}] - [${i+1}/${total}]: Dò tìm @${u} -> ${isFound ? '🟢 CÓ (Lưu file CÓ)' : '🔴 KHÔNG (Lưu file KHÔNG)'}`);
        
        await delay(500); 
    }
    console.log(`\n=> Cổng ${modalName}: Đã quét xong Toàn Bộ!`);

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
    console.log("    🔪 BOT SÁT THỦ UNFOLLOW (6.JS) 🔪    ");
    console.log("    [Bản Nâng Cấp: TRẠM KIỂM SOÁT KÉP]    ");
    console.log("==========================================\n");
    console.log("HƯỚNG DẪN BẢO VỆ BẠN BÈ KHÔNG BỊ CHÉM NHẦM: Tool cung cấp cho bạn 2 Option Chuyên Biệt!");
    console.log("[1]. TÌM KIẾM ĐỐI TƯỢNG (Không chém): Quét danh sách ig_done, truy lùng ai bỏ theo dõi, ném vào tệp 'sucvat.txt'. Quét xong bạn hoàn toàn có thể vô File sucvat.txt bằng tay để XÓA cứu lấy bạn bè!");
    console.log("[2]. THI HÀNH ÁN: Tool sẽ vác đao trảm sạch không nương tay DUY NHẤT NHỮNG KẺ NẰM TRONG TỆP 'sucvat.txt' của bạn!\n");

    rl.question('Nhập lựa chọn của bạn (1 hoặc 2): ', async (choice) => {
        rl.close();
        let mode = choice.trim();

        const CORE_USERNAME = "tanbaycu"; // Nick trụ sở
        
        let targetUsers = [];
        
        if (mode === '1') {
            console.log("\n=> ✅ ĐÃ CHỌN 1: TÍNH NĂNG ĐIỀU TRA (Chỉ quét ra file sucvat.txt)");
            if (!fs.existsSync('ig_done.txt')) {
                console.log("❌ LỖI: Sổ tử thần ig_done.txt đâu? Bạn chưa follow mồi đứa nào cả.");
                process.exit(1);
            }
            let rawDoneList = fs.readFileSync('ig_done.txt', 'utf8').split('\n').filter(Boolean).map(u => u.trim());
            targetUsers = Array.from(new Set(rawDoneList));
            console.log(`📦 Đã nạp ${targetUsers.length} tài khoản vào lò kiểm duyệt!`);
        } else if (mode === '2') {
            console.log("\n=> ✅ ĐÃ CHỌN 2: TÍNH NĂNG TÙNG XẺO (Chém hết trong file sucvat.txt)");
            if (!fs.existsSync('sucvat.txt')) {
                console.log("❌ LỖI: Chưa có tệp sucvat.txt! Bức thiết cày Bấm Số 1 trước đi đại ca!");
                process.exit(1);
            }
            targetUsers = Array.from(loadSet('sucvat.txt'));
            if(targetUsers.length === 0){
                 console.log("❌ Sổ đoạn đầu đài (sucvat) trống trơn không có tội phạm!");
                 process.exit(1);
            }
            console.log(`📦 Xác nhận Lệnh Truy Nã: ${targetUsers.length} Tên Phản Phúc!`);
        } else {
            console.log("❌ Chỉ được gõ 1 hoặc 2. Bạn vừa gõ bậy bạ gì đấy!");
            process.exit(1);
        }

        try {
            console.log(`\n🚀 Khởi động Kết Nối Máy Chủ...`);
            const browser = await puppeteer.connect({
                browserURL: 'http://127.0.0.1:9222',
                defaultViewport: null
            });
            const page = await browser.newPage();
            
            if (mode === '1') {
                // ==========================================
                // GIAI ĐOẠN 1+2: TRA KHẢO
                // ==========================================
                console.log("\n================[ BƯỚC 1: XÁC MINH 'ĐANG THEO DÕI' ]================");
                await checkListViaSearch(
                    page, CORE_USERNAME, targetUsers, 'following', 'ĐANG THEO DÕI',
                    '6_v1_checked.txt', '6_v1_co.txt', '6_v1_khong.txt'
                );
                
                let actuallyFollowing = Array.from(loadSet('6_v1_co.txt'));
                if (actuallyFollowing.length === 0) {
                    console.log("\n🎉 Quét xong Bước 1: Không có ma nào mình Dây Dưa Theo Dõi mướn cả!");
                    process.exit(0);
                }

                console.log("\n================[ BƯỚC 2: TRA KHẢO 'NGƯỜI THEO DÕI CỦA BẠN' ]================");
                await checkListViaSearch(
                    page, CORE_USERNAME, actuallyFollowing, 'followers', 'NGƯỜI THEO DÕI BẠN',
                    '6_v2_checked.txt', 'con.txt', 'sucvat.txt'
                );
                
                let traitorsCount = loadSet('sucvat.txt').size;
                console.log(`\n🎉 HOÀN TẤT CUỘC ĐIỀU TRA NHÂN SỰ! TÌM THẤY [${traitorsCount}] KẺ BỘI BẠC KHÔNG FOLLOW CHÉO.`);
                console.log("🚨 CHÚ Ý ĐẶC BIỆT 🚨:");
                console.log("1. Những ai đã Follow lại => NẰM TRONG TỆP 'con.txt' (Ngoan).");
                console.log("2. Những kẻ phản phúc => NẰM TRONG TỆP 'sucvat.txt' (Lá mặt lá trái).");
                console.log("👉 HÃY MỞ TỆP SUCVAT.TXT LÊN. Nếu có Bạn Bè Cốt Cán của bạn bị lọt vào, hãy xoá tên họ đi để cứu!");
                console.log("👉 Khi bạn duyệt chuẩn rồi, gõ 'node 6.js' và Bấm Phím [2] ĐỂ CẮT CỔ CHÚNG!");
                process.exit(0);

            } else if (mode === '2') {
                // ==========================================
                // GIAI ĐOẠN 3: LÊN ĐOẠN ĐẦU ĐÀI
                // ==========================================
                console.log("\n================[ THI HÀNH ÁN 'SUCVAT.TXT' ]================");
                let historySet = loadSet('ig_unfollowed_history.txt');
                let toKill = targetUsers.filter(u => !historySet.has(u));

                if (toKill.length === 0) {
                    console.log("\n🎉 Toàn bộ người trong đây đã bị bạn thanh trừng từ trước, dao chưa dính máu!");
                    process.exit(0);
                }

                console.log("Mài dao chờ Tùng Xẻo (Nghỉ trễ siêu lâu 15-25s giữa các lần chém để chống Block)... \n");

                for (let i = 0; i < toKill.length; i++) {
                    let target = toKill[i];
                    console.log(`[${i+1}/${toKill.length}] 🎯 Đang tới nhà: @${target}`);
                    
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
                            console.log(`  => ✅ Chặt Đẹp! Đá văng vào sọt rác lịch sử.`);
                            appendList('ig_unfollowed_history.txt', target);
                        } else {
                            console.log(`  => ⏩ Bỏ qua! Hình như IG đã chặn lệnh hoặc bạn đã tắt theo dõi bằng tay.`);
                            appendList('ig_unfollowed_history.txt', target); 
                        }
                    } catch (e) {
                        console.log(`  => ❌ Kênh bị lỗi hoặc Xóa Account.`);
                    }

                    let delayNum = Math.floor(Math.random() * 8000) + 12000;
                    console.log(`  (Rửa kiếm, phục kích ${Math.round(delayNum/1000)}s thoái lui khỏi Block...)\n`);
                    await delay(delayNum);
                }

                console.log("🏁 CÔNG CUỘC THANH TRỪNG THEO HỆ TƯ TƯỞNG SUCVAT ĐÃ KẾT THÚC THẮNG LỢI!");
                process.exit(0);
            }
        } catch (err) {
            console.error("LỖI KHÔNG ĐỠ NỔI DO MẠNG/CHROME:", err);
            process.exit(1);
        }
    });

})();
