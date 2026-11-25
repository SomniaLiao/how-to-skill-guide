# how-to-skill-guide

說明 Google Gemini 的 Gem 轉為 Skill 後，教師如何製作與分享 Skill，以及學生如何安裝與進行語音練習的教學網站。內容為繁體中文與日語雙語。

## 頁面

| 檔案 | 對象 | 用途 |
|---|---|---|
| `index.html` | 學生 | 理解、安裝與練習 |
| `teacher.html` | 教師 | 製作、改寫與分享 |
| `check.html` | 維護者 | 檢查內容是否違反文字規則 |
| `admin.html` | 維護者 | 內容後台（第二階段） |

## 資料夾

| 資料夾 | 內容 |
|---|---|
| `assets/` | 樣式、程式與截圖 |
| `content/` | 頁面文字（JSON） |
| `templates/` | 教師頁顯示的 Skill 範本檔 |
| `downloads/` | 提供學生下載的 ZIP 檔 |
| `admin/` | 後台程式（第二階段） |
| `tools/` | 開發時使用的指令稿 |

## 在本機預覽

頁面以 ES Modules 與 fetch 讀取檔案，直接點開 HTML 無法運作，需要本機伺服器。在本資料夾執行：

```bash
python3 -m http.server
```

再以瀏覽器開啟 `http://localhost:8000/`。

## 更新內容

1. 修改 `content/` 中的 JSON，或 `templates/` 中的範本檔。
2. 開啟 `http://localhost:8000/check.html`，確認沒有錯誤。
3. 修改範本檔時，執行 `bash tools/build-zips.sh` 重新產生 ZIP 檔。
4. 提交後、上傳前，執行 `bash tools/pre-push-check.sh`，結果為零才可上傳。

## 隱私與憑證

- 網站不蒐集、不傳送任何使用者資料。瀏覽器只保存語言模式與左側欄的狀態。
- 檔案中不得出現學生或教師的姓名、電子郵件、帳號名稱與照片。範例人名使用「〇〇さん」或虛構名稱。
- 截圖必須遮蔽電子郵件、帳號名稱與大頭貼。
- 權杖、密碼等憑證不得寫入任何檔案。疑似外洩時立即撤銷，只刪除檔案不夠，因為 git 的歷史紀錄仍會保留。
- 提交一律使用 GitHub 提供的 noreply 電子郵件。
