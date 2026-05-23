// Firebase configuration for Mc Racking.
// Project: Mc Racking - Test

const firebaseConfig = {
  apiKey: "AIzaSyCg1Ih-IbxcoPIhAc_7mzJF2bJ9WX0EMyw",
  authDomain: "mc-racking---test.firebaseapp.com",
  projectId: "mc-racking---test",
  storageBucket: "mc-racking---test.firebasestorage.app",
  messagingSenderId: "22203078980",
  appId: "1:22203078980:web:6547d2250dc75a8d895f11",
  measurementId: "G-43RX41YE28"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

const LOGIN_PAGE = "login.html";

// Cached profile for the current user (populated by ensureUserApproved)
// Shape: { uid, email, role: "admin"|"warehouse", displayName, isAdmin }
let currentUserProfile = null;

function waitForAuthReady() {
  return new Promise(resolve => {
    const unsub = auth.onAuthStateChanged(user => {
      unsub();
      resolve(user);
    });
  });
}

// Load the user's profile from Firestore: users/{uid}
// Expected shape: { email, displayName, role: "admin" | "warehouse" }
async function loadUserProfile(uid) {
  const doc = await db.collection("users").doc(uid).get();
  if (!doc.exists) return null;
  return doc.data();
}

// Main entry gate. Use on every page that requires login.
//   opts.adminOnly = true → also require role === "admin"
// Returns the profile object on success.
// On failure: redirects to login OR shows a blocking overlay (and throws).
async function ensureUserApproved(opts) {
  opts = opts || {};
  const user = await waitForAuthReady();
  if (!user) {
    window.location.href = LOGIN_PAGE;
    throw new Error("Not signed in");
  }

  const profile = await loadUserProfile(user.uid);
  if (!profile) {
    showAccountNotConfiguredScreen(user.email || "");
    throw new Error("No profile");
  }

  const role = profile.role || "warehouse";
  currentUserProfile = {
    uid: user.uid,
    email: user.email,
    displayName: profile.displayName || (user.email ? user.email.split("@")[0] : "User"),
    role,
    isAdmin: role === "admin"
  };

  if (opts.adminOnly && role !== "admin") {
    showNotAdminScreen();
    throw new Error("Not an admin");
  }

  return currentUserProfile;
}

function showAccountNotConfiguredScreen(email) {
  const overlay = buildOverlay(`
    <h1>Account Not Set Up</h1>
    <p>Your login worked, but no profile has been configured for <strong>${escapeForHtml(email)}</strong>.</p>
    <p class="muted">An administrator needs to add this account to the <code>users</code> collection in Firebase before it can be used.</p>
    <button id="authSignOutBtn" type="button">Sign Out</button>
  `);
  document.body.appendChild(overlay);
  document.getElementById("authSignOutBtn").addEventListener("click", signOutAndGoToLogin);
}

function showNotAdminScreen() {
  const overlay = buildOverlay(`
    <h1>Admin Only</h1>
    <p>The admin page is only available to administrator accounts.</p>
    <p class="muted">Signed in as <strong>${escapeForHtml((currentUserProfile && currentUserProfile.email) || "")}</strong></p>
    <a href="index.html" class="btn-like">← Back to main site</a>
    <button id="authSignOutBtn" type="button" style="margin-top:10px;">Sign Out</button>
  `);
  document.body.appendChild(overlay);
  document.getElementById("authSignOutBtn").addEventListener("click", signOutAndGoToLogin);
}

function buildOverlay(innerHtml) {
  const overlay = document.createElement("div");
  overlay.className = "auth-overlay";
  overlay.innerHTML = `
    <div class="auth-card">
      <img src="mc-logo.png" alt="" class="auth-logo">
      ${innerHtml}
    </div>
  `;
  return overlay;
}

function escapeForHtml(text) {
  return String(text == null ? "" : text).replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));
}

async function signOutAndGoToLogin() {
  try { await auth.signOut(); } catch (e) {}
  window.location.href = LOGIN_PAGE;
}
