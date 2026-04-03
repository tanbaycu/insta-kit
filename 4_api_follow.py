import time
import random
import os
import glob
import sys
try:
    from instagrapi import Client
except ImportError:
    print("Vui lòng mở Terminal mới chạy lệnh: pip install instagrapi")
    exit()

print("==========================================")
print("    🚀 CỖ MÁY AUTO FOLLOW BẰNG API 🚀    ")
print("          [CHẠY NGẦM KHÔNG GIAO DIỆN]     ")
print("==========================================\n")

cl = Client()

print("Chọn phương thức đăng nhập:")
print("[1]. Nhập Username + Mật khẩu (Hỗ trợ nhập mã 2FA SMS/App)")
print("[2]. Cắm SessionID trực tiếp thẳng vào (Bypass Login)")
login_choice = input("\nLựa chọn (1 hoặc 2): ").strip()

if login_choice == '1':
    username = input("Nhập Username Instagram của bạn: ")
    password = input("Nhập Mật Khẩu Instagram: ")

    try:
        print("\n[⏳] Đang kết nối vào máy chủ Instagram API...")
        cl.login(username, password)
        print("=> ✅ ĐĂNG NHẬP THÀNH CÔNG VÀO HỆ THỐNG!")
    except Exception as e:
        error_msg = str(e)
        if "Two-factor authentication required" in error_msg or "verification_code" in error_msg:
            print("\n=> 🔐 Phát hiện Bảo Mật 2 Lớp (2FA)! Hệ thống IG vừa gửi mã số về máy bạn.")
            code = input("Nhập mã OTP 6 số (từ SMS hoặc Google Authenticator): ")
            try:
                cl.login(username, password, verification_code=code)
                print("=> ✅ VƯỢT 2FA THÀNH CÔNG!")
            except Exception as e2:
                print(f"=> ❌ ĐĂNG NHẬP OTP THẤT BẠI: {e2}")
                exit()
        else:
            print(f"=> ❌ ĐĂNG NHẬP THẤT BẠI (Có thể do Checkpoint/Sai Pass): {e}")
            exit()
else:
    print("\n[HƯỚNG DẪN]: Copy đoạn Value dài nhằng thẳng từ biến 'sessionid' trong Cookies trình duyệt.")
    session_id = input("\nDán đoạn mã SessionID của Chrome vào đây: ").strip()
    try:
        print("\n[⏳] Đang ép ống truyền Cookie ẩn danh...")
        cl.login_by_sessionid(session_id)
        print("=> ✅ BYPASS ĐĂNG NHẬP BẰNG SESSIONID THÀNH CÔNG! Đang cày...")
    except Exception as e:
        print(f"=> ❌ LỖI SESSIONID HẾT HẠN HOẶC IG TỪ CHỐI: {e}")
        exit()

# Tự động tìm lấy File Phiên Chạy vừa lọc bằng Tool 2 (NodeJS) hồi nãy
session_files = glob.glob("session_follow*.txt")
if not session_files:
    print("❌ Không tìm thấy file Phiên Chạy (session_follow_...txt). Vui lòng qua 2.js để đẻ ra List Sạch trước!")
    exit()

latest_session = max(session_files, key=os.path.getctime)
print(f"\n=> 📁 Đã tìm thấy File Phiên Đầu Vào: {latest_session}")

with open(latest_session, "r", encoding="utf-8") as f:
    users = [u.strip() for u in f.readlines() if u.strip()]

print(f"   + Tổng số ID tinh khiết chuẩn bị chạy: {len(users)}\n")

delay_min = int(input("Nhập thời gian nghỉ TỐI THIỂU giữa mỗi lần Click (ví dụ: 5): "))
delay_max = int(input("Nhập thời gian nghỉ TỐI ĐA (ví dụ: 15): "))

print("\n🚀 BẮT ĐẦU CÀY CUỐC BẰNG LÕI API...\n")

for target_user in users:
    try:
        # Máy chủ API bắt buộc quy đổi tên người dùng sang một chuỗi mã số máy tính ID (VD: 123456789)
        user_id = cl.user_id_from_username(target_user)
        
        # Gọi lệnh Follow bắn trực tiếp vào Server Meta
        result = cl.user_follow(user_id)
        
        if result:
            print(f"=> ✅ Follow API THÀNH CÔNG cho @{target_user}")
            with open("ig_done.txt", "a", encoding="utf-8") as f:
                f.write(target_user + "\n")
        else:
            print(f"=> ⏩ Bỏ qua @{target_user} (Lỗi ngầm từ server chặn thao tác)")
            with open("ig_done.txt", "a", encoding="utf-8") as f:
                f.write(target_user + "\n")
                
    except Exception as e:
        error_msg = str(e)
        if "429" in error_msg or "RetryError" in error_msg or "too many" in error_msg.lower():
            print(f"\n=> ⛔ ⛔ CẢNH BÁO: CHẶN IP / RATE LIMIT (Lỗi 429) TỪ INSTAGRAM!")
            print(f"      - Hiện tại IP của bạn đã gọi API tìm kiếm IG ID quá dày đặc.")
            print(f"      - IG tạm khóa quyền truy xuất. Vui lòng tắt Tool và ra ngoài hóng gió 30 phút - 1 tiếng sau quay lại chạy là hết!")
            break
        else:
            print(f"=> ❌ LỖI IG API @{target_user}: Không tìm thấy tài khoản để Follow ({error_msg[:50]}...)")
            with open("ig_done.txt", "a", encoding="utf-8") as f:
                f.write(target_user + "\n")

    sleep_time = random.randint(delay_min, delay_max)
    print(f"  (Che giấu truy xuất API, Nghỉ ngẫu nhiên {sleep_time}s...)")
    time.sleep(sleep_time)

print("\n=> 🎉 ĐÃ CHẠY XONG TOÀN BỘ PHIÊN NÀY BẰNG API!")
