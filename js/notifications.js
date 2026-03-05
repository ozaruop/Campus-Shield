// ─── VAPID KEY ────────────────────────────────────────────
const VAPID_KEY = "BGx-QSAHn2LGlnMctse5PPgKVXx_b8EG3XKD8PzhJrOtFbXcZyBJ5-xO4iLVSuGRYdyF1oV5XYKjd7qwxD9WALk";

// ─── INITIALIZE NOTIFICATIONS ─────────────────────────────
async function initNotifications() {
  try {
    // Check browser support
    if (!("Notification" in window)) {
      console.log("❌ Notifications not supported");
      return null;
    }

    // Load Firebase Messaging SDK
    const base = `https://www.gstatic.com/firebasejs/10.7.1`;
    await loadScript(`${base}/firebase-messaging-compat.js`);

    const messaging = firebase.messaging();

    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.log("❌ Notification permission denied");
      return null;
    }

    console.log("✅ Notification permission granted");

    // Register service worker
    const registration = await navigator.serviceWorker.register(
      "/firebase-messaging-sw.js"
    );

    console.log("✅ Service worker registered");

    // Get FCM token
    const token = await messaging.getToken({
      vapidKey:            VAPID_KEY,
      serviceWorkerRegistration: registration
    });

    if (token) {
      console.log("✅ FCM Token:", token);
      // Save token to Firestore
      await saveToken(token);
      return token;
    }

    return null;

  } catch (err) {
    console.error("Notification init error:", err);
    return null;
  }
}

// ─── SAVE TOKEN TO FIRESTORE ──────────────────────────────
async function saveToken(token) {
  if (!window.db) return;

  const session = getSession();
  if (!session) return;

  try {
    await window.db.collection("fcm_tokens").doc(token).set({
      token:     token,
      role:      session.role,
      name:      session.name,
      studentId: session.studentId || "admin",
      device:    navigator.userAgent,
      savedAt:   new Date().toISOString()
    });
    console.log("✅ Token saved to Firestore");
  } catch (err) {
    console.error("Token save error:", err);
  }
}

// ─── SEND NOTIFICATION TO ALL DEVICES ────────────────────
// Called when student sends SOS
async function broadcastAlert(alert) {
  if (!window.db) return;

  try {
    // Build Google Maps URL
    const mapsUrl = buildMapsUrl(alert.lat, alert.lng);

    // Save notification task to Firestore
    // (In production this would trigger a Cloud Function)
    await window.db.collection("notifications").add({
      title:     `🚨 SOS ALERT — ${alert.name}`,
      body:      `${alert.course} · ${alert.section} needs help! Tap to navigate.`,
      mapsUrl:   mapsUrl,
      lat:       String(alert.lat),
      lng:       String(alert.lng),
      studentId: alert.studentId,
      name:      alert.name,
      alertId:   alert.id,
      sentAt:    new Date().toISOString(),
      status:    "pending"
    });

    console.log("✅ Broadcast alert saved");

  } catch (err) {
    console.error("Broadcast error:", err);
  }
}

// ─── FOREGROUND NOTIFICATION HANDLER ─────────────────────
// Shows notification when app is open
async function listenForegroundMessages() {
  try {
    const base = `https://www.gstatic.com/firebasejs/10.7.1`;
    await loadScript(`${base}/firebase-messaging-compat.js`);

    const messaging = firebase.messaging();

    messaging.onMessage(payload => {
      console.log("📩 Foreground message:", payload);

      const data    = payload.data || {};
      const mapsUrl = data.mapsUrl || "";

      // Show custom in-app notification banner
      showAlertBanner({
        title:   data.title   || "🚨 SOS ALERT",
        body:    data.body    || "A student needs help!",
        mapsUrl: mapsUrl,
        name:    data.name    || "Student",
        lat:     data.lat,
        lng:     data.lng,
      });
    });

  } catch (err) {
    console.error("Foreground listener error:", err);
  }
}

// ─── SHOW IN-APP ALERT BANNER ─────────────────────────────
function showAlertBanner({ title, body, mapsUrl, name, lat, lng }) {
  // Remove existing banner
  const existing = document.getElementById("alertBanner");
  if (existing) existing.remove();

  const mapsLink = mapsUrl || buildMapsUrl(lat, lng);

  const banner = document.createElement("div");
  banner.id    = "alertBanner";
  banner.style.cssText = `
    position: fixed;
    top: 70px;
    right: 20px;
    width: 340px;
    background: #111318;
    border: 1px solid #ff2d55;
    border-radius: 14px;
    padding: 16px 18px;
    z-index: 99999;
    box-shadow: 0 8px 40px rgba(255,45,85,0.3);
    animation: slide-in 0.4s ease-out;
    font-family: 'Syne', sans-serif;
  `;

  banner.innerHTML = `
    <style>
      @keyframes slide-in {
        from { transform: translateX(120%); opacity: 0; }
        to   { transform: translateX(0);    opacity: 1; }
      }
    </style>
    <div style="display:flex;align-items:center;
                justify-content:space-between;margin-bottom:8px;">
      <span style="color:#ff2d55;font-weight:700;
                   font-size:13px;letter-spacing:.06em;">
        🚨 SOS ALERT
      </span>
      <button onclick="document.getElementById('alertBanner').remove()"
        style="background:transparent;border:none;
               color:#5a5f75;cursor:pointer;font-size:16px;">
        ✕
      </button>
    </div>
    <div style="color:#e8eaf0;font-size:14px;
                font-weight:600;margin-bottom:4px;">
      ${title}
    </div>
    <div style="color:#5a5f75;font-size:12px;margin-bottom:14px;">
      ${body}
    </div>
    <div style="display:flex;gap:8px;">
      <a href="${mapsLink}" target="_blank"
        style="flex:1;padding:9px;background:#ff2d55;
               color:white;border-radius:8px;text-align:center;
               text-decoration:none;font-size:12px;font-weight:700;">
        📍 Navigate
      </a>
      <a href="admin.html"
        style="flex:1;padding:9px;background:transparent;
               color:#e8eaf0;border:1px solid #1e2130;
               border-radius:8px;text-align:center;
               text-decoration:none;font-size:12px;font-weight:600;">
        🛡️ Dashboard
      </a>
    </div>
  `;

  document.body.appendChild(banner);

  // Auto remove after 15 seconds
  setTimeout(() => {
    if (document.getElementById("alertBanner")) {
      banner.remove();
    }
  }, 15000);

  // Play beep sound
  playAlertBeep();
}

// ─── BUILD GOOGLE MAPS URL ────────────────────────────────
function buildMapsUrl(lat, lng) {
  if (!lat || !lng) return "https://maps.google.com";
  // Opens Google Maps navigation TO student location
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
}

// ─── PLAY ALERT BEEP ──────────────────────────────────────
function playAlertBeep() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    [880, 660, 880].forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(
        0.001, ctx.currentTime + i * 0.15 + 0.12
      );
      osc.start(ctx.currentTime + i * 0.15);
      osc.stop(ctx.currentTime  + i * 0.15 + 0.12);
    });
  } catch (_) {}
}

// ─── LISTEN FOR NEW ALERTS IN FIRESTORE ───────────────────
// This runs on ALL logged-in pages — notifies everyone
function listenForNewAlerts() {
  if (!window.db) return;

  let isFirst = true;

  window.db
    .collection(ALERTS_COLLECTION)
    .orderBy("timestamp", "desc")
    .limit(1)
    .onSnapshot(snapshot => {
      // Skip initial load
      if (isFirst) { isFirst = false; return; }

      snapshot.docChanges().forEach(change => {
        if (change.type === "added") {
          const data = change.doc.data();
          if (!data) return;

          const mapsUrl = buildMapsUrl(data.lat, data.lng);

          // Show banner on ALL open tabs
          showAlertBanner({
            title:   `🚨 ${data.name || "Student"} sent SOS!`,
            body:    `${data.course || ""} ${data.section || ""} — Tap to navigate`,
            mapsUrl: mapsUrl,
            name:    data.name,
            lat:     data.lat,
            lng:     data.lng,
          });
        }
      });
    });
}