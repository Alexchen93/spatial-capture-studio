# Spatial Capture

目前網站為手機本機重建的實驗版本。首頁是介紹頁，`workspace.html` 提供分步驟的素材、重建與視察工作區。使用者可透過行動裝置錄影或選擇影片；影片由瀏覽器取樣成畫面，原始影片不會儲存到網站。擷取畫面與輔助照片保存在瀏覽器 IndexedDB，可匯出 ZIP。單支影片限制為 90 秒、500 MB，最多擷取 60 張畫面。網站透過 vendored MIT 授權的 Splat.js 在支援 WebGPU 的裝置上嘗試本機照片定位及 Gaussian Splatting 訓練，可匯出視覺 PLY；照片不經由該功能上傳。訓練會分別顯示已提交工作、WebGPU 佇列回應與訓練數值讀回；可在本機查看及複製診斷，資料不會自動上傳。低負載模式為未經 iPhone 實測的選用方案，不能保證成功；提前結束後需再按下載 PLY。實際手機相容性、訓練時間及結果品質尚未實機驗證，關閉頁面或 GPU 被回收可能中斷，輸出須由使用者下載保存。

右側示範場景仍是獨立的固定地面和手工牆面／家具碰撞，不是照片重建結果。訓練面板可切換已記錄的固定視角預覽。詳見 [手機本機重建技術補充](./手機本機重建_技術補充.md) 與工作區中的產品、系統架構及碰撞設計文件。

## 個人場景校正與步行（本機實驗）

完成重建後，可在訓練面板選擇「儲存為個人步行場景」，再開啟個人校正頁；也可直接匯入本網站產生的 degree-0 Gaussian PLY（上限 128 MB、25 萬個 Gaussian）。PLY、相機姿態與校正資料只存於目前瀏覽器的 IndexedDB，不會同步到雲端，清除網站資料或更換瀏覽器可能使其遺失。校正工具提供點雲俯視參考、相機位置、尺度／方向／地板調整、步行範圍，以及手動畫矩形碰撞區和數值編輯；步行時只對人工設定的矩形區與步行邊界做碰撞。

視覺 Gaussian PLY 不會自動推導可靠的牆面、地板、實際尺寸或家具碰撞；初始校正只是參考值，必須依現場測量人工檢查。步行預覽依賴 WebGPU；不支援 WebGPU 時仍可載入 PLY、編輯和儲存校正，但無法顯示第一人稱視角。此流程仍屬實驗，尚未以 iPhone Safari 實機或真實空間完成驗收，不能視為精準量測或安全保證；雲端帳號、API、資料庫、任務佇列與 GPU worker 尚未實作。

## 舊的本機桌面視覺重建實驗

`tools/reconstruct.py` 是先前的可選路線，編排本機已安裝的 Nerfstudio、COLMAP、FFmpeg 與 NVIDIA GPU，輸出 Gaussian Splat PLY。它未接入網站，且不產生碰撞模型。這不是手機或網站本機運算的必要依賴。

## 驗證

執行 `node --test tests/*.test.mjs` 檢查碰撞、照片 ZIP 和以模擬引擎驗證的重建狀態流程。影片擷取另以桌面瀏覽器和合成影片測試；尚未以 iPhone Safari 實測。模擬測試不能證明 GPU 重建可用；必須另在真實手機與真實照片上測試。網站靜態檔案位於 `dist/`。

## Cloudflare 部署

正式網站：https://spatial-capture.pages.dev/ 。Cloudflare Pages 專案名稱為 `spatial-capture`，採用 Direct Upload；網站來源是此專案的 `dist/`，GitHub 推送不會自動更新網站。

在已登入對應 Cloudflare 帳號（或已設定 `CLOUDFLARE_API_TOKEN`）的環境中，更新網站使用：

```bash
npx wrangler@latest pages deploy dist --project-name spatial-capture --branch main
```

部署後請確認首頁、`/workspace.html` 及其 JavaScript 模組可正常載入。實驗性 WebGPU 重建仍須在目標手機上實機驗證。
