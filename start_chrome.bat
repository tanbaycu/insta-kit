@echo off
echo =======================================================
echo KHOI DONG GOOGLE CHROME (DEV PROFILE) CHO AUTOMATION
echo =======================================================
echo Profile rieng biet nay nam o thu muc C:\chrome-dev-profile
echo No hoat dong doc lap hoan toan voi Chrome chinh cua ban.
echo =======================================================

"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\chrome-dev-profile"
