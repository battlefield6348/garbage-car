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
let routingRequest = 0;
let routingTimer = null;
let viaMarkers = [];
let routeDrag = null;
let wakeLock = null;
let deviationCount = 0;
let lastDeviationAlert = 0;
let fixedProgress = 0;
let fixedRouteDraft = null;
function viaKey(a,b){return a.id+"__"+b.id;}
function routeSegments(){const p=active()?.waypoints||[];return p.slice(1).map((end,i)=>({start:p[i],end,key:viaKey(p[i],end)}));}
function editViaPoints(){return active()?.via || (active().via={});}
function routeCoordinates(){
 const p=active()?.waypoints||[];
 if(navigating){const target=p[navIndex];if(!target||!currentPosition)return [];
 const prior=navIndex>0?p[navIndex-1]:null;
 const via=prior?(active()?.via?.[viaKey(prior,target)]||[]):[];
 return [currentPosition,...via,target];}
 const all=[];for(let i=0;i<p.length;i++){if(i)all.push(...(active()?.via?.[viaKey(p[i-1],p[i])]||[]));all.push(p[i]);}return all;
}
function refreshViaMarkers(){
 viaMarkers.forEach(m=>m.remove());viaMarkers=[];
 if(!map||navigating)return;
 for(const segment of routeSegments())for(const point of active()?.via?.[segment.key]||[]){
  const element=document.createElement("div");
  element.className="route-via-marker";
  element.textContent="●";
  element.title="中途點：拖曳微調位置";
  const marker=new maplibregl.Marker({element,draggable:true}).setLngLat([point.lng,point.lat]).addTo(map);
  marker.on("dragend",()=>{const pos=marker.getLngLat();point.lng=pos.lng;point.lat=pos.lat;save();});
  viaMarkers.push(marker);
 }
}
function removeVia(key,index){
 const route=active();if(!route?.via?.[key])return;
 route.via[key].splice(index,1);if(!route.via[key].length)delete route.via[key];
 save();
}
function renderViaAfter(point,index,route){
 const next=route.waypoints[index+1];if(!next)return;
 const key=viaKey(point,next);
 for(const [viaIndex,via] of (route.via?.[key]||[]).entries()){
  const node=$("waypointTemplate").content.firstElementChild.cloneNode(true);
  node.classList.add("via-waypoint");
  node.querySelector(".waypoint-index").textContent="↳";
  node.querySelector("strong").textContent="中途經過點";
  node.querySelector(".address").textContent=formatCoord(via);
  node.querySelector('[data-action="google"]').textContent="定位";
  node.querySelector('[data-action="google"]').onclick=()=>map?.flyTo({center:[via.lng,via.lat],zoom:17});
  const up=node.querySelector('[data-action="up"]'),down=node.querySelector('[data-action="down"]');
  const change=delta=>{const items=route.via[key],other=viaIndex+delta;if(other<0||other>=items.length)return;[items[viaIndex],items[other]]=[items[other],items[viaIndex]];save();};
  up.disabled=navigating||viaIndex===0;up.onclick=()=>change(-1);
  down.disabled=navigating||viaIndex===(route.via[key].length-1);down.onclick=()=>change(1);
  const remove=node.querySelector('[data-action="delete"]');remove.disabled=navigating;remove.onclick=()=>removeVia(key,viaIndex);
  $("waypointList").append(node);
 }
}
function insertViaAt(location){
 if(navigating||!active()||active().waypoints.length<2)return;
 const segments=routeSegments();
 let best=null,dist=Infinity;
 for(const seg of segments){const d=distanceMeters(location,seg.start)+distanceMeters(location,seg.end)-distanceMeters(seg.start,seg.end);if(d<dist){dist=d;best=seg;}}
 if(!best)return;
 (editViaPoints()[best.key] ||= []).push({lat:location.lat,lng:location.lng});
 save();
}
function setupRouteDragging(){
 if(!map)return;
 let drag=null;
 const onLine=e=>map.getLayer("road-route-hit")&&map.queryRenderedFeatures(e.point,{layers:["road-route-hit"]}).length>0;
 const begin=e=>{
  if(navigating||!onLine(e))return;
  drag={start:e.point,last:e.lngLat,moved:false};
  map.dragPan.disable();
  map.getCanvas().style.cursor="grabbing";
 };
 const move=e=>{
  if(!drag)return;
  drag.last=e.lngLat;
  if(Math.hypot(e.point.x-drag.start.x,e.point.y-drag.start.y)>8)drag.moved=true;
 };
 const finish=e=>{
  if(!drag)return;
  const d=drag;drag=null;
  map.dragPan.enable();map.getCanvas().style.cursor="";
  if(d.moved)insertViaAt({lng:(e?.lngLat||d.last).lng,lat:(e?.lngLat||d.last).lat});
 };
 map.on("mousedown",begin);map.on("mousemove",move);map.on("mouseup",finish);
 map.on("touchstart",e=>{
  if(navigating||e.originalEvent.touches.length!==1||!onLine(e))return;
  drag={start:e.point,last:e.lngLat,moved:false};
  map.dragPan.disable();
 });
 map.on("touchmove",move);map.on("touchend",finish);
 map.on("touchcancel",()=>{drag=null;map.dragPan.enable();});
 map.on("mouseenter","road-route-hit",()=>{if(!navigating)map.getCanvas().style.cursor="grab";});
 map.on("mouseleave","road-route-hit",()=>{if(!drag)map.getCanvas().style.cursor="";});
}

let lastRoutePosition = null;
let lastRouteTime = 0;
let lastRouteTarget = null;

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
function invalidateFixedRoute(){const route=active();if(route)route.fixedGeometry=null;}

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
  $("sheetLabel").textContent = route.waypoints.length + " 個停靠點 · 點擊展開";
  $("startNavBtn").disabled = !route.waypoints.length || navigating;
  $("modeBtn").textContent = "模式：" + (route.mode==="dynamic"?"動態規劃":"固定路線");
  $("saveFixedBtn").disabled = navigating || !fixedRouteDraft;
  $("saveFixedBtn").textContent = route.fixedGeometry ? "更新固定路線" : "儲存固定路線";
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
    renderViaAfter(point,index,route);
    if(index>0){
      const key=viaKey(route.waypoints[index-1],point);
      if(route.turnCandidates?.[key]){
        const button=document.createElement("button");
        button.className="icon-btn";
        button.textContent="移除折返候選點";
        button.disabled=navigating;
        button.onclick=()=>{delete route.turnCandidates[key];save();};
        node.querySelector(".waypoint-actions").append(button);
      }
    }

  });
  document.querySelector(".workspace").classList.toggle("is-navigating", navigating);
  drawMarkers();
  refreshViaMarkers();
  scheduleRoadRoute();
}

function formatCoord(point) { return point.lat.toFixed(5) + ", " + point.lng.toFixed(5); }
function move(from, to) {
  invalidateFixedRoute();
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
    geo.on("geolocate", event => { if (!navigating) currentPosition = { lat: event.coords.latitude, lng: event.coords.longitude, accuracy: event.coords.accuracy }; });
    map.on("load", () => { geo.trigger(); drawMarkers(); refreshViaMarkers(); scheduleRoadRoute(); setupRouteDragging(); });
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
    const marker = new maplibregl.Marker({ element, draggable: !navigating }).setLngLat([point.lng, point.lat]).addTo(map);
    marker.on("dragend", () => {
      if (navigating) return;
      const position = marker.getLngLat();
      invalidateFixedRoute();
      point.lat = position.lat;
      point.lng = position.lng;
      point.address = formatCoord(point);
      save();
    });
    element.title = navigating ? "導航期間不可移動停靠點" : "拖曳微調停靠點位置";
    markers.push(marker);
  });
}

function roadRouteStatus(message) {
  const el = $("roadRouteStatus");
  if (el) el.textContent = message;
}
function clearRoadRoute() {
  if (!map || !map.isStyleLoaded()) return;
  if (map.getLayer("road-route-hit")) map.removeLayer("road-route-hit");
  if (map.getLayer("road-route-line")) map.removeLayer("road-route-line");
  if (map.getSource("road-route")) map.removeSource("road-route");
}
function scheduleRoadRoute() {
  clearTimeout(routingTimer);
  const request = ++routingRequest;
  const fixed = active()?.mode !== "dynamic" && active()?.fixedGeometry;
  if (navigating && fixed) {
    clearTimeout(routingTimer);
    showFixedRoute();
    return;
  }
  const points = routeCoordinates();
  if (points.length < 2) {
    clearRoadRoute();
    if (navigating) { roadRouteStatus("等待 GPS 定位…"); return; }
    roadRouteStatus(points.length ? "至少需要兩個停靠點才能計算道路路線" : "新增停靠點後會顯示道路路線");
    return;
  }
  roadRouteStatus(navigating ? "規劃目前位置至下一站…" : "道路路線計算中…");
  routingTimer = setTimeout(() => fetchRoadRoute(request, points.map(p => ({ lat: p.lat, lng: p.lng }))), 450);
}
async function fetchRoadRoute(request, points) {
  const route=active();
  const stops=route?.waypoints||[];
  const candidates=route?.turnCandidates||{};
  const via=route?.via||{};
  const getLeg=async coords=>{
    const coordinates=coords.map(p=>p.lng+","+p.lat).join(";");
    const url="https://router.project-osrm.org/route/v1/driving/"+coordinates+
      "?overview=full&geometries=geojson&steps=false&continue_straight=true";
    const response=await fetch(url);
    if(!response.ok)throw new Error("HTTP "+response.status);
    const data=await response.json();
    if(data.code!=="Ok"||!data.routes?.[0]?.geometry?.coordinates?.length)
      throw new Error(data.code||"Invalid route");
    return data.routes[0];
  };
  try{
    const planned=[];
    if(navigating){
      const previous=stops[navIndex-1],target=stops[navIndex];
      const key=previous&&target?viaKey(previous,target):null;
      const candidate=key?candidates[key]:null;
      if(candidate)planned.push(await getLeg([currentPosition,candidate,...(via[key]||[]),target]));
      else planned.push(await getLeg(points));
    }else{
      for(let i=1;i<stops.length;i++){
        const from=stops[i-1],to=stops[i],key=viaKey(from,to);
        const candidate=candidates[key];
        planned.push(await getLeg([from,...(candidate?[candidate]:[]),...(via[key]||[]),to]));
      }
    }
    if(request!==routingRequest)return;
    if(!planned.length)throw new Error("Empty route");
    const result={
      geometry:{type:"LineString",coordinates:planned.flatMap((leg,i)=>i?leg.geometry.coordinates.slice(1):leg.geometry.coordinates)},
      distance:planned.reduce((s,l)=>s+l.distance,0),
      duration:planned.reduce((s,l)=>s+l.duration,0)
    };
    const caution=Object.keys(candidates).length>0;
    if(!map||!map.isStyleLoaded()){
      roadRouteStatus("等待地圖載入…");
      map?.once("load",()=>{if(request===routingRequest)drawRoadRoute(result,caution);});
      return;
    }
    drawRoadRoute(result,caution);
  }catch(error){
    if(request!==routingRequest)return;
    clearRoadRoute();
    roadRouteStatus("無法取得道路路線；請確認折返候選點是否位於可通行道路");
    console.warn("Road routing",error);
  }
}
function drawRoadRoute(route, manualRetrace = false) {
  if (!map || !map.isStyleLoaded()) return;
  fixedRouteDraft = structuredClone(route.geometry);
  const stored = active()?.fixedGeometry;
  const geometry = !navigating && active()?.mode !== "dynamic" && stored ? stored : route.geometry;
  const data = { type: "Feature", properties: {}, geometry };
  if (map.getSource("road-route")) map.getSource("road-route").setData(data);
  else {
    map.addSource("road-route", { type: "geojson", data });
    map.addLayer({ id: "road-route-hit", type: "line", source: "road-route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#2563eb", "line-width": 28, "line-opacity": 0.015 } });
    map.addLayer({ id: "road-route-line", type: "line", source: "road-route",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#2563eb", "line-width": 6, "line-opacity": 0.85 }
    });
  }
  roadRouteStatus("道路路線 " + (route.distance / 1000).toFixed(1) + " 公里 · 預估 " + Math.round(route.duration / 60) + " 分鐘（不含即時路況）" + (manualRetrace ? " · 折返候選點未驗證迴轉合法性" : ""));
}
function showFixedRoute(){
 const geometry=active()?.fixedGeometry;
 if(!geometry||!map||!map.isStyleLoaded())return;
 const data={type:"Feature",properties:{},geometry};
 if(map.getSource("road-route"))map.getSource("road-route").setData(data);
 else drawRoadRoute({geometry,distance:0,duration:0});
 roadRouteStatus("固定路線導航：不會自動更改預設道路");
}
function distanceToFixedRoute(position){
 const coordinates=active()?.fixedGeometry?.coordinates||[];
 if(coordinates.length<2)return Infinity;
 const latScale=111320,lonScale=Math.cos(position.lat*Math.PI/180)*111320;
 let min=Infinity,closest=fixedProgress;
 for(let i=Math.max(0,fixedProgress-10);i<coordinates.length-1;i++){
  const a=coordinates[i],b=coordinates[i+1];
  const ax=(a[0]-position.lng)*lonScale,ay=(a[1]-position.lat)*latScale;
  const bx=(b[0]-position.lng)*lonScale,by=(b[1]-position.lat)*latScale;
  const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));
  const d=Math.hypot(ax+t*dx,ay+t*dy);
  if(d<min){min=d;closest=i;}
 }
 if(min<35)fixedProgress=Math.max(fixedProgress,closest);
 return min;
}
async function acquireWakeLock(){
 if(!navigating||document.visibilityState!=="visible")return;
 try{
  if(!("wakeLock" in navigator))throw Error("unsupported");
  wakeLock=await navigator.wakeLock.request("screen");
  $("wakeStatus").textContent="螢幕保持開啟";
 }catch(error){
  $("wakeStatus").textContent="無法保持亮屏，請檢查瀏覽器與省電設定";
  console.warn("Wake Lock",error);
 }
}
function releaseWakeLock(){
 if(wakeLock){wakeLock.release().catch(()=>{});wakeLock=null;}
 $("wakeStatus").textContent="";
}
document.addEventListener("visibilitychange",()=>{
 if(navigating&&document.visibilityState==="visible")acquireWakeLock();
});

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
  document.body.classList.add("navigation-active");
  if (document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
  setTimeout(() => map?.resize(), 120);
  navigating = true; deviationCount=0;fixedProgress=0;lastDeviationAlert=0; $("navAlert").textContent=""; acquireWakeLock(); navIndex = 0; lastRouteTarget = null; lastRoutePosition = null; currentPosition = null; smoothedHeading = null; $("navPanel").hidden = false; $("selectionCard").hidden = true;
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
  const fixed = route.mode!=="dynamic" && route.fixedGeometry;
  if(fixed){
    const off=distanceToFixedRoute(currentPosition);
    const accuracy=currentPosition.accuracy;
    if(Number.isFinite(accuracy)&&accuracy<=35&&off>Math.max(45,accuracy*1.8))deviationCount++;
    else deviationCount=0;
    if(deviationCount>=3){
      $("navAlert").textContent="已偏離固定路線約 "+Math.round(off)+" 公尺，請注意行車安全";
      if(Date.now()-lastDeviationAlert>30000){lastDeviationAlert=Date.now();navigator.vibrate?.([200,100,200]);}
    }else $("navAlert").textContent="";
  }
  const distance = distanceMeters(currentPosition, target);
  $("navDistance").textContent = distance < 1000 ? Math.round(distance) + " m" : (distance / 1000).toFixed(1) + " km";
  if (distance <= ARRIVAL_METERS && Number.isFinite(currentPosition.accuracy) && currentPosition.accuracy <= ARRIVAL_METERS) { navIndex++; lastRouteTarget = null; lastRoutePosition = null; scheduleRoadRoute(); updateNavigation(); return; }
  const now = Date.now();
  if (lastRouteTarget !== target.id || !lastRoutePosition || (now - lastRouteTime >= 15000 && distanceMeters(lastRoutePosition, currentPosition) >= 35)) {
    lastRouteTarget = target.id;
    lastRoutePosition = { lat: currentPosition.lat, lng: currentPosition.lng };
    lastRouteTime = now;
    scheduleRoadRoute();
  }
  if (map) {
    const gpsHeading = Number.isFinite(currentPosition.heading) && (currentPosition.speed === null || currentPosition.speed > 0.8) ? currentPosition.heading : null;
    const rawHeading = gpsHeading ?? deviceHeading;
    const bearing = headingUp && rawHeading !== null ? smoothHeading(rawHeading) : 0;
    map.easeTo({ center: [currentPosition.lng, currentPosition.lat], zoom: 17, bearing, duration: 500, essential: true });
  }
}

function finishNavigation(done = false) {
  document.body.classList.remove("navigation-active");
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  setTimeout(() => map?.resize(), 120);
  releaseWakeLock();$("navAlert").textContent="";
  navigating = false; smoothedHeading = null; lastRouteTarget = null; lastRoutePosition = null;
  if (map) map.easeTo({ bearing: 0, duration: 400 });
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  $("navPanel").hidden = true; render(); if (done) alert("路線已完成");
}
function googleNav(point) {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1"); url.searchParams.set("destination", point.lat + "," + point.lng); url.searchParams.set("travelmode", "driving");
  window.open(url, "_blank", "noopener");
}

function cancelSelected(){selected=undefined;if(selectedMarker){selectedMarker.remove();selectedMarker=null;} $("selectionCard").hidden=true;}
$("cancelSelectedBtn").onclick = cancelSelected;
$("addTurnCandidateBtn").onclick = () => {
 const route=active();if(!route||!selected||route.waypoints.length<2)return;
 const answer=prompt("要在哪個停靠點之後折返？請輸入站點編號（例如 4）",String(route.waypoints.length-1));
 if(answer===null)return;
 const index=Number(answer)-1;
 if(!Number.isInteger(index)||index<0||index>=route.waypoints.length-1){alert("請輸入有效的停靠點編號");return;}
 const from=route.waypoints[index],to=route.waypoints[index+1];
 route.turnCandidates ||= {};
 route.turnCandidates[viaKey(from,to)]={lat:selected.lat,lng:selected.lng};
 cancelSelected();save();
};

$("addSelectedBtn").onclick = () => {
  const route = active(); if (!route || !selected) return;
  invalidateFixedRoute();
  route.waypoints.push({ id: uid(), ...selected }); selected = undefined;
  if (selectedMarker) { selectedMarker.remove(); selectedMarker = null; }
  $("selectionCard").hidden = true; save();
};
$("startNavBtn").onclick = startNavigation;
$("saveFixedBtn").onclick=()=>{const route=active();if(!route||!fixedRouteDraft)return;route.fixedGeometry=structuredClone(fixedRouteDraft);route.mode="fixed";save();};
$("modeBtn").onclick=()=>{const route=active();if(!route)return;route.mode=route.mode==="dynamic"?"fixed":"dynamic";save();};
$("routesToggleBtn").onclick=()=>document.body.classList.toggle("routes-open");
$("queueToggleBtn").onclick=()=>setSheetOpen(!sheet.classList.contains("sheet-open"));
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
const sheet = document.querySelector(".workspace");
const sheetHandle = $("sheetHandle");
function setSheetOpen(open) {
  sheet.classList.toggle("sheet-open", open);
  sheetHandle.setAttribute("aria-expanded", String(open));
  $("sheetLabel").textContent = open ? "收合路線隊列" : (active()?.waypoints.length || 0) + " 個停靠點 · 點擊展開";
  setTimeout(() => map?.resize(), 240);
}
sheetHandle.onclick = () => setSheetOpen(!sheet.classList.contains("sheet-open"));
let touchStartY = null;
sheetHandle.addEventListener("touchstart", e => { touchStartY = e.touches[0].clientY; }, { passive: true });
sheetHandle.addEventListener("touchend", e => {
  if (touchStartY === null) return;
  const delta = e.changedTouches[0].clientY - touchStartY;
  touchStartY = null;
  if (Math.abs(delta) > 30) setSheetOpen(delta < 0);
}, { passive: true });

render();
loadMapLibrary();
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(error => console.warn("Service worker", error)));
