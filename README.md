# Garbage Car Route Planner

一個以 GitHub Pages 為部署目標的純前端多點路線規劃器。V1 不需要後端與資料庫，路線資料保存在瀏覽器 localStorage，可匯出／匯入 JSON 備份。

## V1 功能

- 建立、重新命名、刪除多條路線
- 每條路線可加入任意數量的途經點
- 上移／下移調整停靠順序
- 儲存經緯度、地址與備註
- 匯出全部路線為 JSON、重新匯入
- 產生目前相鄰兩站的 Google Maps 導航連結
- PWA manifest 與 Service Worker 基礎離線殼
- 預留 Google Maps / Routes API 整合位置

## 本機執行

這是零建置的靜態網站，可直接使用任一靜態 HTTP server：

```bash
python3 -m http.server 8080
```

然後開啟 `http://localhost:8080`。

> Service Worker 在 localhost 或 HTTPS 才能正常工作。

## GitHub Pages

Repository → Settings → Pages → Build and deployment → Source 選 **Deploy from a branch**，Branch 選 `main`、資料夾選 `/(root)`。

預期網址：

`https://battlefield6348.github.io/garbage-car/`

## Google Maps

V1 先不把 API Key 寫入 repository。後續接 Google Maps JavaScript API / Places / Routes 時，請在 Google Cloud 對瀏覽器 Key 設定 HTTP referrer 限制，只允許正式 GitHub Pages 網域，並限制可使用的 API。

## 資料

目前資料只存在使用者自己的瀏覽器。清除網站資料會移除路線，因此重要路線請使用「匯出 JSON」備份。

## Roadmap

詳見 [docs/PLAN.md](docs/PLAN.md)。
