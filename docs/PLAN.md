# Garbage Car — V1 規劃書

## 目標

建立一個可以保存多條長途路線、管理大量途經點，並逐站交給 Google Maps 導航的 Web/PWA 工具。V1 優先做到零伺服器成本、可直接部署 GitHub Pages。

## 使用情境

1. 建立「台灣環島」等路線。
2. 加入超過一般 Google Maps UI 方便管理數量的停靠點。
3. 調整停靠順序。
4. 保存多條路線。
5. 旅途中逐站開啟 Google Maps 導航。
6. 匯出 JSON 備份，換瀏覽器時可再匯入。

## V1

### 已建立的基礎能力

- 純 HTML/CSS/JavaScript，無 build step。
- localStorage 多路線保存。
- Waypoint 新增、刪除、排序。
- JSON import/export。
- 相鄰 waypoint Google Maps Directions URL。
- Responsive UI。
- PWA manifest + service worker。

### 下一階段

- Google Maps JavaScript API。
- Places Autocomplete 地點搜尋。
- 點擊地圖新增 waypoint。
- Marker 與 waypoint 編號。
- Routes API 道路計算。
- 超過單次 waypoint 上限時自動分批。
- 合併各批距離、時間與 polyline。
- 拖曳 waypoint 排序。
- IndexedDB 取代 localStorage。
- PWA icons 與更完整的離線策略。

## 非 V1 範圍

- 帳號系統。
- 雲端同步。
- 後端 API。
- PostgreSQL。
- 多人協作。
- 公開分享 URL。
- 自動最佳化全部 waypoint 順序。

## 資料模型

```js
Route {
  id,
  name,
  createdAt,
  updatedAt,
  waypoints: Waypoint[]
}

Waypoint {
  id,
  name,
  address,
  lat,
  lng,
  note
}
```

## Google Maps 安全設定

正式串接瀏覽器 API Key 時：

- 設定 HTTP referrer restriction。
- 只允許 GitHub Pages 正式網域及必要的 localhost 開發來源。
- 設定 API restrictions，只開實際使用的 Maps Platform API。
- 設定 quota / budget alert。
- 不在前端放置任何 server-only secret。

## 部署

GitHub Pages 直接由 `main /(root)` 發佈，無需 Actions 或 Node build。

## V2 候選

當跨裝置同步或分享成為需求，再加入後端與資料庫；前端資料模型盡量維持相容，以便 migration。
