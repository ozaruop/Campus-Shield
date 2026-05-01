# 🛡️ CampusShield
> Real-Time Silent Safety Alert & Location Beacon Web System for Campus Security

![Live](https://img.shields.io/badge/Live-campus--shield--gehu.netlify.app-brightgreen)
![Firebase](https://img.shields.io/badge/Backend-Firebase-orange)
![Netlify](https://img.shields.io/badge/Hosted-Netlify-blue)
![License](https://img.shields.io/badge/License-MIT-purple)

---

## 🔗 Live Demo
👉 **[https://campus-shield-gehu.netlify.app](https://campus-shield-gehu.netlify.app)**

---

## 📖 About
CampusShield is a web-based campus safety platform built for **Graphic Era Hill University, Dehradun**. It allows students to silently trigger SOS alerts with a single tap. Upon triggering, the system captures real-time GPS location, syncs it to Firebase Firestore, and instantly notifies all connected students and campus security personnel.

The admin dashboard provides live monitoring of all incoming alerts, complete student information, and a real-time map with navigation route directly to the student in distress.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🚨 One-Tap SOS | Silent alert triggered with a single button press |
| 📍 GPS Tracking | Real-time location captured via Browser Geolocation API |
| 🗺️ Live Map | Leaflet.js map showing all active alert locations |
| 🔔 Push Notifications | Firebase Cloud Messaging notifies all logged-in devices |
| 🧭 Route Navigation | Click any alert to get Google Maps walking route to student |
| 🛡️ Admin Dashboard | Full monitoring panel with student details and alert history |
| 👤 Student Login | Student ID, name, course, phone saved on login |
| 🔒 Admin Login | Secure username/password protected dashboard |
| 📊 Alert Statistics | Total, active, and today's alert counts |
| ✅ Resolve Alerts | Admin can mark alerts as resolved |

---

## 🛠️ Tech Stack
```
Frontend     →  HTML5, CSS3, Vanilla JavaScript
Database     →  Firebase Firestore (Real-Time)
Auth         →  Session Storage (Student + Admin)
Notifications→  Firebase Cloud Messaging (FCM)
Maps         →  Leaflet.js + OpenStreetMap
Routing      →  Leaflet Routing Machine
Location     →  Browser Geolocation API
Hosting      →  Netlify (Free Tier)
Version Ctrl →  Git + GitHub
```

---

## 📁 Project Structure
```
Campus-Shield/
│
├── login.html                 ← Entry point (Student + Admin login)
├── index.html                 ← Student SOS page
├── admin.html                 ← Admin dashboard
├── firebase-messaging-sw.js   ← FCM Service Worker
│
├── css/
│   ├── style.css              ← Global styles & variables
│   ├── login.css              ← Login page styles
│   ├── student.css            ← SOS page styles
│   └── admin.css              ← Dashboard styles
│
├── js/
│   ├── firebase-config.js     ← Firebase setup & helpers
│   ├── login.js               ← Login logic
│   ├── student.js             ← SOS trigger & location
│   ├── admin.js               ← Real-time alert listener
│   ├── map.js                 ← Leaflet map logic
│   └── notifications.js       ← FCM push notifications
│
└── assets/
    ├── icons/
    └── sounds/
```

---

## 🚀 How It Works
```
Student opens app → Logs in with details
        ↓
Presses SOS button
        ↓
Browser captures GPS coordinates
        ↓
Alert sent to Firebase Firestore
        ↓
All logged-in devices receive notification
        ↓
Admin clicks alert → Google Maps route opens
        ↓
Security reaches student location
```

---

## 🖥️ Screenshots

### Login Page
- Student login with ID, name, course, section, phone
- Admin login with username and password

### Student SOS Page
- Big red SOS button with pulse animation
- Live GPS coordinates display
- Alert history

### Admin Dashboard
- Live alerts sidebar with student details
- Interactive map with red pulsing markers
- Route navigation to student
- Stats: Total / Active / Today

---

## ⚙️ Setup & Installation

### 1. Clone the repository
```bash
git clone https://github.com/ozaruop/Campus-Shield.git
cd Campus-Shield
```

### 2. Configure Firebase
Replace values in `js/firebase-config.js` with your own Firebase project credentials:
```js
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};
```

### 3. Update VAPID Key
In `js/notifications.js` replace:
```js
const VAPID_KEY = "YOUR_VAPID_KEY";
```

### 4. Deploy
Drag the project folder to [Netlify Drop](https://app.netlify.com/drop)

---

## 👨‍💻 Team

| Name | Roll No | Role |
|---|---|---|
| Aditya Thapliyal | 2421057 | Team Leader & Developer |
| Ritesh Rawat | — | Developer |
| Ayshmaan | — | Developer |
| Sagar Saini | — | Developer |

---

## 🏫 Institution
**Graphic Era Hill University, Dehradun**
BCA — Section A2
Mini Project 2026
Mentor: Mr. Gaurav Sharma

---
---

## 🆕 Proximity Alert Feature

### How it works

When a student presses SOS:

1. **Location is broadcast** — The alert is written to Firestore as usual.
2. **Nearby users are identified** — All logged-in users who registered their location are queried. Anyone within **1 km** (configurable via `PROXIMITY_RADIUS_KM` in `firebase-config.js`) receives a personal proximity alert doc in the `proximity_alerts` collection.
3. **Real-time banner appears** — Each nearby user's browser receives a live Firestore update and displays a red in-app banner with a **"📍 Navigate in Google Maps"** button.
4. **Navigate button** — Opens Google Maps with turn-by-turn walking directions directly to the alert sender's GPS coordinates.

### New Firestore Collections

| Collection | Purpose |
|---|---|
| `user_presence` | Stores each logged-in user's location + online status |
| `proximity_alerts` | One doc per nearby user per alert, listened to in real-time |

### Required Firestore Rules

Add these to your Firebase Console → Firestore → Rules (also saved as `firestore.rules`):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /alerts/{doc} {
      allow read, write: if true;
    }
    match /notifications/{doc} {
      allow read, write: if true;
    }
    match /fcm_tokens/{doc} {
      allow read, write: if true;
    }
    match /user_presence/{doc} {
      allow read, write: if true;
    }
    match /proximity_alerts/{doc} {
      allow read, write: if true;
    }
    match /broadcast_messages/{doc} {
      allow read, write: if true;
    }
    match /anonymous_tips/{doc} {
      allow read, write: if true;
    }
    match /admin_replies/{doc} {
      allow read, write: if true;
    }
  }
}
```

### Configuring Proximity Radius

In `js/firebase-config.js`, change:
```js
const PROXIMITY_RADIUS_KM = 1.0; // 1 km default
```
