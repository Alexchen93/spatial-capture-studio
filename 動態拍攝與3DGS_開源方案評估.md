# 動態走拍與 3D Gaussian Splatting：開源方案評估

核對日期：2026-11-09。目標是「拿著 iPhone 走動拍攝**靜止**房間，最後在網站查看 3D 場景」。若被攝物體本身會移動，則是動態場景重建（4DGS／動態 NeRF），不是目前這條靜態 SfM → 3DGS 流程能解決的問題。

## 現況與失敗原因

- 網站已內含 MIT 授權的 [Splat.js](https://github.com/arrival-space/splat.js)（版本見 `dist/vendor/splat-js/PROVENANCE.txt`），用於照片 SfM 定位和 WebGPU 3DGS 訓練；不是缺少 3DGS 引擎。
- `dist/modules/app.mjs` 的即時拍攝固定每 **1.8 秒**檢查一次；`dist/modules/live-capture.mjs` 僅以亮度、整體邊緣量及與上一張的平均像素差挑選。該差值不能證明照片有足夠的**共同特徵與視差**；鏡頭快速掃過不同物件、白牆或模糊畫面仍可能被選入。
- `dist/modules/reconstruction.mjs` 在 **8 張**即首次定位，之後每新增 8 張以全部照片從頭定位／訓練。8 張只適合早期嘗試，不足以當作一般房間已可重建的門檻；反覆重訓也會增加手機負載。使用者的 12 張照片在「估計相機位置」失敗，與這個資料品質／重疊問題相符，但未取得該次完整 SfM 診斷，不能斷言是唯一原因。
- 網站目前只用 Splat.js 的重建部分；其上游已有專門處理手機走拍影片的 `src/io/video.js`，但本站 vendored 版本刻意排除了影片模組。本站 `dist/modules/video-frames.mjs` 則是均勻時間抽 60 張，沒有逐影格挑清晰畫面或按移動量選關鍵影格。

## 可借用的專案

| 專案 | 已有能力 | 對本站的適用方式 | 邊界 |
| --- | --- | --- | --- |
| [Splat.js](https://github.com/arrival-space/splat.js)（MIT） | 瀏覽器 SfM、WebGPU 3DGS、[影片關鍵影格選擇](https://github.com/arrival-space/splat.js/blob/main/src/io/video.js)；上游描述以移動量視窗、清晰度與曝光選影格，另有 WebCodecs／`<video>` 後備路徑 | **首選：整合上游影片選幀與掃描資料審核流程**，保留同一個重建引擎；優先使用連續影片作為可重現輸入 | 上游展示不等於本站在這台 iPhone 已成功；WebGPU、記憶體與 Safari 版本仍需實機測 |
| [Splatify-Anything](https://github.com/KuoFengYuan/splatify-anything)（PolyForm Noncommercial 1.0.0） | iOS ARKit 位姿、可選 LiDAR、移動／品質選幀、相機追蹤、Metal 裝置端訓練與 COLMAP 匯出；有 [拍攝架構文件](https://github.com/KuoFengYuan/splatify-anything/blob/main/docs/CAPTURE_ARCHITECTURE.md) | 參考掃描互動、追蹤狀態、補拍和匯出資料集；若使用者願意原生 App，可把它作為 iPhone 端基準實測 | **不是網頁元件**；瀏覽器不能直接拿 ARKit 位姿／Metal；非商業授權，不能直接複製進本站 |
| [COLMAP](https://github.com/colmap/colmap) + [Nerfstudio Splatfacto](https://docs.nerf.studio/nerfology/methods/splat.html)（Nerfstudio Apache-2.0） | 成熟桌面／伺服器 SfM 與 3DGS 基準 | 對同一組影片影格跑離線對照，分辨「素材本身不適合」和「瀏覽器引擎／手機效能問題」 | 需要另有足夠計算資源；不能直接取代 iPhone 網頁本機運算 |
| [SuperSplat Viewer](https://github.com/playcanvas/supersplat-viewer)（MIT） | 網頁觀看 Gaussian splat | 若現有 PLY 檢視器成為瓶頸，再評估替換檢視層 | **只負責觀看**，不能修復拍攝或相機定位 |

## 建議實作順序（保持網頁、照片不離開手機）

1. **先建立可重現輸入與診斷。** 使用一段 20–40 秒、同一鏡頭連續走拍的影片；從緩慢移動的位置環繞同一區域，維持相鄰視角大量重疊，避免全白牆、快速旋轉、鏡面及移動的人。匯出選中的影格清單與 SfM 的匹配／成功定位張數。刷新仍清掉原影片與照片；只有使用者主動下載資料時才留存。
2. **優先接入上游選幀。** 核對目前 vendored Splat.js commit 與上游 `src/io/video.js` 的 API／依賴，連同其 MIT 授權及必要的 Mediabunny MPL-2.0 NOTICE 一起整合。以 iPhone Safari 可用的影片解碼路徑實測；失敗時顯示「影片無法解碼」而非默默退回不等價資料。保留有界影格數與記憶體用量，讓使用者在開始訓練前審核模糊、斷鏡、重複視角。
3. **修正即時模式的定位門檻。** 不再把固定 1.8 秒間隔與 8 張視為重建保證。使用移動／清晰度驅動的關鍵影格，先確認連續重疊及一段可定位路徑，再開始昂貴的訓練；定位失敗應提示補拍**同一區域**而不是只說增加張數。影格上限與首批門檻需依手機實測調整，不能從上游桌面基準直接照搬。
4. **同素材 A/B 驗證。** 一份影片分別跑本站現行均勻抽影格、上游選幀，再在可用的桌面 GPU 跑 COLMAP/Splatfacto 基準。記錄總張數、匹配對、定位張數、訓練完成率、耗時與輸出可看程度。至少在目標 iPhone Safari 完成一次端到端 PLY 匯出，才能說「iPhone 可用」。

## 決策

保持「網頁本機、刷新即清除素材」這個產品邊界時，先借用 **Splat.js 原生影片選幀**，而非換掉整個重建引擎或把原生 ARKit 程式硬搬入 Safari。若目標是 iPhone 上可靠即時 AR 位姿與 LiDAR，則應另開原生 App 路線並重新評估授權、資料流與部署。這兩種路線的能力不能互相宣稱等價。
