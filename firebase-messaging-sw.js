// ─── SERVICE WORKER — must be in ROOT folder ──────────────
importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey:            "AIzaSyCJvWs5F_Mm_IfSuYBbinsd2cKBNzQ2N0c",
  authDomain:        "campus-shieldgehu.firebaseapp.com",
  projectId:         "campus-shieldgehu",
  storageBucket:     "campus-shieldgehu.firebasestorage.app",
  messagingSenderId: "2774899873",
  appId:             "1:2774899873:web:2d342bafb77c722d63e4e0"
});

const messaging = firebase.messaging();

// ─── BACKGROUND NOTIFICATION HANDLER ─────────────────────
messaging.onBackgroundMessage(payload => {
  console.log("📩 Background message:", payload);

  const data = payload.data || {};

  const options = {
    body:    data.body    || "A student needs help on campus!",
    icon:    data.icon    || "/assets/icons/shield.png",
    badge:   data.icon    || "/assets/icons/shield.png",
    vibrate: [300, 100, 300, 100, 300],
    tag:     "sos-alert",
    requireInteraction: true,
    data: {
      mapsUrl:   data.mapsUrl  || "",
      adminUrl:  data.adminUrl || "/admin.html",
      studentId: data.studentId|| "",
      lat:       data.lat      || "",
      lng:       data.lng      || "",
    },
    actions: [
      { action: "maps",    title: "📍 Navigate to Student" },
      { action: "admin",   title: "🛡️ Open Dashboard"      },
      { action: "dismiss", title: "✕ Dismiss"               }
    ]
  };

  self.registration.showNotification(
    data.title || "🚨 SOS ALERT — CampusShield",
    options
  );
});

// ─── NOTIFICATION CLICK ───────────────────────────────────
self.addEventListener("notificationclick", event => {
  event.notification.close();

  const data   = event.notification.data;
  const action = event.action;

  let urlToOpen = "/admin.html";

  if (action === "maps" && data.mapsUrl) {
    urlToOpen = data.mapsUrl;
  } else if (action === "admin") {
    urlToOpen = "/admin.html";
  } else if (data.mapsUrl) {
    // Default click → maps
    urlToOpen = data.mapsUrl;
  }

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true })
      .then(clientList => {
        // If admin tab already open, focus it
        for (const client of clientList) {
          if (client.url.includes("admin.html") && "focus" in client) {
            return client.focus();
          }
        }
        // Otherwise open new tab
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});