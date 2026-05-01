// ─── STATE ────────────────────────────────────────────────
let allAlerts      = {};
let allTips        = {};
let selectedAlert  = null;
let currentFilter  = "all";
let routingControl = null;
let adminLocation  = null;
let heatLayer      = null;
let heatVisible    = false;

// ─── ON PAGE LOAD ─────────────────────────────────────────
window.addEventListener("load", async () => {
  const session = getSession();
  if (!session || session.role !== "admin") {
    window.location.href = "login.html";
    return;
  }

  await loadRoutingScript();
  await loadHeatScript();
  initMap("map");
  startClock();
  getAdminLocation();
  await setupAdminFirebase();
});

// ─── LOAD SCRIPTS ─────────────────────────────────────────
function loadRoutingScript() {
  return new Promise(resolve => {
    const link = document.createElement("link");
    link.rel   = "stylesheet";
    link.href  = "https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.css";
    document.head.appendChild(link);

    const script  = document.createElement("script");
    script.src    = "https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.min.js";
    script.onload = resolve;
    document.head.appendChild(script);
  });
}

function loadHeatScript() {
  return new Promise(resolve => {
    const script  = document.createElement("script");
    script.src    = "https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js";
    script.onload = resolve;
    script.onerror = resolve; // non-fatal
    document.head.appendChild(script);
  });
}

// ─── GET ADMIN LOCATION ───────────────────────────────────
function getAdminLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    pos => {
      adminLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
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
    listenForTips();
    listenForBroadcastHistory();
  } catch (err) {
    console.error("Firebase error:", err);
    updateAdminChip("demo", "OFFLINE");
  }
}

// ─── LISTEN FOR BROADCAST HISTORY (admin) ─────────────────
function listenForBroadcastHistory() {
  if (!window.db) return;
  window.db.collection("broadcast_messages")
    .orderBy("sentAt", "desc")
    .limit(10)
    .onSnapshot(snapshot => {
      const list = document.getElementById("broadcastHistory");
      if (!list) return;
      const msgs = snapshot.docs.map(doc => doc.data());
      if (msgs.length === 0) {
        list.innerHTML = '<div style="font-size:10px;color:var(--text-3);padding:4px 0;">No broadcasts sent yet.</div>';
        return;
      }
      list.innerHTML = msgs.map(m => {
        let timeStr = "—";
        if (m.sentAt) {
          const d = m.sentAt?.toDate ? m.sentAt.toDate() : new Date(m.sentAt);
          timeStr = d.toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit", hour12:true });
        }
        return `<div style="font-size:11px;color:var(--text-2);padding:3px 0;border-bottom:1px solid var(--border);
                            display:flex;justify-content:space-between;gap:8px;">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${m.message}</span>
          <span style="color:var(--text-3);font-family:var(--font-mono);flex-shrink:0;">${timeStr}</span>
        </div>`;
      }).join("");
    });
}

// ─── LISTEN FOR REAL-TIME ALERTS ──────────────────────────
function listenForAlerts() {
  if (!window.db) return;
  window.db.collection(ALERTS_COLLECTION).orderBy("timestamp", "desc")
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
          playAlertSound();
        }
        if (change.type === "modified") {
          allAlerts[data.id] = data;
          addAlertMarker(data);
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
      updateHeatmap();
    });
}

// ─── LISTEN FOR ANONYMOUS TIPS ────────────────────────────
function listenForTips() {
  if (!window.db) return;
  window.db.collection("anonymous_tips")
    .orderBy("submittedAt", "desc")
    .onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        const data = { id: change.doc.id, ...change.doc.data() };
        if (change.type === "added" || change.type === "modified") allTips[data.id] = data;
        if (change.type === "removed") delete allTips[data.id];
      });
      renderTipsList();
      updateTipsBadge();
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
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📡</div><span>No alerts found</span></div>`;
    return;
  }

  const TYPE_COLORS = {
    sos: "#ff2d55", medical: "#ff6b35", fire: "#ff9500",
    suspicious: "#ffb300", assault: "#cc1133", other: "#7c5af6",
  };

  list.innerHTML = filtered.map(a => `
    <div
      class="alert-item ${selectedAlert?.id === a.id ? "selected" : ""}"
      id="item-${a.id}"
      onclick="selectAlert('${a.id}')"
    >
      <div class="alert-item-top">
        <span class="alert-id">
          <span style="color:${TYPE_COLORS[a.alertType] || "#ff2d55"};">
            ${a.alertTypeEmoji || "🆘"}
          </span>
          ${a.id}
        </span>
        <span class="alert-time">${a.timeStr || "—"}</span>
      </div>
      <div class="alert-user">👤 ${a.name || "Anonymous"}</div>
      <div class="alert-coords" style="font-size:11px;margin-top:2px;">
        🎓 ${a.course || "—"} ${a.section ? "· " + a.section : ""}
        ${a.alertTypeLabel ? '<span style="margin-left:6px;opacity:0.7;">· ' + a.alertTypeLabel + "</span>" : ""}
      </div>
      <div class="alert-coords">📍 ${a.lat?.toFixed(5) || "—"}, ${a.lng?.toFixed(5) || "—"}</div>
      <span class="alert-badge ${a.status || "new"}">${a.status || "new"}</span>
    </div>
  `).join("");
}

// ─── RENDER TIPS LIST ─────────────────────────────────────
function renderTipsList() {
  const list = document.getElementById("tipsList");
  if (!list) return;
  const tips = Object.values(allTips);
  if (tips.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">👁</div><span>No tips yet</span></div>`;
    return;
  }
  list.innerHTML = tips.map(t => `
    <div class="tip-item ${t.status === "reviewed" ? "reviewed" : ""}">
      <div class="tip-top">
        <span class="tip-type">${t.tipType?.replace(/_/g," ") || "Other"}</span>
        <span class="tip-time">${t.submittedAt ? new Date(t.submittedAt).toLocaleTimeString("en-IN", {hour:"2-digit",minute:"2-digit",hour12:true}) : "—"}</span>
      </div>
      <div class="tip-desc">${t.description}</div>
      <div class="tip-loc">📍 ${t.locationDesc || "Location not specified"}</div>
      ${t.status !== "reviewed" ? `
        <button class="tip-resolve-btn" onclick="markTipReviewed('${t.id}')">
          ✓ Mark Reviewed
        </button>` : '<span class="tip-reviewed-label">✓ Reviewed</span>'}
    </div>
  `).join("");
}

async function markTipReviewed(tipId) {
  if (!window.db) return;
  try {
    await window.db.collection("anonymous_tips").doc(tipId).update({ status: "reviewed" });
  } catch (err) { console.error("Tip update error:", err); }
}

function updateTipsBadge() {
  const badge = document.getElementById("tipsBadge");
  if (!badge) return;
  const unread = Object.values(allTips).filter(t => t.status !== "reviewed").length;
  badge.textContent = unread > 0 ? unread : "";
  badge.style.display = unread > 0 ? "inline" : "none";
}

// ─── SELECT ALERT ─────────────────────────────────────────
function selectAlert(id) {
  selectedAlert = allAlerts[id];
  if (!selectedAlert) return;
  flyToAlert(selectedAlert);
  drawRoute(selectedAlert);
  renderDetailPanel(selectedAlert);
  renderAlertsList();
}

// ─── DRAW ROUTE ───────────────────────────────────────────
function drawRoute(alert) {
  if (!map || !alert.lat || !alert.lng) return;
  if (routingControl) { map.removeControl(routingControl); routingControl = null; }

  const from = adminLocation
    ? L.latLng(adminLocation.lat, adminLocation.lng)
    : L.latLng(30.3165, 78.0322);
  const to = L.latLng(alert.lat, alert.lng);

  routingControl = L.Routing.control({
    waypoints: [from, to],
    routeWhileDragging: false,
    addWaypoints: false,
    draggableWaypoints: false,
    fitSelectedRoutes: true,
    show: false,
    lineOptions: {
      styles: [
        { color: "#3d8bff", weight: 5, opacity: 0.8 },
        { color: "#ffffff", weight: 2, opacity: 0.3 }
      ]
    },
    createMarker: function(i, wp) {
      const icon = L.divIcon({
        className: "",
        html: i === 0
          ? `<div style="width:14px;height:14px;background:#00e5a0;border:2px solid white;border-radius:50%;box-shadow:0 0 10px rgba(0,229,160,0.8);"></div>`
          : `<div class="alert-marker"></div>`,
        iconSize: [14, 14], iconAnchor: [7, 7],
      });
      return L.marker(wp.latLng, { icon });
    }
  }).addTo(map);
}

function clearRoute() {
  if (routingControl) { map.removeControl(routingControl); routingControl = null; }
}

// ─── RENDER DETAIL PANEL ──────────────────────────────────
function renderDetailPanel(a) {
  document.getElementById("detailId").textContent       = (a.alertTypeEmoji || "🆘") + " " + a.id;
  document.getElementById("detailUser").textContent     = a.name || "Anonymous";
  document.getElementById("detailLocation").textContent = a.lat?.toFixed(5) + ", " + a.lng?.toFixed(5);
  document.getElementById("detailTime").textContent     = a.timeStr || "—";
  document.getElementById("detailStatus").textContent   = a.status || "new";
  document.getElementById("detailStatus").style.color   = a.status === "resolved" ? "var(--green)" : "var(--red)";

  const panel = document.getElementById("detailPanel");
  const old = document.getElementById("extraStudentInfo");
  if (old) old.remove();

  const extra = document.createElement("div");
  extra.id = "extraStudentInfo";
  extra.style.cssText = `display:flex;gap:20px;flex-wrap:wrap;padding-top:10px;margin-top:10px;border-top:1px solid var(--border);width:100%;`;
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
      <span class="detail-label">Alert Type</span>
      <span class="detail-value">${a.alertTypeEmoji || "🆘"} ${a.alertTypeLabel || "SOS"}</span>
    </div>
    <div class="detail-field">
      <span class="detail-label">Phone</span>
      <span class="detail-value text-green">${a.phone || "—"}</span>
    </div>
    <div class="detail-field">
      <span class="detail-label">Emergency Contact</span>
      <span class="detail-value text-amber">${a.emergencyContact || "—"}</span>
    </div>
    <div class="detail-field">
      <span class="detail-label">Date</span>
      <span class="detail-value">${a.dateStr || "—"}</span>
    </div>

    <!-- Reply to student -->
    <div style="width:100%;border-top:1px solid var(--border);padding-top:12px;margin-top:4px;">
      <div style="font-size:11px;color:var(--text-3);font-family:var(--font-mono);letter-spacing:.08em;margin-bottom:8px;">
        SEND MESSAGE TO STUDENT
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="quick-reply-btn" onclick="sendQuickReply('${a.studentId}', 'Help is on the way. ETA 5 minutes. Stay where you are.')">
          Help ETA 5 min
        </button>
        <button class="quick-reply-btn" onclick="sendQuickReply('${a.studentId}', 'Security team has been dispatched. Please stay calm.')">
          Team dispatched
        </button>
        <button class="quick-reply-btn" onclick="sendQuickReply('${a.studentId}', 'Alert received. Call 112 if situation worsens.')">
          Call 112 if worse
        </button>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <input id="customReplyInput" type="text" placeholder="Type a custom message..."
          style="flex:1;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;
                 padding:8px 12px;color:var(--text);font-size:12px;font-family:var(--font-ui);outline:none;"
          onkeydown="if(event.key==='Enter')sendCustomReply('${a.studentId}')"/>
        <button onclick="sendCustomReply('${a.studentId}')"
          style="padding:8px 14px;border-radius:8px;border:none;background:var(--blue);
                 color:white;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">
          Send
        </button>
      </div>
    </div>

    <button class="btn btn-ghost" onclick="clearRoute()"
      style="font-size:11px;padding:6px 14px;margin-left:auto;align-self:center;">
      ✕ Clear Route
    </button>
  `;

  const resolveBtn = document.getElementById("resolveBtn");
  panel.insertBefore(extra, resolveBtn);
}

// ─── REPLY TO STUDENT ─────────────────────────────────────
async function sendQuickReply(studentId, message) {
  await sendReplyToStudent(studentId, message);
  showReplyFeedback("✅ Message sent to student");
}

async function sendCustomReply(studentId) {
  const input   = document.getElementById("customReplyInput");
  const message = input.value.trim();
  if (!message) return;
  await sendReplyToStudent(studentId, message);
  input.value = "";
  showReplyFeedback("✅ Message sent");
}

async function sendReplyToStudent(studentId, message) {
  if (!window.db) return;
  try {
    await window.db.collection("admin_replies").add({
      studentId,
      message,
      adminName:  "Campus Security",
      sentAt:     firebase.firestore.FieldValue.serverTimestamp(),
      seen:       false,
    });
  } catch (err) { console.error("Reply error:", err); }
}

function showReplyFeedback(msg) {
  const old = document.getElementById("replyFeedback");
  if (old) old.remove();
  const el = document.createElement("div");
  el.id = "replyFeedback";
  el.style.cssText = `
    position:fixed;bottom:30px;left:50%;transform:translateX(-50%);
    background:#0d0f18;border:1px solid var(--green);border-radius:10px;
    padding:10px 20px;color:var(--green);font-size:13px;font-weight:600;
    z-index:99999;font-family:'Space Grotesk',sans-serif;
  `;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { if (el) el.remove(); }, 3000);
}

// ─── BROADCAST MESSAGE ────────────────────────────────────
async function sendBroadcast() {
  const input   = document.getElementById("broadcastInput");
  const message = input?.value?.trim();
  if (!message) return;

  if (!window.db) { showReplyFeedback("❌ Not connected to Firebase."); return; }

  const btn = document.querySelector(".broadcast-send-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Sending..."; }

  try {
    await window.db.collection("broadcast_messages").add({
      message,
      sentAt:    firebase.firestore.FieldValue.serverTimestamp(),
      adminName: "Campus Security",
    });
    input.value = "";
    showReplyFeedback("📢 Broadcast sent to all students!");
  } catch (err) {
    console.error("Broadcast error:", err);
    showReplyFeedback("❌ Broadcast failed: " + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Send"; }
  }
}

// ─── HEATMAP ──────────────────────────────────────────────
function toggleHeatmap() {
  if (!map || typeof L.heatLayer === "undefined") return;

  if (heatLayer) {
    map.removeLayer(heatLayer);
    heatLayer = null;
    heatVisible = false;
    document.getElementById("heatBtn").textContent = "🔥 Heatmap";
    return;
  }

  updateHeatmap();
  heatVisible = true;
  document.getElementById("heatBtn").textContent = "✕ Hide Heatmap";
}

function updateHeatmap() {
  if (!heatVisible || !map || typeof L.heatLayer === "undefined") return;

  const points = Object.values(allAlerts)
    .filter(a => a.lat && a.lng)
    .map(a => [a.lat, a.lng, 1.0]);

  if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
  if (points.length === 0) return;

  heatLayer = L.heatLayer(points, {
    radius: 30, blur: 20, maxZoom: 17,
    gradient: { 0.2: "#3d7fff", 0.5: "#ffb300", 0.8: "#ff6b35", 1.0: "#ff2d55" }
  }).addTo(map);
}

// ─── RESOLVE SELECTED ALERT ───────────────────────────────
async function resolveSelected() {
  if (!selectedAlert) return;
  const id = selectedAlert.id;
  try {
    if (window.db) {
      await window.db.collection(ALERTS_COLLECTION).doc(id).update({ status: "resolved" });
    }
    if (allAlerts[id]) allAlerts[id].status = "resolved";
    document.getElementById("detailStatus").textContent = "resolved";
    document.getElementById("detailStatus").style.color = "var(--green)";
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
  document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderAlertsList();
}

// ─── CLEAR ALL ────────────────────────────────────────────
async function clearAllAlerts() {
  if (!confirm("⚠️ Clear ALL alerts? This cannot be undone.")) return;
  try {
    if (window.db) {
      const snap  = await window.db.collection(ALERTS_COLLECTION).get();
      const batch = window.db.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
    allAlerts = {}; selectedAlert = null;
    clearAllMarkers(); clearRoute();
    renderAlertsList(); updateStats(); updateMapChip(); clearDetailPanel();
    if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
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
    active > 0 ? active + " ACTIVE" : "LIVE"
  );
}

function updateMapChip() {
  const count = Object.keys(allAlerts).length;
  document.getElementById("mapAlertCount").textContent = count + " alert" + (count !== 1 ? "s" : "") + " on map";
}

function flashAlert(id) {
  const el = document.getElementById("item-" + id);
  if (el) { el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1000); }
}

function playAlertSound() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.4);
  } catch (_) {}
}

function clearDetailPanel() {
  ["detailId","detailUser","detailLocation","detailTime","detailStatus"]
    .forEach(id => document.getElementById(id).textContent = "—");
  const old = document.getElementById("extraStudentInfo");
  if (old) old.remove();
}

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

function updateAdminChip(type, text) {
  const chip = document.getElementById("adminStatusChip");
  const span = document.getElementById("adminStatusText");
  chip.className   = "chip " + type;
  span.textContent = text;
}

function logout() { clearSession(); window.location.href = "login.html"; }

function getSession() {
  try { return JSON.parse(localStorage.getItem("campusShieldUser")); }
  catch { return null; }
}

function clearSession() { localStorage.removeItem("campusShieldUser"); }
