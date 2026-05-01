// ─── VAPID KEY ────────────────────────────────────────────
const VAPID_KEY = "BGx-QSAHn2LGlnMctse5PPgKVXx_b8EG3XKD8PzhJrOtFbXcZyBJ5-xO4iLVSuGRYdyF1oV5XYKjd7qwxD9WALk";

// ─── PRESENCE: REGISTER USER ONLINE WITH LOCATION ─────────
async function registerPresence(lat, lng) {
  if (!window.db) return;
  const session = getSession();
  if (!session) return;

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
async function broadcastProximityAlert(alert) {
  if (!window.db) return;

  try {
    const snapshot = await window.db
      .collection(PRESENCE_COLLECTION)
      .where("active", "==", true)
      .get();

    const nearby = [];
    snapshot.forEach(doc => {
      const p = doc.data();
      if (p.studentId === alert.studentId && p.role === alert.role) return;
      const dist = haversineKm(alert.lat, alert.lng, p.lat, p.lng);
      if (dist <= PROXIMITY_RADIUS_KM) {
        nearby.push({ presenceId: p.presenceId, dist });
      }
    });

    console.log(`📡 Notifying ${nearby.length} nearby user(s) within ${PROXIMITY_RADIUS_KM} km`);

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

    await broadcastAlert(alert);

  } catch (err) {
    console.error("Proximity broadcast error:", err);
  }
}

// ─── LISTEN FOR PROXIMITY ALERTS ──────────────────────────
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
      if (isFirst) { isFirst = false; return; }
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

        change.doc.ref.update({ seen: true }).catch(() => {});
      });
    });
}

// ─── INITIALIZE NOTIFICATIONS ─────────────────────────────
async function initNotifications() {
  try {
    if (!("Notification" in window)) return null;

    const base = `https://www.gstatic.com/firebasejs/10.7.1`;
    await loadScript(`${base}/firebase-messaging-compat.js`);

    const messaging = firebase.messaging();
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return null;

    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");

    const token = await messaging.getToken({
      vapidKey:                  VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (token) {
      await saveToken(token);
      return token;
    }
    return null;
  } catch (err) {
    console.error("Notification init error:", err);
    return null;
  }
}

// ─── SAVE FCM TOKEN ───────────────────────────────────────
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
  } catch (err) {
    console.error("Token save error:", err);
  }
}

// ─── SEND NOTIFICATION TO ALL DEVICES ─────────────────────
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

// ─── LISTEN FOR NEW ALERTS (student side) ─────────────────
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
        // Don't show alert for your own SOS
        const session = getSession();
        if (session && data.studentId === session.studentId) return;
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

// ─── LISTEN FOR BROADCAST MESSAGES (student side) ─────────
// Uses simple timestamp-based approach to avoid composite index requirement
function listenForBroadcasts() {
  if (!window.db) return;
  let isFirst = true;
  // Store last seen broadcast time in sessionStorage to avoid re-showing
  const lastSeenKey = "lastBroadcastSeen";

  window.db
    .collection("broadcast_messages")
    .orderBy("sentAt", "desc")
    .limit(5)
    .onSnapshot(snapshot => {
      if (isFirst) {
        isFirst = false;
        // Record the latest timestamp on load so we only show NEW ones
        if (!snapshot.empty) {
          const latest = snapshot.docs[0].data();
          const latestTime = latest.sentAt?.toMillis ? latest.sentAt.toMillis() : (latest.sentAt ? new Date(latest.sentAt).getTime() : 0);
          const stored = parseInt(sessionStorage.getItem(lastSeenKey) || "0");
          if (latestTime > stored) {
            sessionStorage.setItem(lastSeenKey, String(latestTime));
          }
        }
        return;
      }
      snapshot.docChanges().forEach(change => {
        if (change.type !== "added") return;
        const d = change.doc.data();
        const msgTime = d.sentAt?.toMillis ? d.sentAt.toMillis() : (d.sentAt ? new Date(d.sentAt).getTime() : 0);
        const lastSeen = parseInt(sessionStorage.getItem(lastSeenKey) || "0");
        if (msgTime <= lastSeen) return; // Already seen
        sessionStorage.setItem(lastSeenKey, String(msgTime));
        showBroadcastBanner(d.message, d.adminName || "Campus Security");
        // Add to student inbox
        addMessageToInbox({
          text:      d.message,
          from:      d.adminName || "Campus Security",
          type:      "broadcast",
          timestamp: d.sentAt,
          id:        change.doc.id,
        });
      });
    });
}

// ─── LISTEN FOR ADMIN DIRECT MESSAGES (student side) ──────
function listenForAdminReplies() {
  if (!window.db || !currentUser) return;
  let isFirst = true;
  window.db.collection("admin_replies")
    .where("studentId", "==", currentUser.studentId)
    .orderBy("sentAt", "desc")
    .limit(20)
    .onSnapshot(snapshot => {
      if (isFirst) {
        isFirst = false;
        // Load existing messages into inbox on first load
        snapshot.docs.forEach(doc => {
          const reply = doc.data();
          addMessageToInbox({
            text:      reply.message,
            from:      reply.adminName || "Security",
            type:      "direct",
            timestamp: reply.sentAt,
            id:        doc.id,
            seen:      reply.seen,
          });
        });
        updateInboxBadge();
        return;
      }
      snapshot.docChanges().forEach(change => {
        if (change.type !== "added") return;
        const reply = change.doc.data();
        showAdminReply(reply.message, reply.adminName || "Security");
        addMessageToInbox({
          text:      reply.message,
          from:      reply.adminName || "Security",
          type:      "direct",
          timestamp: reply.sentAt,
          id:        change.doc.id,
          seen:      false,
        });
        change.doc.ref.update({ seen: true }).catch(() => {});
        updateInboxBadge();
      });
    });
}

// ─── STUDENT INBOX ────────────────────────────────────────
let inboxMessages = [];

function addMessageToInbox(msg) {
  // Avoid duplicates
  if (inboxMessages.find(m => m.id === msg.id)) return;
  inboxMessages.unshift(msg);
  renderInbox();
}

function renderInbox() {
  const list = document.getElementById("inboxList");
  const emptyEl = document.getElementById("inboxEmpty");
  if (!list) return;

  if (inboxMessages.length === 0) {
    list.innerHTML = "";
    if (emptyEl) emptyEl.style.display = "block";
    return;
  }
  if (emptyEl) emptyEl.style.display = "none";

  list.innerHTML = inboxMessages.map(msg => {
    const isBroadcast = msg.type === "broadcast";
    const color = isBroadcast ? "var(--amber)" : "var(--green)";
    const icon  = isBroadcast ? "📢" : "🛡️";
    const label = isBroadcast ? "BROADCAST" : "SECURITY MSG";
    let timeStr = "—";
    if (msg.timestamp) {
      const d = msg.timestamp?.toDate ? msg.timestamp.toDate() : new Date(msg.timestamp);
      timeStr = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
    }
    return `
      <div class="inbox-item ${msg.seen === false ? 'unread' : ''}">
        <div class="inbox-item-header">
          <span style="color:${color};font-size:10px;font-weight:700;letter-spacing:.08em;font-family:var(--font-mono);">
            ${icon} ${label}
          </span>
          <span class="inbox-time">${timeStr}</span>
        </div>
        <div class="inbox-from">${msg.from}</div>
        <div class="inbox-text">${msg.text}</div>
      </div>
    `;
  }).join("");
}

function updateInboxBadge() {
  const badge = document.getElementById("inboxBadge");
  if (!badge) return;
  const unread = inboxMessages.filter(m => m.seen === false).length;
  badge.textContent = unread > 0 ? unread : "";
  badge.style.display = unread > 0 ? "inline-flex" : "none";
}

function clearInbox() {
  inboxMessages = [];
  renderInbox();
  updateInboxBadge();
}

// ─── SHOW ADMIN REPLY TOAST ───────────────────────────────
function showAdminReply(message, adminName) {
  const old = document.getElementById("adminReplyBanner");
  if (old) old.remove();

  const banner = document.createElement("div");
  banner.id = "adminReplyBanner";
  banner.style.cssText = `
    position:fixed;top:70px;right:20px;width:340px;
    background:#0d0f18;border:1px solid var(--green);border-radius:14px;
    padding:16px 18px;z-index:99999;box-shadow:0 8px 40px rgba(0,214,143,0.25);
    font-family:'Space Grotesk',sans-serif;
  `;
  banner.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <span style="color:var(--green);font-weight:700;font-size:11px;letter-spacing:.08em;">🛡️ MESSAGE FROM SECURITY</span>
      <button onclick="document.getElementById('adminReplyBanner').remove()"
        style="background:none;border:none;color:#5a5f75;cursor:pointer;font-size:16px;">✕</button>
    </div>
    <div style="font-size:12px;color:var(--text-2);margin-bottom:6px;">${adminName}</div>
    <div style="font-size:14px;color:var(--text);line-height:1.5;">${message}</div>
    <div style="margin-top:10px;font-size:11px;color:var(--text-3);">Check your inbox below ↓</div>
  `;
  document.body.appendChild(banner);
  playAlertBeep();
  setTimeout(() => { const b = document.getElementById("adminReplyBanner"); if (b) b.remove(); }, 20000);
}

// ─── SHOW BROADCAST BANNER ────────────────────────────────
function showBroadcastBanner(message, adminName) {
  const existing = document.getElementById("broadcastBanner");
  if (existing) existing.remove();

  const banner = document.createElement("div");
  banner.id = "broadcastBanner";
  banner.style.cssText = `
    position:fixed;top:70px;left:50%;transform:translateX(-50%);
    width:min(480px,calc(100vw - 32px));
    background:#0d0f18;border:1px solid var(--amber);border-radius:14px;
    padding:14px 18px;z-index:99998;box-shadow:0 8px 40px rgba(255,179,0,0.25);
    font-family:'Space Grotesk',sans-serif;
  `;
  banner.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <span style="color:var(--amber);font-weight:700;font-size:11px;letter-spacing:.08em;">
        📢 CAMPUS SECURITY BROADCAST
      </span>
      <button onclick="document.getElementById('broadcastBanner').remove()"
        style="background:none;border:none;color:#5a5f75;cursor:pointer;font-size:16px;">✕</button>
    </div>
    <div style="font-size:14px;color:var(--text);line-height:1.5;">${message}</div>
    <div style="font-size:11px;color:var(--text-3);margin-top:4px;">— ${adminName}</div>
    <div style="margin-top:8px;font-size:11px;color:var(--text-3);">Saved to your inbox ↓</div>
  `;
  document.body.appendChild(banner);
  playAlertBeep();
  setTimeout(() => { const b = document.getElementById("broadcastBanner"); if (b) b.remove(); }, 20000);
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
    <div style="display:inline-block;background:rgba(255,45,85,0.15);color:#ff2d55;
                font-size:10px;padding:2px 8px;border-radius:4px;letter-spacing:.08em;
                font-weight:700;margin-bottom:8px;">📡 PROXIMITY ALERT</div>
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
function buildMapsUrl(lat, lng) {
  if (!lat || !lng) return "https://maps.google.com";
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

// ─── LISTEN FOR NEW ALERTS IN FIRESTORE ───────────────────
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
        const session = getSession();
        if (session && data.studentId === session.studentId) return;
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
