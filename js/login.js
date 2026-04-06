// ─── ADMIN CREDENTIALS ────────────────────────────────────
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "campus123";

// ─── ON PAGE LOAD ─────────────────────────────────────────
window.addEventListener("load", async () => {
  await initFirebase();

  // If already logged in (persistent), redirect
  const session = getSession();
  if (session?.role === "student") {
    window.location.href = "index.html";
    return;
  }
  if (session?.role === "admin") {
    window.location.href = "admin.html";
    return;
  }
});

// ─── SWITCH TABS ──────────────────────────────────────────
function switchTab(tab) {
  const studentForm = document.getElementById("studentForm");
  const adminForm   = document.getElementById("adminForm");
  const tabStudent  = document.getElementById("tabStudent");
  const tabAdmin    = document.getElementById("tabAdmin");

  if (tab === "student") {
    studentForm.classList.remove("hidden");
    adminForm.classList.add("hidden");
    tabStudent.classList.add("active");
    tabAdmin.classList.remove("active");
  } else {
    adminForm.classList.remove("hidden");
    studentForm.classList.add("hidden");
    tabAdmin.classList.add("active");
    tabStudent.classList.remove("active");
  }

  document.getElementById("studentError").textContent = "";
  document.getElementById("adminError").textContent   = "";
}

// ─── STUDENT LOGIN ────────────────────────────────────────
async function studentLogin() {
  const btn = document.querySelector("#studentForm .login-btn");

  const id        = document.getElementById("studentId").value.trim();
  const name      = document.getElementById("studentName").value.trim();
  const course    = document.getElementById("studentCourse").value;
  const section   = document.getElementById("studentSection").value.trim();
  const phone     = document.getElementById("studentPhone").value.trim();
  const emergency = document.getElementById("studentEmergency").value.trim();
  const errorEl   = document.getElementById("studentError");

  if (!id)   { errorEl.textContent = "⚠ Student ID is required."; return; }
  if (!name) { errorEl.textContent = "⚠ Full name is required."; return; }
  if (!course) { errorEl.textContent = "⚠ Please select your course."; return; }
  if (!phone || phone.length !== 10) { errorEl.textContent = "⚠ Enter a valid 10-digit phone number."; return; }

  errorEl.textContent = "";
  btn.classList.add("loading");
  btn.textContent = "Saving...";

  try {
    const studentData = {
      studentId:        id,
      name:             name,
      course:           course,
      section:          section || "—",
      phone:            phone,
      emergencyContact: emergency || "—",
      role:             "student",
      lastLogin:        new Date().toISOString(),
    };

    if (window.db) {
      await window.db
        .collection("students")
        .doc(id)
        .set(studentData, { merge: true });
    }

    // Use localStorage for persistence
    saveSession(studentData);
    window.location.href = "index.html";

  } catch (err) {
    console.error("Login error:", err);
    errorEl.textContent = "⚠ Failed to connect. Try again.";
    btn.classList.remove("loading");
    btn.textContent = "Enter Safety System →";
  }
}

// ─── ADMIN LOGIN ──────────────────────────────────────────
async function adminLogin() {
  const btn      = document.querySelector("#adminForm .login-btn");
  const username = document.getElementById("adminUsername").value.trim();
  const password = document.getElementById("adminPassword").value;
  const errorEl  = document.getElementById("adminError");

  if (!username) { errorEl.textContent = "⚠ Username is required."; return; }
  if (!password) { errorEl.textContent = "⚠ Password is required."; return; }

  errorEl.textContent = "";
  btn.classList.add("loading");
  btn.textContent = "Verifying...";

  await new Promise(r => setTimeout(r, 700));

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    saveSession({
      name:     "Admin",
      role:     "admin",
      username: username,
      lastLogin: new Date().toISOString(),
    });
    window.location.href = "admin.html";
  } else {
    errorEl.textContent = "⚠ Invalid username or password.";
    btn.classList.remove("loading");
    btn.textContent = "Access Dashboard →";
  }
}

// ─── TOGGLE PASSWORD VISIBILITY ───────────────────────────
function togglePassword() {
  const input = document.getElementById("adminPassword");
  const btn   = document.querySelector(".eye-btn");
  if (input.type === "password") {
    input.type = "text";
    btn.textContent = "🙈";
  } else {
    input.type = "password";
    btn.textContent = "👁";
  }
}

// ─── SESSION HELPERS (localStorage = persistent) ──────────
function saveSession(data) {
  localStorage.setItem("campusShieldUser", JSON.stringify(data));
}

function getSession() {
  try {
    return JSON.parse(localStorage.getItem("campusShieldUser"));
  } catch {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem("campusShieldUser");
}
