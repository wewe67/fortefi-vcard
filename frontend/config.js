/* =========================================================
   Fortéfi connection map — configuration
   ---------------------------------------------------------
   This is the ONLY file you need to edit to get started.
   ========================================================= */

window.FORTEFI_CONFIG = {
  // Paste the "Application (client) ID" from your Azure app registration here.
  // Until you do, the "Connect Microsoft 365" button will explain it's not set up yet.
  // See README.md → "Azure setup (one time, free)" for the exact clicks.
  AZURE_CLIENT_ID: "27ffc77d-1fd7-4a40-9f8a-b0cd63b2be2a",

  // Where referral submissions are POSTed. Leave as-is when running the Flask
  // backend. On static hosting (Netlify/GitHub Pages) submissions fall back to
  // downloading a JSON file the client sends back to you.
  API_ENDPOINT: "/api/referrals",

  // Bump this whenever you change the consent wording, so stored consents
  // can be traced to the exact text the client agreed to.
  CONSENT_TEXT_VERSION: "2026-06-10",

  MAX_REFERRALS: 5,

  // Fallback employee for static hosting (no backend). With the backend
  // running, the page loads the employee from /api/employees instead —
  // share links like  https://yoursite.com/?emp=wsuryanto  per colleague.
  EMPLOYEE: {
    id: "wtoni",
    name: "William Toni",
    title: "Executive, Investment Intelligence & Automation",
    email: "william@fortefi.com.my",
    phone: "+60 10-2794-386",
    linkedin: "https://www.linkedin.com/in/william-tonii",
    tagline: "Liquidity, on your terms.",
  },
};
