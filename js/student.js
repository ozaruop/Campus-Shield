// ─── STATE ────────────────────────────────────────────────
let userLocation  = null;
let alertCount    = 0;
let lastAlertTime = null;
let isAlertSent   = false;
let currentUser   = null;

// ─── SESSION HELPERS (localStorage = persistent) ──────────
function getSession() {
  try { return JSON.parse(localStorage.getItem("campusShieldUser")); }
  catch { return null; }
}
function clearSession() { localStorage.removeItem("campusShieldUser"); }

// ─── ON PAGE LOAD ─────────────────────────────────────────
window.addEventListener("load", async () => {
  currentUser = getSession();
  if (!currentUser || currentUser.role !== "student") {
    window.location.href = "login.html";
    return;
  }

  updateNavUser();
  await setupFirebase();
  await acquireLocation();
  loadLocalHistory();
});

// ─── UPDATE NAV WITH USER ─────────────────────────────────
function updateNavUser() {
  const nav = document.querySelector("nav");

  // Build compact user chip
  const userChip = document.createElement("div");
  userChip.className = "nav-right";
  userChip.innerHTML = `
    <div class="chip connected" style="max-width:180px; overflow:hidden;">
      <span class="chip-dot"></span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        ${currentUser.name.split(" ")[0]} · ${currentUser.studentId}
      </span>
    </div>
    <button class="btn btn-ghost" onclick="logout()" style="font-size:12px;padding:7px 12px;" title="Logout">
      <span>↩</span>
      <span class="btn-label-text">Logout</span>
    </button>
  `;

  const lastItem = nav.lastElementChild;
  nav.insertBefore(userChip, lastItem);
  nav.removeChild(lastItem); // remove old admin link
}

// ─── SETUP FIREBASE ───────────────────────────────────────
async function setupFirebase() {
  try {
    await initFirebase();
    updateChip("connected", "CONNECTED");
    await initNotifications();
    listenForNewAlerts();
  } catch (err) {
    console.error("Firebase error:", err);
    updateChip("demo", "OFFLINE MODE");
  }
}

// ─── ACQUIRE LOCATION ─────────────────────────────────────
async function acquireLocation() {
  const locBar  = document.getElementById("locationBar");
  const locText = document.getElementById("locationText");
  locText.textContent = "Acquiring GPS...";

  try {
    userLocation = await getUserLocation();
    locText.textContent = `${userLocation.lat.toFixed(5)}, ${userLocation.lng.toFixed(5)}`;
    locBar.classList.add("acquired");
    setStatus("📍 Location acquired — ready to send alert", "success");
  } catch (err) {
    locText.textContent = "Location unavailable";
    setStatus("⚠️ Enable location for accurate alerts", "error");
    userLocation = { lat: 30.3165, lng: 78.0322, accuracy: 999 };
  }

  // Register presence with current location so proximity alerts can reach this user
  await registerPresence(userLocation.lat, userLocation.lng);
  // Start listening for proximity alerts directed at this session
  listenForProximityAlerts();
  // Show how many users are online nearby
  updateNearbyCount(userLocation.lat, userLocation.lng);
}

// ─── TRIGGER ALERT ────────────────────────────────────────
async function triggerAlert() {
  const btn = document.getElementById("sosBtn");
  if (isAlertSent) return;

  const confirmed = confirm(
    `⚠️ Send SOS Alert?\n\nThis will notify campus security with your location and identity.\n\nStudent: ${currentUser.name}\nID: ${currentUser.studentId}`
  );
  if (!confirmed) return;

  isAlertSent  = true;
  btn.disabled = true;
  setStatus("📡 Sending alert...", "loading");

  try { userLocation = await getUserLocation(); } catch (_) {}

  const alert = {
    id:               generateAlertId(),
    name:             currentUser.name,
    studentId:        currentUser.studentId,
    course:           currentUser.course,
    section:          currentUser.section,
    phone:            currentUser.phone,
    emergencyContact: currentUser.emergencyContact,
    lat:              userLocation.lat,
    lng:              userLocation.lng,
    accuracy:         userLocation.accuracy || 0,
    status:           "new",
    timestamp:        new Date(),
    timeStr:          new Date().toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true
    }),
    dateStr: new Date().toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric"
    })
  };

  try {
    if (window.db) {
      await window.db
        .collection(ALERTS_COLLECTION)
        .doc(alert.id)
        .set({ ...alert, timestamp: firebase.firestore.FieldValue.serverTimestamp() });

      setStatus(`✅ Alert sent! ID: ${alert.id} — Help is on the way.`, "success");
      await broadcastProximityAlert(alert);
    } else {
      setStatus(`✅ Alert sent (offline)! ID: ${alert.id}`, "success");
    }
  } catch (err) {
    console.error("Send error:", err);
    setStatus("❌ Failed to send. Try again.", "error");
    isAlertSent  = false;
    btn.disabled = false;
    return;
  }

  alertCount++;
  lastAlertTime = alert.timeStr;

  document.getElementById("cardStatus").textContent = "ALERT";
  document.getElementById("cardStatus").style.color = "var(--red)";
  document.getElementById("cardCount").textContent  = alertCount;
  document.getElementById("cardTime").textContent   = lastAlertTime;

  btn.classList.add("sent");
  btn.innerHTML = `<span class="btn-label">✓</span><span class="btn-sub">SENT</span>`;

  document.getElementById("sosWrapper").classList.add("pulsing");
  document.getElementById("bgGlow").classList.add("active");

  saveToHistory(alert);
  setTimeout(() => resetButton(), 10000);
}

// ─── RESET BUTTON ─────────────────────────────────────────
function resetButton() {
  const btn = document.getElementById("sosBtn");
  isAlertSent  = false;
  btn.disabled = false;
  btn.classList.remove("sent");
  btn.innerHTML = `<span class="btn-label">SOS</span><span class="btn-sub">TAP TO ALERT</span>`;
  document.getElementById("sosWrapper").classList.remove("pulsing");
  document.getElementById("bgGlow").classList.remove("active");
  document.getElementById("cardStatus").textContent = "SAFE";
  document.getElementById("cardStatus").style.color = "var(--text)";
  setStatus("Ready — tap SOS to send a new alert", "");
}

// ─── HISTORY ──────────────────────────────────────────────
function saveToHistory(alert) {
  const history = JSON.parse(localStorage.getItem("alertHistory") || "[]");
  history.unshift(alert);
  history.splice(10);
  localStorage.setItem("alertHistory", JSON.stringify(history));
  renderHistory(history);
}

function loadLocalHistory() {
  const history = JSON.parse(localStorage.getItem("alertHistory") || "[]");
  if (history.length > 0) {
    alertCount = history.length;
    document.getElementById("cardCount").textContent = alertCount;
    renderHistory(history);
  }
}

function renderHistory(history) {
  const list = document.getElementById("historyList");
  if (history.length === 0) {
    list.innerHTML = `<div style="color:var(--muted);font-size:12px;font-family:var(--font-mono);padding:16px 0;">No alerts sent yet.</div>`;
    return;
  }
  list.innerHTML = history.map(a => `
    <div class="history-item">
      <div class="history-dot"></div>
      <div>
        <div style="font-size:12px;color:var(--text);">${a.id}</div>
        <div style="font-size:11px;color:var(--muted);">${a.lat?.toFixed(4)}, ${a.lng?.toFixed(4)}</div>
      </div>
      <div class="history-time">${a.timeStr}</div>
    </div>
  `).join("");
}

// ─── UI HELPERS ───────────────────────────────────────────
function setStatus(msg, type = "") {
  const el = document.getElementById("statusMsg");
  el.textContent = msg;
  el.className   = `status-msg ${type}`;
}

function updateChip(type, text) {
  const chip = document.getElementById("statusChip");
  const span = document.getElementById("statusText");
  chip.className   = `chip ${type}`;
  span.textContent = text;
}

// ─── LOGOUT ───────────────────────────────────────────────
function logout() {
  if (!confirm("Logout from CampusShield?")) return;
  clearSession();
  window.location.href = "login.html";
}

// ─── NEARBY USER COUNT ────────────────────────────────────
// Queries active presence docs and counts users within PROXIMITY_RADIUS_KM.
// Updates the "Nearby Online" info card.
async function updateNearbyCount(lat, lng) {
  const card = document.getElementById("cardNearby");
  if (!card || !window.db) return;

  try {
    const snapshot = await window.db
      .collection(PRESENCE_COLLECTION)
      .where("active", "==", true)
      .get();

    let count = 0;
    const myId = sessionStorage.getItem("presenceId");
    snapshot.forEach(doc => {
      const p = doc.data();
      if (p.presenceId === myId) return; // skip self
      const dist = haversineKm(lat, lng, p.lat, p.lng);
      if (dist <= PROXIMITY_RADIUS_KM) count++;
    });

    card.textContent = count > 0 ? count : "0";
    card.style.color = count > 0 ? "var(--text)" : "var(--muted)";
    card.title = `${count} logged-in user(s) within ${PROXIMITY_RADIUS_KM} km — will be alerted if you press SOS`;
  } catch (err) {
    card.textContent = "—";
  }
}
