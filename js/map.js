// ─── MAP VARIABLES ────────────────────────────────────────
let map = null;
let markers = {};
let satelliteMode = false;

// Map tile layers
const TILES = {
  street: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
};

const ATTRIBUTION = '© <a href="https://openstreetmap.org">OpenStreetMap</a>';

// Default center — GEHU Dehradun
const DEFAULT_CENTER = [30.3165, 78.0322];
const DEFAULT_ZOOM   = 15;

// ─── INIT MAP ─────────────────────────────────────────────
function initMap(elementId = "map") {
  window._map = map = L.map(elementId, {
    center: DEFAULT_CENTER,
    zoom:   DEFAULT_ZOOM,
    zoomControl: true,
  });

  L.tileLayer(TILES.street, {
    attribution: ATTRIBUTION,
    maxZoom: 19,
  }).addTo(map);

  console.log("✅ Map initialized");
  return map;
}

// ─── ADD ALERT MARKER ─────────────────────────────────────
function addAlertMarker(alert) {
  if (!map) return;
  if (!alert.lat || !alert.lng) return;

  // Remove existing marker for same alert
  if (markers[alert.id]) {
    map.removeLayer(markers[alert.id]);
  }

  // Custom red pulsing icon
  const icon = L.divIcon({
    className: "",
    html: `<div class="alert-marker"></div>`,
    iconSize:   [16, 16],
    iconAnchor: [8, 8],
    popupAnchor:[0, -12],
  });

  const marker = L.marker([alert.lat, alert.lng], { icon })
    .addTo(map)
    .bindPopup(buildPopup(alert));

  markers[alert.id] = marker;
  return marker;
}

// ─── BUILD POPUP HTML ─────────────────────────────────────
function buildPopup(alert) {
  return `
    <div>
      <div class="popup-id">${alert.id}</div>
      <div class="popup-user">👤 ${alert.name || "Anonymous"}</div>
      <div class="popup-time">🕐 ${alert.timeStr || ""}</div>
      <div class="popup-coord">📍 ${alert.lat.toFixed(5)}, ${alert.lng.toFixed(5)}</div>
      <div style="margin-top:6px;">
        <span style="
          background:rgba(255,45,85,0.15);
          color:#ff2d55;
          font-size:10px;
          padding:2px 8px;
          border-radius:4px;
          text-transform:uppercase;
          letter-spacing:.08em;
        ">${alert.status || "new"}</span>
      </div>
    </div>
  `;
}

// ─── REMOVE MARKER ────────────────────────────────────────
function removeMarker(alertId) {
  if (markers[alertId]) {
    map.removeLayer(markers[alertId]);
    delete markers[alertId];
  }
}

// ─── CLEAR ALL MARKERS ────────────────────────────────────
function clearAllMarkers() {
  Object.keys(markers).forEach(id => removeMarker(id));
}

// ─── FLY TO ALERT ─────────────────────────────────────────
function flyToAlert(alert) {
  if (!map || !alert.lat || !alert.lng) return;
  map.flyTo([alert.lat, alert.lng], 17, { duration: 1.2 });
  if (markers[alert.id]) {
    setTimeout(() => markers[alert.id].openPopup(), 1300);
  }
}

// ─── CENTER MAP ───────────────────────────────────────────
function centerMap() {
  if (!map) return;
  map.flyTo(DEFAULT_CENTER, DEFAULT_ZOOM, { duration: 1 });
}

// ─── TOGGLE SATELLITE ─────────────────────────────────────
function toggleSatellite() {
  if (!map) return;
  satelliteMode = !satelliteMode;

  // Remove all existing tile layers
  map.eachLayer(layer => {
    if (layer instanceof L.TileLayer) map.removeLayer(layer);
  });

  // Add new tile layer
  L.tileLayer(satelliteMode ? TILES.satellite : TILES.street, {
    attribution: ATTRIBUTION,
    maxZoom: 19,
  }).addTo(map);
}

// ─── GET USER LOCATION ────────────────────────────────────
function getUserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation not supported"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      }),
      err => reject(err),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}