const STORAGE_KEY = "garbage-car.routes.v1";
let routes = loadRoutes();
let activeId = routes[0]?.id ?? null;

const $ = (id) => document.getElementById(id);
const routeList = $("routeList");
const waypointList = $("waypointList");

function id() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function loadRoutes() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(routes));
  render();
}

function activeRoute() {
  return routes.find((route) => route.id === activeId);
}

function createRoute() {
  const route = { id: id(), name: "未命名路線", waypoints: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  routes.unshift(route);
  activeId = route.id;
  save();
  setTimeout(() => $("routeName").select(), 0);
}

function render() {
  $("routeCount").textContent = `${routes.length} 條`;
  routeList.innerHTML = "";
  for (const route of routes) {
    const node = $("routeTemplate").content.firstElementChild.cloneNode(true);
    node.classList.toggle("active", route.id === activeId);
    node.querySelector("strong").textContent = route.name;
    node.querySelector("span").textContent = `${route.waypoints.length} 個地點`;
    node.onclick = () => { activeId = route.id; render(); };
    routeList.append(node);
  }

  const route = activeRoute();
  $("emptyState").hidden = Boolean(route);
  $("editorContent").hidden = !route;
  if (!route) return;

  $("routeName").value = route.name;
  $("routeMeta").textContent = `建立於 ${new Date(route.createdAt).toLocaleString("zh-TW")} · 資料儲存在此瀏覽器`;
  $("waypointCount").textContent = `${route.waypoints.length} 個`;
  waypointList.innerHTML = "";

  route.waypoints.forEach((point, index) => {
    const node = $("waypointTemplate").content.firstElementChild.cloneNode(true);
    node.querySelector(".waypoint-index").textContent = index + 1;
    node.querySelector("strong").textContent = point.name;
    node.querySelector(".address").textContent = point.address || "";
    node.querySelector(".coords").textContent = `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
    node.querySelector(".note").textContent = point.note || "";
    const nav = node.querySelector('[data-action="nav"]');
    nav.disabled = index === route.waypoints.length - 1;
    nav.onclick = () => navigate(index);
    const up = node.querySelector('[data-action="up"]');
    up.disabled = index === 0;
    up.onclick = () => move(index, index - 1);
    const down = node.querySelector('[data-action="down"]');
    down.disabled = index === route.waypoints.length - 1;
    down.onclick = () => move(index, index + 1);
    node.querySelector('[data-action="delete"]').onclick = () => removeWaypoint(index);
    waypointList.append(node);
  });
}

function move(from, to) {
  const route = activeRoute();
  if (!route || to < 0 || to >= route.waypoints.length) return;
  [route.waypoints[from], route.waypoints[to]] = [route.waypoints[to], route.waypoints[from]];
  route.updatedAt = new Date().toISOString();
  save();
}

function removeWaypoint(index) {
  const route = activeRoute();
  if (!route) return;
  route.waypoints.splice(index, 1);
  route.updatedAt = new Date().toISOString();
  save();
}

function navigate(index) {
  const points = activeRoute()?.waypoints;
  if (!points || !points[index + 1]) return;
  const a = points[index];
  const b = points[index + 1];
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", `${a.lat},${a.lng}`);
  url.searchParams.set("destination", `${b.lat},${b.lng}`);
  url.searchParams.set("travelmode", "driving");
  window.open(url, "_blank", "noopener");
}

$("waypointForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const route = activeRoute();
  if (!route) return;
  const lat = Number($("placeLat").value);
  const lng = Number($("placeLng").value);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    alert("請輸入有效的經緯度。");
    return;
  }
  route.waypoints.push({
    id: id(),
    name: $("placeName").value.trim(),
    address: $("placeAddress").value.trim(),
    lat,
    lng,
    note: $("placeNote").value.trim()
  });
  route.updatedAt = new Date().toISOString();
  event.target.reset();
  save();
});

$("routeName").addEventListener("change", (event) => {
  const route = activeRoute();
  if (!route) return;
  route.name = event.target.value.trim() || "未命名路線";
  route.updatedAt = new Date().toISOString();
  save();
});

$("deleteRouteBtn").onclick = () => {
  const route = activeRoute();
  if (!route || !confirm(`確定刪除「${route.name}」？`)) return;
  routes = routes.filter((item) => item.id !== route.id);
  activeId = routes[0]?.id ?? null;
  save();
};

$("exportBtn").onclick = () => {
  const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), routes }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `garbage-car-routes-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

$("importInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.version !== 1 || !Array.isArray(data.routes)) throw new Error("unsupported");
    if (!confirm("匯入會覆蓋目前瀏覽器中的全部路線，是否繼續？")) return;
    routes = data.routes;
    activeId = routes[0]?.id ?? null;
    save();
  } catch {
    alert("無法讀取此路線備份檔。");
  } finally {
    event.target.value = "";
  }
});

$("newRouteBtn").onclick = createRoute;
$("emptyNewRouteBtn").onclick = createRoute;

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}

render();