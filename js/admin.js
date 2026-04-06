// ─── STATE ────────────────────────────────────────────────
let allAlerts      = {};
let selectedAlert  = null;
let currentFilter  = "all";
let routingControl = null;
let adminLocation  = null;

// ─── ON PAGE LOAD ─────────────────────────────────────────
window.addEventListener("load", async () => {
  // Check session — redirect to login if not admin
  const session = getSession();
  if (!session || session.role !== "admin") {
    window.location.href = "login.html";
    return;
  }

  // Load Leaflet Routing Machine script
  await loadRoutingScript();

  initMap("map");
  startClock();
  getAdminLocation();
  await setupAdminFirebase();
});

// ─── LOAD ROUTING SCRIPT ──────────────────────────────────
function loadRoutingScript() {
  return new Promise((resolve) => {
    // Load routing CSS
    const link  = document.createElement("link");
    link.rel    = "stylesheet";
    link.href   = "https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.css";
    document.head.appendChild(link);

    // Load routing JS
    const script = document.createElement("script");
    script.src   = "https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.min.js";
    script.onload = resolve;
    document.head.appendChild(script);
  });
}

// ─── GET ADMIN LOCATION ───────────────────────────────────
function getAdminLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    pos => {
      adminLocation = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude
      };
      console.log("✅ Admin location acquired");
      // Register admin presence so they appear in proximity calculations
      registerPresence(adminLocation.lat, adminLocation.lng);
      listenForProximityAlerts();
    },
    () => {
      adminLocation = { lat: 30.3165, lng: 78.0322 };
      registerPresence(adminLocation.lat, adminLocation.lng);
      listenForProximityAlerts();
    }
  );
}

// ─── SETUP FIREBASE ───────────────────────────────────────
async function setupAdminFirebase() {
  try {
    await initFirebase();
    updateAdminChip("connected", "LIVE");
    listenForAlerts();
  } catch (err) {
    console.error("Firebase error:", err);
    updateAdminChip("demo", "OFFLINE");
  }
}

// ─── LISTEN FOR REAL-TIME ALERTS ──────────────────────────
function listenForAlerts() {
  if (!window.db) return;

  window.db
    .collection(ALERTS_COLLECTION)
    .orderBy("timestamp", "desc")
    .onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        const data = { id: change.doc.id, ...change.doc.data() };

        if (data.timestamp) {
          data.timeStr = formatTime(data.timestamp);
          data.dateStr = formatDate(data.timestamp);
        }

        if (change.type === "added") {
          allAlerts[data.id] = data;
          addAlertMarker(data);
          setTimeout(() => flashAlert(data.id), 100);

          // Play sound for new alert
          playAlertSound();
        }

        if (change.type === "modified") {
          allAlerts[data.id] = data;
          addAlertMarker(data);

          // Update detail panel if this alert is selected
          if (selectedAlert?.id === data.id) {
            selectedAlert = data;
            renderDetailPanel(data);
          }
        }

        if (change.type === "removed") {
          delete allAlerts[data.id];
          removeMarker(data.id);
        }
      });

      renderAlertsList();
      updateStats();
      updateMapChip();
    });
}

// ─── RENDER ALERTS LIST ───────────────────────────────────
function renderAlertsList() {
  const list = document.getElementById("alertsList");

  const filtered = Object.values(allAlerts).filter(a => {
    if (currentFilter === "all")      return true;
    if (currentFilter === "new")      return a.status === "new";
    if (currentFilter === "active")   return a.status === "active";
    if (currentFilter === "resolved") return a.status === "resolved";
    return true;
  });

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📡</div>
        <span>No alerts found</span>
      </div>`;
    return;
  }

  list.innerHTML = filtered.map(a => `
    <div
      class="alert-item ${selectedAlert?.id === a.id ? "selected" : ""}"
      id="item-${a.id}"
      onclick="selectAlert('${a.id}')"
    >
      <div class="alert-item-top">
        <span class="alert-id">${a.id}</span>
        <span class="alert-time">${a.timeStr || "—"}</span>
      </div>
      <div class="alert-user">👤 ${a.name || "Anonymous"}</div>
      <div class="alert-coords" style="font-size:11px;margin-top:2px;">
        🎓 ${a.course || "—"} ${a.section ? "· " + a.section : ""}
      </div>
      <div class="alert-coords">
        📍 ${a.lat?.toFixed(5) || "—"}, ${a.lng?.toFixed(5) || "—"}
      </div>
      <span class="alert-badge ${a.status || "new"}">
        ${a.status || "new"}
      </span>
    </div>
  `).join("");
}

// ─── SELECT ALERT ─────────────────────────────────────────
function selectAlert(id) {
  selectedAlert = allAlerts[id];
  if (!selectedAlert) return;

  // Fly map to alert
  flyToAlert(selectedAlert);

  // Draw route
  drawRoute(selectedAlert);

  // Render full detail panel
  renderDetailPanel(selectedAlert);

  // Re-render list
  renderAlertsList();
}

// ─── DRAW ROUTE TO STUDENT ────────────────────────────────
function drawRoute(alert) {
  if (!map || !alert.lat || !alert.lng) return;

  // Remove existing route
  if (routingControl) {
    map.removeControl(routingControl);
    routingControl = null;
  }

  const from = adminLocation
    ? L.latLng(adminLocation.lat, adminLocation.lng)
    : L.latLng(30.3165, 78.0322); // campus default

  const to = L.latLng(alert.lat, alert.lng);

  routingControl = L.Routing.control({
    waypoints: [from, to],
    routeWhileDragging: false,
    addWaypoints: false,
    draggableWaypoints: false,
    fitSelectedRoutes: true,
    show: false, // hide text directions panel
    lineOptions: {
      styles: [
        { color: "#3d8bff", weight: 5, opacity: 0.8 },
        { color: "#ffffff", weight: 2, opacity: 0.3 }
      ]
    },
    createMarker: function(i, wp) {
      // Custom markers for route start/end
      const icon = L.divIcon({
        className: "",
        html: i === 0
          ? `<div style="
              width:14px;height:14px;
              background:#00e5a0;
              border:2px solid white;
              border-radius:50%;
              box-shadow:0 0 10px rgba(0,229,160,0.8);
            "></div>`
          : `<div class="alert-marker"></div>`,
        iconSize:   [14, 14],
        iconAnchor: [7, 7],
      });
      return L.marker(wp.latLng, { icon });
    }
  }).addTo(map);
}

// ─── CLEAR ROUTE ──────────────────────────────────────────
function clearRoute() {
  if (routingControl) {
    map.removeControl(routingControl);
    routingControl = null;
  }
}

// ─── RENDER DETAIL PANEL ──────────────────────────────────
function renderDetailPanel(a) {
  document.getElementById("detailId").textContent       = a.id;
  document.getElementById("detailUser").textContent     = a.name || "Anonymous";
  document.getElementById("detailLocation").textContent =
    `${a.lat?.toFixed(5)}, ${a.lng?.toFixed(5)}`;
  document.getElementById("detailTime").textContent     = a.timeStr || "—";
  document.getElementById("detailStatus").textContent   = a.status || "new";
  document.getElementById("detailStatus").style.color   =
    a.status === "resolved" ? "var(--green)" : "var(--red)";

  // Inject extra student info into panel
  const panel = document.getElementById("detailPanel");

  // Remove old extra fields if any
  const old = document.getElementById("extraStudentInfo");
  if (old) old.remove();

  const extra = document.createElement("div");
  extra.id    = "extraStudentInfo";
  extra.style.cssText = `
    display:flex; gap:20px; flex-wrap:wrap;
    padding-top:10px; margin-top:10px;
    border-top:1px solid var(--border);
    width:100%;
  `;
  extra.innerHTML = `
    <div class="detail-field">
      <span class="detail-label">Student ID</span>
      <span class="detail-value">${a.studentId || "—"}</span>
    </div>
    <div class="detail-field">
      <span class="detail-label">Course</span>
      <span class="detail-value">${a.course || "—"} ${a.section ? "· " + a.section : ""}</span>
    </div>
    <div class="detail-field">
      <span class="detail-label">Phone</span>
      <span class="detail-value text-green">${a.phone || "—"}</span>
    </div>
    <div class="detail-field">
      <span class="detail-label">Emergency</span>
      <span class="detail-value text-amber">${a.emergencyContact || "—"}</span>
    </div>
    <div class="detail-field">
      <span class="detail-label">Date</span>
      <span class="detail-value">${a.dateStr || "—"}</span>
    </div>
    <button
      class="btn btn-ghost"
      onclick="clearRoute()"
      style="font-size:11px;padding:6px 14px;margin-left:auto;align-self:center;">
      ✕ Clear Route
    </button>
  `;

  // Insert before resolve button
  const resolveBtn = document.getElementById("resolveBtn");
  panel.insertBefore(extra, resolveBtn);
}

// ─── RESOLVE SELECTED ALERT ───────────────────────────────
async function resolveSelected() {
  if (!selectedAlert) return;

  const id = selectedAlert.id;

  try {
    if (window.db) {
      await window.db
        .collection(ALERTS_COLLECTION)
        .doc(id)
        .update({ status: "resolved" });
    }

    if (allAlerts[id]) allAlerts[id].status = "resolved";

    document.getElementById("detailStatus").textContent = "resolved";
    document.getElementById("detailStatus").style.color = "var(--green)";

    // Clear route on resolve
    clearRoute();

    renderAlertsList();
    updateStats();

  } catch (err) {
    console.error("Resolve error:", err);
    alert("Failed to resolve. Try again.");
  }
}

// ─── FILTER ALERTS ────────────────────────────────────────
function filterAlerts(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll(".filter-btn")
    .forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderAlertsList();
}

// ─── CLEAR ALL ALERTS ─────────────────────────────────────
async function clearAllAlerts() {
  const confirmed = confirm("⚠️ Clear ALL alerts? This cannot be undone.");
  if (!confirmed) return;

  try {
    if (window.db) {
      const snapshot = await window.db.collection(ALERTS_COLLECTION).get();
      const batch    = window.db.batch();
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }

    allAlerts     = {};
    selectedAlert = null;
    clearAllMarkers();
    clearRoute();
    renderAlertsList();
    updateStats();
    updateMapChip();
    clearDetailPanel();

  } catch (err) {
    console.error("Clear error:", err);
    alert("Failed to clear alerts.");
  }
}

// ─── UPDATE STATS ─────────────────────────────────────────
function updateStats() {
  const alerts = Object.values(allAlerts);
  const total  = alerts.length;
  const active = alerts.filter(a => a.status !== "resolved").length;
  const today  = alerts.filter(a => isToday(a.timestamp)).length;

  document.getElementById("statTotal").textContent  = total;
  document.getElementById("statActive").textContent = active;
  document.getElementById("statToday").textContent  = today;

  updateAdminChip(
    active > 0 ? "alert-live" : "connected",
    active > 0 ? `${active} ACTIVE` : "LIVE"
  );
}

// ─── UPDATE MAP CHIP ──────────────────────────────────────
function updateMapChip() {
  const count = Object.keys(allAlerts).length;
  document.getElementById("mapAlertCount").textContent =
    `${count} alert${count !== 1 ? "s" : ""} on map`;
}

// ─── FLASH NEW ALERT ──────────────────────────────────────
function flashAlert(id) {
  const el = document.getElementById(`item-${id}`);
  if (el) {
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1000);
  }
}

// ─── PLAY ALERT SOUND ─────────────────────────────────────
function playAlertSound() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch (_) {}
}

// ─── CLEAR DETAIL PANEL ───────────────────────────────────
function clearDetailPanel() {
  ["detailId","detailUser","detailLocation","detailTime","detailStatus"]
    .forEach(id => document.getElementById(id).textContent = "—");
  const old = document.getElementById("extraStudentInfo");
  if (old) old.remove();
}

// ─── LIVE CLOCK ───────────────────────────────────────────
function startClock() {
  const el = document.getElementById("liveTime");
  function tick() {
    el.textContent = new Date().toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true
    });
  }
  tick();
  setInterval(tick, 1000);
}

// ─── UI HELPERS ───────────────────────────────────────────
function updateAdminChip(type, text) {
  const chip = document.getElementById("adminStatusChip");
  const span = document.getElementById("adminStatusText");
  chip.className   = `chip ${type}`;
  span.textContent = text;
}

// ─── LOGOUT ───────────────────────────────────────────────
function logout() {
  clearSession();
  window.location.href = "login.html";
}

// ─── SESSION HELPERS ──────────────────────────────────────
function getSession() {
  try {
    return JSON.parse(localStorage.getItem("campusShieldUser"));
  } catch { return null; }
}

function clearSession() {
  localStorage.removeItem("campusShieldUser");
}