// ─── VAPID KEY ────────────────────────────────────────────
const VAPID_KEY = "BGx-QSAHn2LGlnMctse5PPgKVXx_b8EG3XKD8PzhJrOtFbXcZyBJ5-xO4iLVSuGRYdyF1oV5XYKjd7qwxD9WALk";

// ─── PRESENCE: REGISTER USER ONLINE WITH LOCATION ─────────
// Called after location is acquired. Writes/updates a doc
// in `user_presence` keyed by a stable session ID so we can
// query all online users during an alert broadcast.
async function registerPresence(lat, lng) {
  if (!window.db) return;
  const session = getSession();
  if (!session) return;

  // Unique doc per browser tab — sessionStorage key is tab-scoped
  let presenceId = sessionStorage.getItem("presenceId");
  if (!presenceId) {
    presenceId = "P-" + Math.random().toString(36).slice(2, 10).toUpperCase();
    sessionStorage.setItem("presenceId", presenceId);
  }

  try {
    await window.db.collection(PRESENCE_COLLECTION).doc(presenceId).set({
      presenceId,
      name:      session.name,
      studentId: session.studentId || "admin",
      role:      session.role,
      lat,
      lng,
      onlineAt:  new Date().toISOString(),
      active:    true,
    });
    console.log("✅ Presence registered:", presenceId);

    // Mark offline when tab closes — use Firestore REST via sendBeacon (sync-safe)
    window.addEventListener("beforeunload", () => {
      try {
        window.db.collection(PRESENCE_COLLECTION).doc(presenceId)
          .update({ active: false });
      } catch (_) {}
    });
  } catch (err) {
    console.error("Presence registration error:", err);
  }
}

// ─── BROADCAST ALERT TO NEARBY USERS ─────────────────────
// Queries all active presence docs, computes distance,
// and writes a proximity_alert doc for each nearby user.
async function broadcastProximityAlert(alert) {
  if (!window.db) return;

  try {
    // Fetch all currently active users
    const snapshot = await window.db
      .collection(PRESENCE_COLLECTION)
      .where("active", "==", true)
      .get();

    const nearby = [];
    snapshot.forEach(doc => {
      const p = doc.data();
      // Skip the sender themselves
      if (p.studentId === alert.studentId && p.role === alert.role) return;

      const dist = haversineKm(alert.lat, alert.lng, p.lat, p.lng);
      if (dist <= PROXIMITY_RADIUS_KM) {
        nearby.push({ presenceId: p.presenceId, dist });
      }
    });

    console.log(`📡 Notifying ${nearby.length} nearby user(s) within ${PROXIMITY_RADIUS_KM} km`);

    // Write one proximity_alert doc per nearby user
    const batch = window.db.batch();
    nearby.forEach(({ presenceId }) => {
      const ref = window.db.collection(PROXIMITY_ALERTS_COL).doc();
      batch.set(ref, {
        targetPresenceId: presenceId,
        alertId:          alert.id,
        senderName:       alert.name,
        senderStudentId:  alert.studentId,
        course:           alert.course  || "",
        section:          alert.section || "",
        lat:              alert.lat,
        lng:              alert.lng,
        mapsUrl:          buildMapsUrl(alert.lat, alert.lng),
        sentAt:           new Date().toISOString(),
        seen:             false,
      });
    });
    await batch.commit();
    console.log("✅ Proximity alerts dispatched");

    // Also write the general broadcast doc (for admin / FCM)
    await broadcastAlert(alert);

  } catch (err) {
    console.error("Proximity broadcast error:", err);
  }
}

// ─── LISTEN FOR PROXIMITY ALERTS ADDRESSED TO THIS SESSION ──
// Each logged-in tab listens on its own presenceId.
function listenForProximityAlerts() {
  if (!window.db) return;
  const presenceId = sessionStorage.getItem("presenceId");
  if (!presenceId) return;

  let isFirst = true;
  window.db
    .collection(PROXIMITY_ALERTS_COL)
    .where("targetPresenceId", "==", presenceId)
    .where("seen", "==", false)
    .onSnapshot(snapshot => {
      if (isFirst) { isFirst = false; return; } // skip initial state
      snapshot.docChanges().forEach(change => {
        if (change.type !== "added") return;
        const d = change.doc.data();

        showAlertBanner({
          title:   `🚨 ${d.senderName || "Student"} sent SOS!`,
          body:    `${d.course} ${d.section} — Tap Navigate to help.`,
          mapsUrl: d.mapsUrl,
          lat:     d.lat,
          lng:     d.lng,
          alertId: d.alertId,
        });

        // Mark seen so it doesn't re-fire on reconnect
        change.doc.ref.update({ seen: true }).catch(() => {});
      });
    });
}

// ─── INITIALIZE NOTIFICATIONS ─────────────────────────────
async function initNotifications() {
  try {
    if (!("Notification" in window)) {
      console.log("❌ Notifications not supported");
      return null;
    }

    const base = `https://www.gstatic.com/firebasejs/10.7.1`;
    await loadScript(`${base}/firebase-messaging-compat.js`);

    const messaging = firebase.messaging();

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.log("❌ Notification permission denied");
      return null;
    }

    console.log("✅ Notification permission granted");

    const registration = await navigator.serviceWorker.register(
      "/firebase-messaging-sw.js"
    );

    console.log("✅ Service worker registered");

    const token = await messaging.getToken({
      vapidKey:                  VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (token) {
      console.log("✅ FCM Token:", token);
      await saveToken(token);
      return token;
    }

    return null;
  } catch (err) {
    console.error("Notification init error:", err);
    return null;
  }
}

// ─── SAVE FCM TOKEN TO FIRESTORE ──────────────────────────
async function saveToken(token) {
  if (!window.db) return;
  const session = getSession();
  if (!session) return;

  try {
    await window.db.collection("fcm_tokens").doc(token).set({
      token,
      role:      session.role,
      name:      session.name,
      studentId: session.studentId || "admin",
      device:    navigator.userAgent,
      savedAt:   new Date().toISOString(),
    });
    console.log("✅ Token saved to Firestore");
  } catch (err) {
    console.error("Token save error:", err);
  }
}

// ─── SEND NOTIFICATION TO ALL DEVICES (original broadcast) ─
async function broadcastAlert(alert) {
  if (!window.db) return;
  try {
    const mapsUrl = buildMapsUrl(alert.lat, alert.lng);
    await window.db.collection("notifications").add({
      title:     `🚨 SOS ALERT — ${alert.name}`,
      body:      `${alert.course} · ${alert.section} needs help! Tap to navigate.`,
      mapsUrl,
      lat:       String(alert.lat),
      lng:       String(alert.lng),
      studentId: alert.studentId,
      name:      alert.name,
      alertId:   alert.id,
      sentAt:    new Date().toISOString(),
      status:    "pending",
    });
    console.log("✅ Broadcast alert saved");
  } catch (err) {
    console.error("Broadcast error:", err);
  }
}

// ─── FOREGROUND NOTIFICATION HANDLER ─────────────────────
async function listenForegroundMessages() {
  try {
    const base = `https://www.gstatic.com/firebasejs/10.7.1`;
    await loadScript(`${base}/firebase-messaging-compat.js`);
    const messaging = firebase.messaging();
    messaging.onMessage(payload => {
      const data    = payload.data || {};
      const mapsUrl = data.mapsUrl || "";
      showAlertBanner({
        title:   data.title || "🚨 SOS ALERT",
        body:    data.body  || "A student needs help!",
        mapsUrl,
        name:    data.name || "Student",
        lat:     data.lat,
        lng:     data.lng,
      });
    });
  } catch (err) {
    console.error("Foreground listener error:", err);
  }
}

// ─── SHOW IN-APP ALERT BANNER ─────────────────────────────
function showAlertBanner({ title, body, mapsUrl, name, lat, lng, alertId }) {
  const existing = document.getElementById("alertBanner");
  if (existing) existing.remove();

  const mapsLink = mapsUrl || buildMapsUrl(lat, lng);

  const banner = document.createElement("div");
  banner.id    = "alertBanner";
  banner.style.cssText = `
    position: fixed;
    top: 70px;
    right: 20px;
    width: 360px;
    background: #111318;
    border: 1px solid #ff2d55;
    border-radius: 14px;
    padding: 16px 18px;
    z-index: 99999;
    box-shadow: 0 8px 40px rgba(255,45,85,0.35);
    animation: slide-in 0.4s ease-out;
    font-family: 'Syne', sans-serif;
  `;

  banner.innerHTML = `
    <style>
      @keyframes slide-in {
        from { transform: translateX(120%); opacity: 0; }
        to   { transform: translateX(0);    opacity: 1; }
      }
      .proximity-badge {
        display: inline-block;
        background: rgba(255,45,85,0.15);
        color: #ff2d55;
        font-size: 10px;
        padding: 2px 8px;
        border-radius: 4px;
        letter-spacing: .08em;
        font-weight: 700;
        margin-bottom: 8px;
      }
    </style>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <span style="color:#ff2d55;font-weight:700;font-size:13px;letter-spacing:.06em;">
        🚨 SOS ALERT — NEARBY
      </span>
      <button onclick="document.getElementById('alertBanner').remove()"
        style="background:transparent;border:none;color:#5a5f75;cursor:pointer;font-size:16px;">
        ✕
      </button>
    </div>
    <div class="proximity-badge">📡 PROXIMITY ALERT</div>
    <div style="color:#e8eaf0;font-size:14px;font-weight:600;margin-bottom:4px;">${title}</div>
    <div style="color:#5a5f75;font-size:12px;margin-bottom:14px;">${body}</div>
    <div style="display:flex;gap:8px;">
      <a href="${mapsLink}" target="_blank"
        style="flex:1;padding:10px;background:#ff2d55;color:white;border-radius:8px;
               text-align:center;text-decoration:none;font-size:12px;font-weight:700;
               display:flex;align-items:center;justify-content:center;gap:6px;">
        📍 Navigate in Google Maps
      </a>
      <a href="admin.html"
        style="flex:1;padding:10px;background:transparent;color:#e8eaf0;
               border:1px solid #1e2130;border-radius:8px;text-align:center;
               text-decoration:none;font-size:12px;font-weight:600;
               display:flex;align-items:center;justify-content:center;gap:4px;">
        🛡️ Dashboard
      </a>
    </div>
  `;

  document.body.appendChild(banner);
  setTimeout(() => {
    const b = document.getElementById("alertBanner");
    if (b) b.remove();
  }, 20000);
  playAlertBeep();
}

// ─── BUILD GOOGLE MAPS NAVIGATION URL ─────────────────────
// Opens Google Maps with turn-by-turn directions TO the alert location
function buildMapsUrl(lat, lng) {
  if (!lat || !lng) return "https://maps.google.com";
  // travelmode=walking works well on campus; change to driving if preferred
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
}

// ─── PLAY ALERT BEEP ──────────────────────────────────────
function playAlertBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 660, 880].forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.12);
      osc.start(ctx.currentTime + i * 0.15);
      osc.stop(ctx.currentTime  + i * 0.15 + 0.12);
    });
  } catch (_) {}
}

// ─── LISTEN FOR NEW ALERTS IN FIRESTORE (admin/all-users) ──
function listenForNewAlerts() {
  if (!window.db) return;
  let isFirst = true;

  window.db
    .collection(ALERTS_COLLECTION)
    .orderBy("timestamp", "desc")
    .limit(1)
    .onSnapshot(snapshot => {
      if (isFirst) { isFirst = false; return; }
      snapshot.docChanges().forEach(change => {
        if (change.type !== "added") return;
        const data = change.doc.data();
        if (!data) return;
        const mapsUrl = buildMapsUrl(data.lat, data.lng);
        showAlertBanner({
          title:   `🚨 ${data.name || "Student"} sent SOS!`,
          body:    `${data.course || ""} ${data.section || ""} — Tap Navigate to help`,
          mapsUrl,
          name:    data.name,
          lat:     data.lat,
          lng:     data.lng,
        });
      });
    });
}
