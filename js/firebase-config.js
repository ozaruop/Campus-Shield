// ─── FIREBASE CONFIG ──────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyCJvWs5F_Mm_IfSuYBbinsd2cKBNzQ2N0c",
  authDomain:        "campus-shieldgehu.firebaseapp.com",
  projectId:         "campus-shieldgehu",
  storageBucket:     "campus-shieldgehu.firebasestorage.app",
  messagingSenderId: "2774899873",
  appId:             "1:2774899873:web:2d342bafb77c722d63e4e0"
};

const FIREBASE_VERSION      = "10.7.1";
const ALERTS_COLLECTION     = "alerts";
const PRESENCE_COLLECTION   = "user_presence";   // tracks online users + their location
const PROXIMITY_ALERTS_COL  = "proximity_alerts"; // real-time alerts pushed to nearby users
const PROXIMITY_RADIUS_KM   = 1.0;               // alert everyone within 1 km

// ─── LOAD SCRIPT HELPER ───────────────────────────────────
function loadScript(src) {
  return new Promise((resolve, reject) => {
    // Don't load same script twice
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve(); return;
    }
    const s    = document.createElement("script");
    s.src      = src;
    s.onload   = resolve;
    s.onerror  = reject;
    document.head.appendChild(s);
  });
}

// ─── INITIALIZE FIREBASE ──────────────────────────────────
async function initFirebase() {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

  await loadScript(`${base}/firebase-app-compat.js`);
  await loadScript(`${base}/firebase-firestore-compat.js`);
  await loadScript(`${base}/firebase-messaging-compat.js`);

  // Only initialize once
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  window.db = firebase.firestore();
  console.log("✅ Firebase connected");
  return window.db;
}

// ─── HELPERS ──────────────────────────────────────────────
function generateAlertId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "ALT-";
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function formatTime(timestamp) {
  const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true
  });
}

function formatDate(timestamp) {
  const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric"
  });
}

function isToday(timestamp) {
  const date  = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  const today = new Date();
  return (
    date.getDate()     === today.getDate()    &&
    date.getMonth()    === today.getMonth()   &&
    date.getFullYear() === today.getFullYear()
  );
}

// ─── SESSION HELPERS ──────────────────────────────────────
// ─── HAVERSINE DISTANCE (km) ──────────────────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2 +
               Math.cos(lat1 * Math.PI / 180) *
               Math.cos(lat2 * Math.PI / 180) *
               Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
