// ─── STATE ────────────────────────────────────────────────
let userLocation    = null;
let alertCount      = 0;
let lastAlertTime   = null;
let isAlertSent     = false;
let currentUser     = null;
let selectedAlertType = "sos";
let deadManTimer    = null;
let deadManInterval = null;
let deadManSeconds  = 0;
let deadManActive   = false;
let inboxOpen       = false;

// ─── SESSION HELPERS ──────────────────────────────────────
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
  renderAlertTypeButtons();
  renderInbox(); // render empty state
  await setupFirebase();
  await acquireLocation();
  loadLocalHistory();
  renderProtocols();
});

// ─── UPDATE NAV WITH USER ─────────────────────────────────
function updateNavUser() {
  const nav = document.querySelector("nav");
  const userChip = document.createElement("div");
  userChip.className = "nav-right";
  userChip.innerHTML = `
    <div class="chip connected" style="max-width:180px; overflow:hidden;">
      <span class="chip-dot"></span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        ${currentUser.name.split(" ")[0]} · ${currentUser.studentId}
      </span>
    </div>
    <button class="btn btn-ghost" onclick="toggleInbox()" id="inboxNavBtn"
      style="font-size:12px;padding:7px 12px;position:relative;" title="Messages">
      <span>📬</span>
      <span class="btn-label-text">Inbox</span>
      <span id="inboxBadge" style="display:none;position:absolute;top:2px;right:2px;
        background:var(--red);color:white;font-size:9px;font-weight:700;border-radius:50%;
        width:16px;height:16px;align-items:center;justify-content:center;line-height:16px;
        text-align:center;"></span>
    </button>
    <button class="btn btn-ghost" onclick="logout()" style="font-size:12px;padding:7px 12px;" title="Logout">
      <span>↩</span>
      <span class="btn-label-text">Logout</span>
    </button>
  `;
  const lastItem = nav.lastElementChild;
  nav.insertBefore(userChip, lastItem);
  nav.removeChild(lastItem);
}

// ─── INBOX TOGGLE ─────────────────────────────────────────
function toggleInbox() {
  const panel = document.getElementById("inboxPanel");
  if (!panel) return;
  inboxOpen = !inboxOpen;
  panel.style.display = inboxOpen ? "block" : "none";
  if (inboxOpen) {
    // Mark all as read visually
    inboxMessages.forEach(m => m.seen = true);
    renderInbox();
    updateInboxBadge();
  }
}

// ─── SETUP FIREBASE ───────────────────────────────────────
async function setupFirebase() {
  try {
    await initFirebase();
    updateChip("connected", "CONNECTED");
    // initNotifications is intentionally NOT awaited — notification
    // permission prompts can block indefinitely; Firebase is already
    // connected at this point so listeners start regardless.
    initNotifications().catch(err => console.warn("Notifications unavailable:", err));
    listenForNewAlerts();
    listenForAdminReplies();
    listenForBroadcasts();
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

  await registerPresence(userLocation.lat, userLocation.lng);
  listenForProximityAlerts();
  updateNearbyCount(userLocation.lat, userLocation.lng);
}

// ─── ALERT TYPE BUTTONS ───────────────────────────────────
const ALERT_TYPES = [
  { id: "sos",        emoji: "🆘", label: "SOS",        color: "#ff2d55", desc: "General emergency" },
  { id: "medical",    emoji: "🏥", label: "Medical",    color: "#ff6b35", desc: "Medical emergency" },
  { id: "fire",       emoji: "🔥", label: "Fire",       color: "#ff9500", desc: "Fire or smoke" },
  { id: "suspicious", emoji: "👁",  label: "Suspicious", color: "#ffb300", desc: "Suspicious activity" },
  { id: "assault",    emoji: "⚡", label: "Assault",    color: "#cc1133", desc: "Assault or harassment" },
  { id: "other",      emoji: "❗", label: "Other",      color: "#7c5af6", desc: "Other threat" },
];

function renderAlertTypeButtons() {
  const container = document.getElementById("alertTypes");
  if (!container) return;
  container.innerHTML = ALERT_TYPES.map(t => `
    <button
      class="alert-type-btn ${t.id === selectedAlertType ? "selected" : ""}"
      id="atype-${t.id}"
      onclick="selectAlertType('${t.id}')"
      title="${t.desc}"
      data-color="${t.color}"
    >
      <span class="atype-emoji">${t.emoji}</span>
      <span class="atype-label">${t.label}</span>
    </button>
  `).join("");
}

function selectAlertType(typeId) {
  selectedAlertType = typeId;
  document.querySelectorAll(".alert-type-btn").forEach(b => b.classList.remove("selected"));
  const btn = document.getElementById("atype-" + typeId);
  if (btn) btn.classList.add("selected");

  const type = ALERT_TYPES.find(t => t.id === typeId);
  const sosBtn = document.getElementById("sosBtn");
  if (type && sosBtn && !isAlertSent) {
    document.documentElement.style.setProperty("--current-alert-color", type.color);
    sosBtn.setAttribute("data-type-color", type.color);
  }
}

// ─── CONFIRM MODAL ────────────────────────────────────────
function showConfirmModal(title, message) {
  return new Promise(resolve => {
    const old = document.getElementById("confirmModal");
    if (old) old.remove();

    const modal = document.createElement("div");
    modal.id = "confirmModal";
    modal.style.cssText = `
      position:fixed;inset:0;z-index:99998;
      background:rgba(4,5,10,0.88);
      backdrop-filter:blur(14px);
      display:flex;align-items:center;justify-content:center;padding:20px;
    `;
    modal.innerHTML = `
      <div style="background:#0d0f18;border:1px solid rgba(255,255,255,0.1);border-radius:20px;
                  padding:28px;max-width:380px;width:100%;box-shadow:0 24px 80px rgba(0,0,0,0.6);">
        <div style="font-size:20px;font-weight:700;margin-bottom:10px;color:#eef0f8;">${title}</div>
        <div style="font-size:13px;color:#8891aa;line-height:1.7;white-space:pre-line;margin-bottom:22px;">${message}</div>
        <div style="display:flex;gap:10px;">
          <button id="modalCancel"
            style="flex:1;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);
                   background:transparent;color:#8891aa;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">
            Cancel
          </button>
          <button id="modalConfirm"
            style="flex:2;padding:12px;border-radius:10px;border:none;background:#ff2d55;
                   color:white;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;
                   box-shadow:0 4px 20px rgba(255,45,85,0.4);">
            Send Alert Now
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById("modalConfirm").onclick = () => { modal.remove(); resolve(true); };
    document.getElementById("modalCancel").onclick  = () => { modal.remove(); resolve(false); };
    modal.onclick = e => { if (e.target === modal) { modal.remove(); resolve(false); } };
  });
}

// ─── TRIGGER ALERT ────────────────────────────────────────
async function triggerAlert() {
  const btn = document.getElementById("sosBtn");
  if (isAlertSent) return;

  const type = ALERT_TYPES.find(t => t.id === selectedAlertType) || ALERT_TYPES[0];
  const confirmed = await showConfirmModal(
    type.emoji + " Send " + type.label + " Alert?",
    "This will notify campus security with your location and identity.\n\nStudent: " + currentUser.name + "\nID: " + currentUser.studentId + "\nType: " + type.label + " — " + type.desc
  );
  if (!confirmed) return;

  isAlertSent  = true;
  btn.disabled = true;
  setStatus("📡 Sending alert...", "loading");

  try { userLocation = await getUserLocation(); } catch (_) {}

  const alert = {
    id:               generateAlertId(),
    alertType:        selectedAlertType,
    alertTypeLabel:   type.label,
    alertTypeEmoji:   type.emoji,
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
    timeStr:          new Date().toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:true }),
    dateStr:          new Date().toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" })
  };

  try {
    if (window.db) {
      await window.db.collection(ALERTS_COLLECTION).doc(alert.id)
        .set({ ...alert, timestamp: firebase.firestore.FieldValue.serverTimestamp() });
      setStatus("✅ Alert sent! ID: " + alert.id + " — Help is on the way.", "success");
      await broadcastProximityAlert(alert);
    } else {
      setStatus("✅ Alert sent (offline)! ID: " + alert.id, "success");
    }
  } catch (err) {
    console.error("Send error:", err);
    setStatus("❌ Failed to send. Try again.", "error");
    isAlertSent  = false;
    btn.disabled = false;
    return;
  }

  if (deadManActive) stopDeadManSwitch(true);

  alertCount++;
  lastAlertTime = alert.timeStr;
  document.getElementById("cardStatus").textContent = type.label.toUpperCase();
  document.getElementById("cardStatus").style.color = type.color;
  document.getElementById("cardCount").textContent  = alertCount;
  document.getElementById("cardTime").textContent   = lastAlertTime;

  btn.classList.add("sent");
  btn.innerHTML = '<span class="btn-label">✓</span><span class="btn-sub">SENT</span>';
  document.getElementById("sosWrapper").classList.add("pulsing");
  document.getElementById("bgGlow").classList.add("active");

  saveToHistory(alert);
  setTimeout(() => resetButton(), 10000);
}

// ─── DEAD MAN SWITCH ──────────────────────────────────────
function startDeadManSwitch() {
  if (deadManActive) { stopDeadManSwitch(); return; }

  // Support custom duration input
  const customInput = document.getElementById("deadManCustom");
  const select      = document.getElementById("deadManDuration");
  let minutes = 15;

  if (select && select.value === "custom" && customInput) {
    minutes = parseInt(customInput.value) || 15;
    if (minutes < 1)  minutes = 1;
    if (minutes > 120) minutes = 120;
  } else if (select) {
    minutes = parseInt(select.value) || 15;
  }

  deadManSeconds = minutes * 60;
  deadManActive  = true;

  const btn = document.getElementById("deadManBtn");
  if (btn) {
    btn.textContent   = "✓ Timer Active — Tap to Cancel";
    btn.style.cssText += ";background:rgba(0,214,143,0.1);border-color:var(--green);color:var(--green);";
  }
  const countdown = document.getElementById("deadManCountdown");
  if (countdown) countdown.style.display = "block";

  deadManInterval = setInterval(() => {
    deadManSeconds--;
    updateDeadManDisplay();
    if (deadManSeconds <= 0) {
      clearInterval(deadManInterval);
      deadManActive = false;
      setStatus("⏰ Timer expired — auto-sending SOS!", "error");
      setTimeout(() => autoFireAlert(), 500);
    }
  }, 1000);

  updateDeadManDisplay();
  setStatus(`⏱ Safe walk timer started (${minutes} min). Tap 'I'm Safe' when you arrive.`, "");
}

function updateDeadManDisplay() {
  const el = document.getElementById("deadManCountdown");
  if (!el) return;
  const m = Math.floor(deadManSeconds / 60);
  const s = deadManSeconds % 60;
  el.textContent = "⏱ Auto-SOS in " + m + ":" + String(s).padStart(2, "0");
  el.style.color = deadManSeconds < 60 ? "var(--red)" : "var(--amber)";
}

function stopDeadManSwitch(silent) {
  if (deadManInterval) clearInterval(deadManInterval);
  deadManActive  = false;
  deadManSeconds = 0;

  const btn = document.getElementById("deadManBtn");
  if (btn) {
    btn.textContent  = "🔒 Start Safe Walk Timer";
    btn.style.background = "";
    btn.style.borderColor = "";
    btn.style.color  = "";
  }
  const countdown = document.getElementById("deadManCountdown");
  if (countdown) countdown.style.display = "none";

  if (!silent) setStatus("✅ Safe walk timer cancelled.", "success");
}

function iAmSafe() {
  stopDeadManSwitch();
  setStatus("✅ Great! Timer cancelled — stay safe.", "success");
}

// Handle custom duration select
function onDurationChange() {
  const select = document.getElementById("deadManDuration");
  const customWrap = document.getElementById("customDurationWrap");
  if (!select || !customWrap) return;
  customWrap.style.display = select.value === "custom" ? "flex" : "none";
}

async function autoFireAlert() {
  try { userLocation = await getUserLocation(); } catch (_) {}

  const alert = {
    id:             generateAlertId(),
    alertType:      "sos",
    alertTypeLabel: "SOS (Auto)",
    alertTypeEmoji: "⏰",
    name:           currentUser.name,
    studentId:      currentUser.studentId,
    course:         currentUser.course,
    section:        currentUser.section,
    phone:          currentUser.phone,
    emergencyContact: currentUser.emergencyContact,
    lat:            userLocation.lat,
    lng:            userLocation.lng,
    accuracy:       userLocation.accuracy || 0,
    status:         "new",
    timestamp:      new Date(),
    timeStr:        new Date().toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:true }),
    dateStr:        new Date().toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" }),
    autoFired:      true,
  };

  if (window.db) {
    await window.db.collection(ALERTS_COLLECTION).doc(alert.id)
      .set({ ...alert, timestamp: firebase.firestore.FieldValue.serverTimestamp() })
      .catch(console.error);
    await broadcastProximityAlert(alert).catch(console.error);
  }
  saveToHistory(alert);
  setStatus("🆘 Auto-SOS sent! ID: " + alert.id, "error");
  document.getElementById("bgGlow").classList.add("active");
}

// ─── ANONYMOUS TIP ────────────────────────────────────────
async function submitTip() {
  const desc    = document.getElementById("tipDescription").value.trim();
  const locDesc = document.getElementById("tipLocation").value.trim();
  const tipType = document.getElementById("tipType").value;
  const errEl   = document.getElementById("tipError");
  const btn     = document.getElementById("tipBtn");

  if (!desc)    { errEl.style.color = "var(--red)"; errEl.textContent = "⚠ Please describe the incident."; return; }
  if (!tipType) { errEl.style.color = "var(--red)"; errEl.textContent = "⚠ Please select an incident type."; return; }

  errEl.textContent = "";
  btn.disabled      = true;
  btn.textContent   = "Submitting...";

  const tip = {
    description:  desc,
    locationDesc: locDesc || "Not specified",
    tipType,
    lat:          userLocation?.lat || null,
    lng:          userLocation?.lng || null,
    submittedAt:  new Date().toISOString(),
    status:       "unreviewed",
    anonymous:    true,
  };

  try {
    if (window.db) {
      await window.db.collection("anonymous_tips").add({
        ...tip,
        submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      // Offline fallback — store locally
      const tips = JSON.parse(localStorage.getItem("pendingTips") || "[]");
      tips.push(tip);
      localStorage.setItem("pendingTips", JSON.stringify(tips));
    }
    document.getElementById("tipDescription").value = "";
    document.getElementById("tipLocation").value    = "";
    document.getElementById("tipType").value        = "";
    errEl.style.color = "var(--green)";
    errEl.textContent = "✅ Tip submitted anonymously. Thank you!";
    setTimeout(() => { errEl.textContent = ""; errEl.style.color = ""; }, 5000);
  } catch (err) {
    console.error("Tip submit error:", err);
    errEl.style.color = "var(--red)";
    errEl.textContent = "❌ Failed to submit. Try again.";
  } finally {
    btn.disabled    = false;
    btn.textContent = "Submit Tip Anonymously →";
  }
}

// ─── EMERGENCY PROTOCOLS ──────────────────────────────────
const PROTOCOLS = [
  {
    emoji: "🔥", title: "Fire Emergency",
    steps: ["Activate nearest fire alarm pull station", "Evacuate via stairwells — never use lifts", "Assemble at Assembly Point A (Main Gate)", "Call 101 (Fire Brigade) or Campus Security"],
  },
  {
    emoji: "🏥", title: "Medical Emergency",
    steps: ["Call 108 (Ambulance) immediately", "Do not move the injured person", "Keep them conscious and comfortable", "Send someone to the entrance to guide ambulance"],
  },
  {
    emoji: "👁", title: "Suspicious Activity",
    steps: ["Do not confront the individual", "Move to a safe, populated area", "Send SOS with 'Suspicious' type selected", "Note description: clothing, height, direction of travel"],
  },
  {
    emoji: "⚡", title: "Assault / Harassment",
    steps: ["Get to safety immediately — do not stay", "Press SOS with 'Assault' type selected", "Contact Women's Cell or campus helpline", "Preserve any evidence: messages, photos"],
  },
];

function renderProtocols() {
  const container = document.getElementById("protocolCards");
  if (!container) return;
  container.innerHTML = PROTOCOLS.map((p, i) => `
    <div class="protocol-card" onclick="toggleProtocol(${i})" id="protocol-${i}">
      <div class="protocol-header">
        <span class="protocol-emoji">${p.emoji}</span>
        <span class="protocol-title">${p.title}</span>
        <span class="protocol-arrow" id="arrow-${i}">▸</span>
      </div>
      <div class="protocol-steps" id="steps-${i}" style="display:none;">
        ${p.steps.map((s, j) => `
          <div class="protocol-step">
            <span class="step-num">${j + 1}</span>
            <span>${s}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `).join("");
}

function toggleProtocol(i) {
  const steps = document.getElementById("steps-" + i);
  const arrow = document.getElementById("arrow-" + i);
  const open  = steps.style.display !== "none";
  steps.style.display = open ? "none" : "block";
  arrow.textContent   = open ? "▸" : "▾";
}

// ─── RESET BUTTON ─────────────────────────────────────────
function resetButton() {
  const btn = document.getElementById("sosBtn");
  isAlertSent  = false;
  btn.disabled = false;
  btn.classList.remove("sent");
  btn.innerHTML = '<span class="btn-label">SOS</span><span class="btn-sub">TAP TO ALERT</span>';
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
    list.innerHTML = '<div style="color:var(--muted);font-size:12px;font-family:var(--font-mono);padding:16px 0;">No alerts sent yet.</div>';
    return;
  }
  list.innerHTML = history.map(a => {
    const type = ALERT_TYPES.find(t => t.id === a.alertType) || ALERT_TYPES[0];
    return `
      <div class="history-item">
        <div class="history-dot" style="background:${type.color};"></div>
        <div>
          <div style="font-size:12px;color:var(--text);">${a.alertTypeEmoji || "🆘"} ${a.id}</div>
          <div style="font-size:11px;color:var(--muted);">${a.alertTypeLabel || "SOS"} · ${a.lat?.toFixed(4)}, ${a.lng?.toFixed(4)}</div>
        </div>
        <div class="history-time">${a.timeStr}</div>
      </div>
    `;
  }).join("");
}

// ─── UI HELPERS ───────────────────────────────────────────
function setStatus(msg, type) {
  const el = document.getElementById("statusMsg");
  el.textContent = msg;
  el.className   = "status-msg " + (type || "");
}

function updateChip(type, text) {
  const chip = document.getElementById("statusChip");
  const span = document.getElementById("statusText");
  if (!chip || !span) return;
  chip.className   = "chip " + type;
  span.textContent = text;
}

function logout() {
  clearSession();
  window.location.href = "login.html";
}

// ─── NEARBY USER COUNT ────────────────────────────────────
async function updateNearbyCount(lat, lng) {
  const card = document.getElementById("cardNearby");
  if (!card || !window.db) return;
  try {
    const snapshot = await window.db.collection(PRESENCE_COLLECTION).where("active", "==", true).get();
    let count = 0;
    const myId = sessionStorage.getItem("presenceId");
    snapshot.forEach(doc => {
      const p = doc.data();
      if (p.presenceId === myId) return;
      if (haversineKm(lat, lng, p.lat, p.lng) <= PROXIMITY_RADIUS_KM) count++;
    });
    card.textContent = count > 0 ? count : "0";
    card.style.color = count > 0 ? "var(--text)" : "var(--muted)";
  } catch (err) {
    card.textContent = "—";
  }
}
