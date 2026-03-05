// ─── STATE ────────────────────────────────────────────────
let userLocation  = null;
let alertCount    = 0;
let lastAlertTime = null;
let isAlertSent   = false;
let currentUser   = null;

// ─── ON PAGE LOAD ─────────────────────────────────────────
window.addEventListener("load", async () => {
  // Check session — redirect to login if not logged in
  currentUser = getSession();
  if (!currentUser || currentUser.role !== "student") {
    window.location.href = "login.html";
    return;
  }

  // Show student name in nav
  updateNavUser();

  await setupFirebase();
  await acquireLocation();
  loadLocalHistory();
});

// ─── UPDATE NAV WITH USER ─────────────────────────────────
function updateNavUser() {
  const nav = document.querySelector("nav");

  const userChip = document.createElement("div");
  userChip.style.cssText = `display:flex; align-items:center; gap:10px;`;
  userChip.innerHTML = `
    <div class="chip" style="border-color:var(--blue);color:var(--blue);">
      <span class="chip-dot"></span>
      <span>${currentUser.name} · ${currentUser.studentId}</span>
    </div>
    <button class="btn btn-ghost" onclick="logout()"
      style="font-size:12px;padding:6px 14px;">
      Logout
    </button>
  `;

  const lastItem = nav.lastElementChild;
  nav.insertBefore(userChip, lastItem);
}

// ─── SETUP FIREBASE ───────────────────────────────────────
async function setupFirebase() {
  try {
    await initFirebase();
    updateChip("connected", "CONNECTED");

    // Init notifications + listen for alerts on all tabs
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
    locText.textContent =
      `${userLocation.lat.toFixed(5)}, ${userLocation.lng.toFixed(5)}`;
    locBar.classList.add("acquired");
    setStatus("📍 Location acquired — ready to send alert", "success");
  } catch (err) {
    locText.textContent = "Location unavailable";
    setStatus("⚠️ Enable location for accurate alerts", "error");
    // Fallback to campus center
    userLocation = { lat: 30.3165, lng: 78.0322, accuracy: 999 };
  }
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

  // Refresh location before sending
  try {
    userLocation = await getUserLocation();
  } catch (_) { /* use cached */ }

  // Build full alert object with student details
  const alert = {
    id:               generateAlertId(),

    // Student info from session
    name:             currentUser.name,
    studentId:        currentUser.studentId,
    course:           currentUser.course,
    section:          currentUser.section,
    phone:            currentUser.phone,
    emergencyContact: currentUser.emergencyContact,

    // Location
    lat:              userLocation.lat,
    lng:              userLocation.lng,
    accuracy:         userLocation.accuracy || 0,

    // Meta
    status:           "new",
    timestamp:        new Date(),
    timeStr:          new Date().toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true
    }),
    dateStr: new Date().toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric"
    })
  };

  // Send to Firebase
  try {
    if (window.db) {
      await window.db
        .collection(ALERTS_COLLECTION)
        .doc(alert.id)
        .set({
          ...alert,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

      setStatus(`✅ Alert sent! ID: ${alert.id} — Help is on the way.`, "success");

      // Broadcast notification to all devices
      await broadcastAlert(alert);

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

  // Update UI cards
  alertCount++;
  lastAlertTime = alert.timeStr;

  document.getElementById("cardStatus").textContent = "ALERT SENT";
  document.getElementById("cardStatus").style.color = "var(--red)";
  document.getElementById("cardCount").textContent  = alertCount;
  document.getElementById("cardTime").textContent   = lastAlertTime;

  // Button sent state
  btn.classList.add("sent");
  btn.innerHTML = `
    <span class="btn-label">✓</span>
    <span class="btn-sub">SENT</span>
  `;

  // Pulse rings + glow
  document.getElementById("sosWrapper").classList.add("pulsing");
  document.getElementById("bgGlow").classList.add("active");

  // Save to local history
  saveToHistory(alert);

  // Reset after 10 seconds
  setTimeout(() => resetButton(), 10000);
}

// ─── RESET BUTTON ─────────────────────────────────────────
function resetButton() {
  const btn    = document.getElementById("sosBtn");
  isAlertSent  = false;
  btn.disabled = false;
  btn.classList.remove("sent");
  btn.innerHTML = `
    <span class="btn-label">SOS</span>
    <span class="btn-sub">TAP TO ALERT</span>
  `;
  document.getElementById("sosWrapper").classList.remove("pulsing");
  document.getElementById("bgGlow").classList.remove("active");
  document.getElementById("cardStatus").textContent = "SAFE";
  document.getElementById("cardStatus").style.color = "var(--text)";
  setStatus("Ready — tap SOS to send a new alert", "");
}

// ─── SAVE TO LOCAL HISTORY ────────────────────────────────
function saveToHistory(alert) {
  const history = JSON.parse(localStorage.getItem("alertHistory") || "[]");
  history.unshift(alert);
  history.splice(10);
  localStorage.setItem("alertHistory", JSON.stringify(history));
  renderHistory(history);
}

// ─── LOAD LOCAL HISTORY ───────────────────────────────────
function loadLocalHistory() {
  const history = JSON.parse(localStorage.getItem("alertHistory") || "[]");
  if (history.length > 0) {
    alertCount = history.length;
    document.getElementById("cardCount").textContent = alertCount;
    renderHistory(history);
  }
}

// ─── RENDER HISTORY ───────────────────────────────────────
function renderHistory(history) {
  const list = document.getElementById("historyList");

  if (history.length === 0) {
    list.innerHTML = `
      <div style="color:var(--muted);font-size:12px;
           font-family:var(--font-mono);padding:16px 0;">
        No alerts sent yet.
      </div>`;
    return;
  }

  list.innerHTML = history.map(a => `
    <div class="history-item">
      <div class="history-dot"></div>
      <div>
        <div style="font-size:12px;color:var(--text);">${a.id}</div>
        <div style="font-size:11px;color:var(--muted);">
          ${a.lat?.toFixed(4)}, ${a.lng?.toFixed(4)}
        </div>
      </div>
      <div class="history-time">${a.timeStr}</div>
    </div>
  `).join("");
}

// ─── UI HELPERS ───────────────────────────────────────────
function setStatus(msg, type = "") {
  const el       = document.getElementById("statusMsg");
  el.textContent = msg;
  el.className   = `status-msg ${type}`;
}

function updateChip(type, text) {
  const chip       = document.getElementById("statusChip");
  const span       = document.getElementById("statusText");
  chip.className   = `chip ${type}`;
  span.textContent = text;
}

// ─── LOGOUT ───────────────────────────────────────────────
function logout() {
  const confirmed = confirm("Logout from CampusShield?");
  if (!confirmed) return;
  clearSession();
  window.location.href = "login.html";
}