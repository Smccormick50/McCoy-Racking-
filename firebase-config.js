// Firebase configuration for the Racking Inventory site.
// This file is meant to be edited if you ever need to change projects.
// The apiKey here is safe to be public — security is enforced by
// Firestore rules in the Firebase console, not by hiding this file.

const firebaseConfig = {
  apiKey: "AIzaSyAycjbG9_bYYNieTUEqvTJxj4vEDDBBE2k",
  authDomain: "racking-inventory-tracker.firebaseapp.com",
  projectId: "racking-inventory-tracker",
  storageBucket: "racking-inventory-tracker.firebasestorage.app",
  messagingSenderId: "61331131085",
  appId: "1:61331131085:web:054b3b2dc731d841da7784",
  measurementId: "G-D1NTL7ZLH1"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
