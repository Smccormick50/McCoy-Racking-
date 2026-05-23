// Sign-in + forgot-password flow. New accounts are created by admin in Firebase Console.

function qs(id) { return document.getElementById(id); }

function showError(msg) { qs("authError").textContent = msg; }

function showResetMessage(msg, isError) {
  const el = qs("resetMessage");
  el.textContent = msg;
  el.style.color = isError ? "" : "#166b46"; // green when success
}

function showSignInView() {
  qs("signInView").style.display = "";
  qs("resetView").style.display = "none";
  showError("");
}

function showResetView() {
  qs("resetView").style.display = "";
  qs("signInView").style.display = "none";
  showResetMessage("", false);
  // Pre-fill the reset form with whatever email they typed on the sign-in screen
  const enteredEmail = qs("authEmail").value.trim();
  if (enteredEmail) qs("resetEmail").value = enteredEmail;
  qs("resetEmail").focus();
}

async function handleSignInSubmit(e) {
  e.preventDefault();
  const email = qs("authEmail").value.trim();
  const password = qs("authPassword").value;
  const btn = qs("authSubmit");
  btn.disabled = true;
  btn.textContent = "Signing in...";
  showError("");
  try {
    await auth.signInWithEmailAndPassword(email, password);
    window.location.href = "index.html";
  } catch (err) {
    console.error("Sign-in error:", err);
    showError(friendlySignInError(err));
    btn.disabled = false;
    btn.textContent = "Sign In";
  }
}

async function handleResetSubmit(e) {
  e.preventDefault();
  const email = qs("resetEmail").value.trim();
  const btn = qs("resetSubmit");
  btn.disabled = true;
  btn.textContent = "Sending...";
  showResetMessage("", false);
  try {
    await auth.sendPasswordResetEmail(email);
    showResetMessage(
      `Reset link sent. Check your email (and spam folder) for a message from "noreply@mc-racking---test.firebaseapp.com" and follow the link to set a new password.`,
      false
    );
    btn.textContent = "Sent ✓";
    // Leave button disabled so they don't spam the send. They can go back to sign in when ready.
  } catch (err) {
    console.error("Reset error:", err);
    showResetMessage(friendlyResetError(err), true);
    btn.disabled = false;
    btn.textContent = "Send Reset Link";
  }
}

function friendlySignInError(err) {
  const code = (err && err.code) || "";
  const map = {
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/user-not-found": "No account with that email. Contact your administrator.",
    "auth/wrong-password": "Incorrect password. Tap \"Forgot password?\" below if you need to reset it.",
    "auth/invalid-credential": "Email or password is incorrect. Tap \"Forgot password?\" below if you need to reset it.",
    "auth/too-many-requests": "Too many failed attempts. Wait a few minutes and try again, or use \"Forgot password?\" to reset.",
    "auth/network-request-failed": "Network error. Check your connection.",
    "auth/user-disabled": "This account has been disabled. Contact your administrator."
  };
  return map[code] || (err && err.message) || "Sign-in failed.";
}

function friendlyResetError(err) {
  const code = (err && err.code) || "";
  const map = {
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/user-not-found": "No account exists with that email. Double-check the address, or contact your administrator.",
    "auth/missing-email": "Please enter your email address.",
    "auth/too-many-requests": "Too many reset requests. Wait a few minutes and try again.",
    "auth/network-request-failed": "Network error. Check your connection."
  };
  return map[code] || (err && err.message) || "Couldn't send reset email. Try again or contact your administrator.";
}

document.addEventListener("DOMContentLoaded", async () => {
  // If already signed in, skip the form
  const user = await waitForAuthReady();
  if (user) {
    window.location.href = "index.html";
    return;
  }
  qs("authForm").addEventListener("submit", handleSignInSubmit);
  qs("resetForm").addEventListener("submit", handleResetSubmit);
  qs("forgotPasswordLink").addEventListener("click", (e) => { e.preventDefault(); showResetView(); });
  qs("backToSignInLink").addEventListener("click", (e) => { e.preventDefault(); showSignInView(); });
});
