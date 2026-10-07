const STORE = "garbage-car.routes.v1";
const ARRIVAL_METERS = 30;
let routes = load();
let activeId = routes[0]?.id ?? null;
let map;
let selected;
let selectedMarker;
let markers = [];
let currentPosition;
let watchId = null;
let navigating = false;
let navIndex = 0;
let headingUp = true;
let smoothedHeading = null;
let deviceHeading = null;
let orientationListening = false;

const $ = id => document.getElementById(id);
const uid = () => globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);

function load() {
  try {
    const value = JSON.parse(localStorage.getItem(STORE) || "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function active() { return routes.find(route => route.id === activeId); }
function save() { localStorage.setItem(STORE, JSON.stringify(routes)); render(); }

function create() {
  const route = { id: uid(), name: "未命名路線", waypoints: [], createdAt: new Date().toISOString() };
  routes.unshift(route); activeId = route.id; save();
}

function render() {
  $("routeCount").textContent = routes.length + " 條";
  $("routeList").innerHTML = "";
  routes.forEach(route => {
    const node = $("routeTemplate").content.firstElementChild.cloneNode(true);
    node.classList.toggle("active", route.id === activeId);
    node.querySelector("strong").textContent = route.name;
    node.querySelector("span").textContent = route.waypoints.length + " 個地點";
    node.onclick = () => { if (!navigating) { activeId = route.id; render(); } };
    $("routeList").append(node);
  });
  const route = active();
  $("emptyState").hidden = !!route;
  $("editorContent").hidden = !route;
  if (!route) return;
  $("routeName").value = route.name;
  $("routeMeta").textContent = "MapLibre · 路線資料儲存在此瀏覽器";
  $("waypointCount").textContent = route.waypoints.length + " 個";
  $("waypointCountTab").textContent = "(" + route.waypoints.length + ")";
  $("startNavBtn").disabled = !route.waypoints.length || navigating;
  $("waypointList").innerHTML = "";
  route.waypoints.forEach((point, index) => {
    const node = $("waypointTemplate").content.firstElementChild.cloneNode(true);
    node.querySelector(".waypoint-index").textContent = index + 1;
    node.querySelector("strong").textContent = point.name;
    node.querySelector(".address").textContent = point.address || formatCoord(point);
    node.querySelector('[data-action="google"]').onclick = () => googleNav(point);
    const up = node.querySelector('[data-action="up"]');
    up.disabled = index === 0 || navigating; up.onclick = () => move(index, index - 1);
    const down = node.querySelector('[data-action="down"]');
    down.disabled = index === route.waypoints.length - 1 || navigating; down.onclick = () => move(index, index + 1);
    const remove = node.querySelector('[data-action="delete"]');
    remove.disabled = navigating; remove.onclick = () => { route.waypoints.splice(index, 1); save(); };
    $("waypointList").append(node);
  });
  drawMarkers();
}

function formatCoord(point) { return point.lat.toFixed(5) + ", " + point.lng.toFixed(5); }
function move(from, to) {
  const route = active(); if (!route) return;
  [route.waypoints[from], route.waypoints[to]] = [route.waypoints[to], route.waypoints[from]]; save();
}

function showMapStatus(message) {
  const pane = $("map");
  pane.textContent = message; pane.style.display = "grid"; pane.style.placeItems = "center";
  pane.style.padding = "24px"; pane.style.textAlign = "center"; pane.style.color = "#6b7280";
}

function initMap() {
  if (typeof maplibregl === "undefined") {
    showMapStatus("地圖暫時無法載入，但其他路線功能仍可使用。請重新整理或檢查網路連線。\n\n也可以直接使用右側的路線隊列。\n");
    return;
  }
  try {
    map = new maplibregl.Map({
      container: "map",
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [120.9, 23.7],
      zoom: 7
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    const geo = new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showUserLocation: true });
    map.addControl(geo, "top-right");
    geo.on("geolocate", event => { currentPosition = { lat: event.coords.latitude, lng: event.coords.longitude }; if (navigating) updateNavigation(); });
    map.on("load", () => { geo.trigger(); drawMarkers(); });
    map.on("click", event => {
      if (navigating) return;
      select({
        name: "自訂停靠點",
        address: formatCoord({ lat: event.lngLat.lat, lng: event.lngLat.lng }),
        lat: event.lngLat.lat,
        lng: event.lngLat.lng
      });
    });
  } catch (error) {
    console.error("Map initialization failed", error); map = undefined;
    showMapStatus("地圖暫時無法載入，但其他路線功能仍可使用。請重新整理或檢查網路連線。\n\n也可以直接使用右側的路線隊列。\n");
  }
}

async function loadMapLibrary() {
  try {
    const module = await import("https://unpkg.com/maplibre-gl@6.13.0/dist/maplibre-gl.mjs");
    globalThis.maplibregl = module;
    initMap();
  } catch (primaryError) {
    console.warn("UNPKG MapLibre load failed", primaryError);
    try {
      const module = await import("https://cdn.jsdelivr.net/npm/maplibre-gl@6.13.0/dist/maplibre-gl.mjs");
      globalThis.maplibregl = module;
      initMap();
    } catch (fallbackError) {
      console.error("MapLibre load failed", fallbackError);
      showMapStatus("地圖暫時無法載入，但其他路線功能仍可使用。請重新整理或檢查網路連線。");
    }
  }
}
function select(point) {
  if (!map || typeof maplibregl === "undefined") return;
  selected = point; if (selectedMarker) selectedMarker.remove();
  selectedMarker = new maplibregl.Marker().setLngLat([point.lng, point.lat]).addTo(map);
  $("selectedName").textContent = point.name; $("selectedAddress").textContent = point.address; $("selectionCard").hidden = false;
}

function drawMarkers() {
  if (!map || typeof maplibregl === "undefined") return;
  markers.forEach(marker => marker.remove()); markers = [];
  const route = active(); if (!route) return;
  route.waypoints.forEach((point, index) => {
    const element = document.createElement("div"); element.className = "number-marker"; element.textContent = index + 1;
    markers.push(new maplibregl.Marker({ element }).setLngLat([point.lng, point.lat]).addTo(map));
  });
}

function distanceMeters(a, b) {
  const radius = 6371000, lat = (b.lat - a.lat) * Math.PI / 180, lng = (b.lng - a.lng) * Math.PI / 180;
  const value = Math.sin(lat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(lng / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function normalizeHeading(value) { return ((value % 360) + 360) % 360; }
function smoothHeading(next) {
  next = normalizeHeading(next);
  if (smoothedHeading === null) return smoothedHeading = next;
  const delta = ((next - smoothedHeading + 540) % 360) - 180;
  smoothedHeading = normalizeHeading(smoothedHeading + delta * 0.25);
  return smoothedHeading;
}
function onDeviceOrientation(event) {
  const value = typeof event.webkitCompassHeading === "number" ? event.webkitCompassHeading : (typeof event.alpha === "number" ? 360 - event.alpha : null);
  if (value !== null) deviceHeading = normalizeHeading(value);
}
async function enableOrientation() {
  if (orientationListening || typeof DeviceOrientationEvent === "undefined") return;
  try {
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== "granted") return;
    }
    window.addEventListener("deviceorientationabsolute", onDeviceOrientation, true);
    window.addEventListener("deviceorientation", onDeviceOrientation, true);
    orientationListening = true;
  } catch (error) { console.warn("Orientation", error); }
}

function startNavigation() {
  const route = active(); if (!route?.waypoints.length) return;
  navigating = true; navIndex = 0; smoothedHeading = null; $("navPanel").hidden = false; $("selectionCard").hidden = true;
  enableOrientation();
  if (selectedMarker) { selectedMarker.remove(); selectedMarker = null; }
  if (navigator.geolocation) watchId = navigator.geolocation.watchPosition(position => { currentPosition = { lat: position.coords.latitude, lng: position.coords.longitude, heading: position.coords.heading, speed: position.coords.speed, accuracy: position.coords.accuracy }; updateNavigation(); }, error => console.warn("GPS", error.message), { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 });
  render(); updateNavigation();
}

function updateNavigation() {
  const route = active(), target = route?.waypoints[navIndex];
  if (!target) { finishNavigation(true); return; }
  $("navProgress").textContent = "第 " + (navIndex + 1) + " / " + route.waypoints.length + " 站";
  $("navTarget").textContent = target.name;
  if (!currentPosition) { $("navDistance").textContent = "等待 GPS…"; return; }
  const distance = distanceMeters(currentPosition, target);
  $("navDistance").textContent = distance < 1000 ? Math.round(distance) + " m" : (distance / 1000).toFixed(1) + " km";
  if (distance <= ARRIVAL_METERS) { navIndex++; updateNavigation(); return; }
  if (map) {
    const gpsHeading = Number.isFinite(currentPosition.heading) && (currentPosition.speed === null || currentPosition.speed > 0.8) ? currentPosition.heading : null;
    const rawHeading = gpsHeading ?? deviceHeading;
    const bearing = headingUp && rawHeading !== null ? smoothHeading(rawHeading) : 0;
    map.easeTo({ center: [currentPosition.lng, currentPosition.lat], zoom: 17, bearing, duration: 500, essential: true });
  }
}

function finishNavigation(done = false) {
  navigating = false; smoothedHeading = null;
  if (map) map.easeTo({ bearing: 0, duration: 400 });
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  $("navPanel").hidden = true; render(); if (done) alert("路線已完成");
}
function googleNav(point) {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1"); url.searchParams.set("destination", point.lat + "," + point.lng); url.searchParams.set("travelmode", "driving");
  window.open(url, "_blank", "noopener");
}

$("addSelectedBtn").onclick = () => {
  const route = active(); if (!route || !selected) return;
  route.waypoints.push({ id: uid(), ...selected }); selected = undefined;
  if (selectedMarker) { selectedMarker.remove(); selectedMarker = null; }
  $("selectionCard").hidden = true; save();
};
$("startNavBtn").onclick = startNavigation;
$("headingModeBtn").onclick = async () => { headingUp = !headingUp; $("headingModeBtn").textContent = headingUp ? "行進方向朝上" : "北方朝上"; if (headingUp) await enableOrientation(); if (!headingUp && map) map.easeTo({ bearing: 0, duration: 400 }); };
$("skipBtn").onclick = () => { if (navigating) { navIndex++; updateNavigation(); } };
$("stopNavBtn").onclick = () => finishNavigation(false);
$("routeName").onchange = event => { const route = active(); if (route) { route.name = event.target.value.trim() || "未命名路線"; save(); } };
$("deleteRouteBtn").onclick = () => {
  const route = active(); if (!route || !confirm("確定刪除「" + route.name + "」？")) return;
  routes = routes.filter(item => item.id !== route.id); activeId = routes[0]?.id ?? null; save();
};
$("exportBtn").onclick = () => {
  const blob = new Blob([JSON.stringify({ version: 1, routes }, null, 2)], { type: "application/json" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "garbage-car-routes.json"; link.click(); URL.revokeObjectURL(link.href);
};
$("importInput").onchange = async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.version !== 1 || !Array.isArray(data.routes)) throw new Error("invalid backup");
    if (confirm("匯入會覆蓋目前路線，繼續？")) { routes = data.routes; activeId = routes[0]?.id ?? null; save(); }
  } catch { alert("無法讀取備份檔"); }
  event.target.value = "";
};
$("newRouteBtn").onclick = create;
$("emptyNewRouteBtn").onclick = create;
document.querySelectorAll(".tab").forEach(button => button.onclick = () => {
  document.querySelectorAll(".tab").forEach(tab => tab.classList.toggle("active", tab === button));
  document.querySelector(".workspace").classList.toggle("show-queue", button.dataset.tab === "queue");
});

render();
loadMapLibrary();
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(error => console.warn("Service worker", error)));
