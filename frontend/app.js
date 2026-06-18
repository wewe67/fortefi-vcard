/* =========================================================
   Fortéfi connection map — frontend logic
   ---------------------------------------------------------
   Sources for the client's top-5:
     1. Microsoft 365 (Graph People API — closeness-ranked, one consent popup)
     2. Phone contact picker (Android Chrome)
     3. Contacts CSV upload (Outlook / Gmail / LinkedIn exports)
     4. Manual typing
   All sources land on the same review screen. The candidate list never
   leaves this device; only the confirmed top-5 is submitted.
   ========================================================= */

const CFG = window.FORTEFI_CONFIG;
const MAX = CFG.MAX_REFERRALS;

// --- tiny helpers ---------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, html = "") => {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  if (html) n.innerHTML = html;
  return n;
};
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const ICONS = {
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.4a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="3"/><path d="M7 10v7M7 7v.01M11 17v-5m0 0c0-2 5-2 5 0v5"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M3 12h18M12 2.5c2.6 2.5 4 6 4 9.5s-1.4 7-4 9.5c-2.6-2.5-4-6-4-9.5s1.4-7 4-9.5Z"/></svg>',
};

// --- state -----------------------------------------------------------------
let EMPLOYEE = { ...CFG.EMPLOYEE };
let candidates = [];          // [{name,email,phone,designation,company}]
let selectedIds = new Set();  // indexes into candidates
let activeSource = "manual";  // m365 | picker | csv | manual
let lastFocused = null;
let refCount = 0;

// ===========================================================================
// Card
// ===========================================================================
function renderCard(emp) {
  $("#emp-name").textContent = emp.name;
  $("#emp-role").textContent = emp.title;
  $("#emp-tagline").textContent = emp.tagline || "";
  document.title = `${emp.name} · Fortéfi`;

  const rows = $("#contact-rows");
  rows.innerHTML = "";
  if (emp.email) rows.appendChild(contactRow("mail", `mailto:${emp.email}`, emp.email));
  if (emp.phone) rows.appendChild(contactRow("phone", `tel:${emp.phone.replace(/\s/g, "")}`, emp.phone));
  if (emp.linkedin) rows.appendChild(contactRow("link", emp.linkedin, "LinkedIn profile", true));
  rows.appendChild(contactRow("globe", "https://fortefi.com.my", "fortefi.com.my", true));
}

function contactRow(icon, href, label, external = false) {
  const a = el("a", { href });
  if (external) { a.setAttribute("target", "_blank"); a.setAttribute("rel", "noopener"); }
  a.appendChild(el("span", { class: "ico" }, ICONS[icon]));
  a.appendChild(el("span", {}, esc(label)));
  return a;
}

function buildVCard(emp) {
  const parts = emp.name.trim().split(/\s+/);
  const family = parts.length > 1 ? parts.pop() : "";
  const given = parts.join(" ");
  const lines = [
    "BEGIN:VCARD", "VERSION:3.0",
    `N:${family};${given};;;`,
    `FN:${emp.name}`,
    "ORG:Fortéfi Capital Sdn. Bhd.",
    `TITLE:${emp.title}`,
  ];
  if (emp.email) lines.push(`EMAIL;TYPE=WORK:${emp.email}`);
  if (emp.phone) lines.push(`TEL;TYPE=WORK,VOICE:${emp.phone}`);
  if (emp.linkedin) lines.push(`URL:${emp.linkedin}`);
  lines.push("END:VCARD");
  return lines.join("\r\n");
}

function downloadFile(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ===========================================================================
// Panel navigation (source → pick → form → done)
// ===========================================================================
const VIEWS = ["source-view", "pick-view", "form-view", "done-view"];
function showView(id) {
  VIEWS.forEach((v) => { $(`#${v}`).hidden = v !== id; });
  $(".panel").scrollTop = 0;
}

function openPanel() {
  lastFocused = document.activeElement;
  $("#panel").classList.add("open");
  showView("source-view");
  setSourceMsg("");
  document.addEventListener("keydown", escClose);
}

function closePanel() {
  $("#panel").classList.remove("open");
  document.removeEventListener("keydown", escClose);
  if (lastFocused) lastFocused.focus();
}

function escClose(e) { if (e.key === "Escape") closePanel(); }

function setSourceMsg(text, kind = "") {
  const m = $("#source-msg");
  m.textContent = text;
  m.className = `form-msg ${kind}`;
}

function setMsg(text, kind = "") {
  const m = $("#form-msg");
  m.textContent = text;
  m.className = `form-msg ${kind}`;
}

// ===========================================================================
// Source 1 · Microsoft 365 (Graph People API via MSAL popup)
// ===========================================================================
let msalInstance = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function getMsal() {
  if (msalInstance) return msalInstance;
  if (!window.msal) {
    await loadScript("https://cdn.jsdelivr.net/npm/@azure/msal-browser@3/lib/msal-browser.min.js");
  }
  msalInstance = new window.msal.PublicClientApplication({
    auth: {
      clientId: CFG.AZURE_CLIENT_ID,
      authority: "https://login.microsoftonline.com/common",
      redirectUri: window.location.origin + window.location.pathname,
    },
    cache: { cacheLocation: "sessionStorage" },
  });
  await msalInstance.initialize();
  return msalInstance;
}

async function connectM365() {
  if (!CFG.AZURE_CLIENT_ID) {
    setSourceMsg(
      "Microsoft 365 connection isn't set up yet. The Azure client ID is missing in config.js. " +
      "You can still upload a contacts file or type names in.", "error");
    return;
  }
  setSourceMsg("Opening Microsoft sign-in…");
  try {
    const msal = await getMsal();
    const scopes = ["User.Read", "People.Read"];
    const login = await msal.loginPopup({ scopes, prompt: "select_account" });
    const account = login.account;

    let token;
    try {
      token = (await msal.acquireTokenSilent({ scopes, account })).accessToken;
    } catch {
      token = (await msal.acquireTokenPopup({ scopes, account })).accessToken;
    }

    setSourceMsg("Fetching your closest contacts…");
    const res = await fetch(
      "https://graph.microsoft.com/v1.0/me/people?$top=200&$select=displayName,scoredEmailAddresses,jobTitle,companyName,phones,personType",
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Graph responded ${res.status}`);
    const data = await res.json();

    // The signed-in user's own domain — we suggest people OUTSIDE it.
    const ownDomain = (account.username.split("@")[1] || "").toLowerCase();

    const list = (data.value || [])
      .filter((p) => (p.personType?.class || "Person") === "Person")
      .map((p) => {
        const email = p.scoredEmailAddresses?.[0]?.address || "";
        return {
          name: p.displayName || email,
          email,
          phone: p.phones?.[0]?.number || "",
          designation: p.jobTitle || "",
          company: p.companyName || "",
        };
      })
      .filter((p) => p.name)
      .filter((p) => {
        if (!p.email) return true; // keep unverifiable ones; client decides
        const dom = p.email.split("@")[1]?.toLowerCase() || "";
        return dom !== ownDomain;
      });

    if (list.length === 0) {
      setSourceMsg("No external contacts came back from Microsoft. Try uploading a contacts file instead.", "error");
      return;
    }
    startPicking(list, "m365",
      "These are your closest external contacts, ranked by Microsoft from how often you interact. Tick the ones you're happy to introduce.");
  } catch (err) {
    if (err?.errorCode === "user_cancelled" || /cancel/i.test(String(err?.message))) {
      setSourceMsg("");
      return;
    }
    setSourceMsg("Couldn't connect to Microsoft 365. " + (err?.message || err) +
      ". You can upload a contacts file or type names instead.", "error");
  }
}

// ===========================================================================
// Source 2 · Phone contact picker (Android Chrome)
// ===========================================================================
function contactPickerSupported() {
  return "contacts" in navigator && "select" in navigator.contacts;
}

async function pickFromPhone() {
  try {
    const picked = await navigator.contacts.select(["name", "email", "tel"], { multiple: true });
    if (!picked || picked.length === 0) return;
    const list = picked.map((c) => ({
      name: (c.name && c.name[0]) || "",
      email: (c.email && c.email[0]) || "",
      phone: (c.tel && c.tel[0]) || "",
      designation: "",
      company: "",
    })).filter((c) => c.name || c.email);
    if (list.length === 0) return;
    // Native picker already IS the selection step — go straight to review.
    goToForm(list.slice(0, MAX), "picker");
  } catch {
    /* user dismissed the picker — nothing to do */
  }
}

// ===========================================================================
// Source 3 · CSV upload (Outlook / Gmail / LinkedIn exports)
// ===========================================================================
function parseCSV(text) {
  // Minimal RFC-4180-ish parser with quoted-field support.
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

// Header names across Outlook, Google Contacts and LinkedIn exports.
const HEADER_MAP = {
  name: ["name", "full name", "display name"],
  first: ["first name", "given name"],
  last: ["last name", "family name", "surname"],
  email: ["e-mail address", "email address", "e-mail 1 - value", "email", "primary email", "e-mail"],
  phone: ["mobile phone", "phone 1 - value", "business phone", "phone", "mobile", "primary phone"],
  company: ["company", "organization 1 - name", "company name", "organization name"],
  designation: ["job title", "position", "organization 1 - title", "title"],
};

function matchHeader(headers, keys) {
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const key of keys) {
    const idx = lower.indexOf(key);
    if (idx !== -1) return idx;
  }
  return -1;
}

function handleCSVFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      let text = String(reader.result);
      // LinkedIn's Connections.csv has 2-3 preamble lines before the header.
      if (/^notes?:/i.test(text.trimStart())) {
        const lines = text.split(/\r?\n/);
        const headerIdx = lines.findIndex((l) => /first name/i.test(l) && /last name/i.test(l));
        if (headerIdx > 0) text = lines.slice(headerIdx).join("\n");
      }
      const rows = parseCSV(text);
      if (rows.length < 2) throw new Error("That file doesn't look like a contacts export.");
      const headers = rows[0];
      const col = {
        name: matchHeader(headers, HEADER_MAP.name),
        first: matchHeader(headers, HEADER_MAP.first),
        last: matchHeader(headers, HEADER_MAP.last),
        email: matchHeader(headers, HEADER_MAP.email),
        phone: matchHeader(headers, HEADER_MAP.phone),
        company: matchHeader(headers, HEADER_MAP.company),
        designation: matchHeader(headers, HEADER_MAP.designation),
      };
      if (col.name === -1 && col.first === -1 && col.email === -1) {
        throw new Error("Couldn't recognise the columns. Please export contacts as CSV from Outlook, Google Contacts or LinkedIn.");
      }
      const get = (r, i) => (i >= 0 && i < r.length ? r[i].trim() : "");
      const seen = new Set();
      const list = [];
      for (const r of rows.slice(1)) {
        let name = get(r, col.name);
        if (!name) name = [get(r, col.first), get(r, col.last)].filter(Boolean).join(" ");
        const email = get(r, col.email);
        if (!name && !email) continue;
        const key = (email || name).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({
          name: name || email,
          email,
          phone: get(r, col.phone),
          designation: get(r, col.designation),
          company: get(r, col.company),
        });
      }
      if (list.length === 0) throw new Error("No contacts found in that file.");
      list.sort((a, b) => a.name.localeCompare(b.name));
      startPicking(list, "csv",
        `Loaded ${list.length} contact(s) from your file, read on this device only. Tick the ones you're happy to introduce.`);
    } catch (err) {
      setSourceMsg(String(err?.message || err), "error");
    }
  };
  reader.onerror = () => setSourceMsg("Couldn't read that file.", "error");
  reader.readAsText(file);
}

// ===========================================================================
// Pick view (shared by M365 + CSV)
// ===========================================================================
function startPicking(list, source, lede) {
  candidates = list;
  selectedIds = new Set();
  activeSource = source;
  $("#pick-lede").textContent = lede;
  $("#pick-search").value = "";
  renderPickList("");
  updatePickCount();
  showView("pick-view");
  $("#pick-search").focus();
}

function renderPickList(query) {
  const list = $("#pick-list");
  list.innerHTML = "";
  const q = query.trim().toLowerCase();
  let shown = 0;
  candidates.forEach((c, i) => {
    if (q) {
      const hay = `${c.name} ${c.company} ${c.email} ${c.designation}`.toLowerCase();
      if (!hay.includes(q)) return;
    }
    if (shown >= 60 && !q) return; // keep the DOM light; search reveals the rest
    shown++;
    const item = el("label", { class: "pick-item" + (selectedIds.has(i) ? " selected" : "") });
    const sub = [c.designation, c.company].filter(Boolean).join(" · ") || c.email;
    item.innerHTML = `
      <input type="checkbox" data-idx="${i}" ${selectedIds.has(i) ? "checked" : ""} />
      <span class="pick-meta">
        <span class="pick-name">${esc(c.name)}</span>
        <span class="pick-sub">${esc(sub)}</span>
      </span>`;
    item.querySelector("input").addEventListener("change", (e) => {
      const idx = Number(e.target.dataset.idx);
      if (e.target.checked) {
        if (selectedIds.size >= MAX) {
          e.target.checked = false;
          return;
        }
        selectedIds.add(idx);
      } else {
        selectedIds.delete(idx);
      }
      item.classList.toggle("selected", e.target.checked);
      updatePickCount();
    });
    list.appendChild(item);
  });
  if (shown === 0) {
    list.appendChild(el("p", { class: "pick-empty" }, q ? "No matches." : "No contacts to show."));
  }
}

function updatePickCount() {
  $("#pick-count").textContent = `${selectedIds.size} of ${MAX} selected`;
  $("#pick-continue").disabled = selectedIds.size === 0;
}

// ===========================================================================
// Review form
// ===========================================================================
function refRowTemplate(index, data = {}) {
  const wrap = el("div", { class: "ref-row", "data-ref": index });
  wrap.innerHTML = `
    <div class="ref-index">Person ${index}</div>
    <button class="remove" type="button" aria-label="Remove this person">&times;</button>
    <div class="ref-grid">
      <div class="field full">
        <label>Name</label>
        <input type="text" data-field="name" placeholder="Full name" value="${esc(data.name || "")}" />
      </div>
      <div class="field">
        <label>Email</label>
        <input type="email" data-field="email" placeholder="name@company.com" value="${esc(data.email || "")}" />
      </div>
      <div class="field">
        <label>Contact number</label>
        <input type="tel" data-field="phone" placeholder="+60 12-345 6789" value="${esc(data.phone || "")}" />
      </div>
      <div class="field">
        <label>Designation (optional)</label>
        <input type="text" data-field="designation" placeholder="e.g. Finance Director" value="${esc(data.designation || "")}" />
      </div>
      <div class="field">
        <label>Company (optional)</label>
        <input type="text" data-field="company" placeholder="Company" value="${esc(data.company || "")}" />
      </div>
    </div>`;
  wrap.querySelector(".remove").addEventListener("click", () => {
    if (document.querySelectorAll(".ref-row").length > 1) {
      wrap.remove();
      reindexRows();
    }
  });
  return wrap;
}

function addRefRow(data = {}) {
  const list = $("#ref-list");
  if (list.children.length >= MAX) return;
  refCount += 1;
  list.appendChild(refRowTemplate(refCount, data));
  reindexRows();
}

function reindexRows() {
  const rows = document.querySelectorAll(".ref-row");
  rows.forEach((row, i) => {
    row.querySelector(".ref-index").textContent = `Person ${i + 1}`;
    row.querySelector(".remove").disabled = rows.length === 1;
  });
  $("#add-ref").disabled = rows.length >= MAX;
}

function goToForm(people, source) {
  activeSource = source;
  $("#ref-list").innerHTML = "";
  refCount = 0;
  if (people.length === 0) addRefRow();
  else people.slice(0, MAX).forEach((p) => addRefRow(p));
  setMsg("");
  showView("form-view");
  $("#client-name").focus();
}

function collectReferrals() {
  return [...document.querySelectorAll(".ref-row")]
    .map((row) => {
      const get = (f) => row.querySelector(`[data-field="${f}"]`).value.trim();
      return {
        name: get("name"),
        email: get("email"),
        phone: get("phone"),
        designation: get("designation"),
        company: get("company"),
      };
    })
    .filter((r) => r.name.length > 0);
}

async function submitReferral() {
  const clientName = $("#client-name").value.trim();
  const referrals = collectReferrals();
  const consent = $("#consent").checked;

  if (!clientName) { setMsg("Please add your name so the team knows who's referring.", "error"); $("#client-name").focus(); return; }
  if (referrals.length === 0) { setMsg("Add at least one person's name before sending.", "error"); return; }
  if (!consent) { setMsg("Please confirm the consent statement before sending.", "error"); return; }

  const payload = {
    employee_id: EMPLOYEE.id,
    submitted_at: new Date().toISOString(),
    source: activeSource,
    client: {
      name: clientName,
      company: $("#client-company").value.trim(),
      email: $("#client-email").value.trim(),
    },
    consent: {
      has_permission_or_will_introduce: true,
      consent_text_version: CFG.CONSENT_TEXT_VERSION,
    },
    referrals,
  };

  const btn = $("#submit-referral");
  btn.disabled = true;
  setMsg("Sending…");

  try {
    const res = await fetch(CFG.API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    showDone("Your introductions have been sent to the team.");
  } catch {
    // Static hosting / backend down — don't lose the data.
    downloadFile(
      `referral-${EMPLOYEE.id}-${Date.now()}.json`,
      JSON.stringify(payload, null, 2),
      "application/json"
    );
    showDone("Saved as a file on your device. Please send it to your Fortéfi contact.");
  } finally {
    btn.disabled = false;
  }
}

function showDone(message) {
  $("#done-msg").textContent = message;
  showView("done-view");
  $("#close-done").focus();
}

// ===========================================================================
// Init
// ===========================================================================
async function init() {
  // Which employee's card is this? ?emp=<id> with the backend running,
  // otherwise the fallback from config.js.
  const empId = new URLSearchParams(window.location.search).get("emp") || CFG.EMPLOYEE.id;
  try {
    const res = await fetch(`/api/employees/${encodeURIComponent(empId)}`);
    if (res.ok) EMPLOYEE = await res.json();
  } catch { /* static hosting — keep the config fallback */ }

  renderCard(EMPLOYEE);

  $("#save-contact").addEventListener("click", () =>
    downloadFile(`${EMPLOYEE.name.replace(/\s+/g, "_")}.vcf`, buildVCard(EMPLOYEE), "text/vcard"));
  $("#open-referral").addEventListener("click", openPanel);
  $("#close-done").addEventListener("click", closePanel);
  $("#privacy-link").addEventListener("click", (e) => {
    e.preventDefault(); openPanel(); $(".notice").open = true;
  });
  $("#panel").addEventListener("click", (e) => { if (e.target.id === "panel") closePanel(); });

  // sources
  $("#src-m365").addEventListener("click", connectM365);
  if (contactPickerSupported()) $("#src-picker").hidden = false;
  $("#src-picker").addEventListener("click", pickFromPhone);
  $("#src-csv").addEventListener("click", () => $("#csv-input").click());
  $("#csv-input").addEventListener("change", (e) => {
    if (e.target.files?.[0]) handleCSVFile(e.target.files[0]);
    e.target.value = "";
  });
  $("#src-manual").addEventListener("click", () => goToForm([], "manual"));

  // pick view
  $("#pick-search").addEventListener("input", (e) => renderPickList(e.target.value));
  $("#pick-back").addEventListener("click", () => showView("source-view"));
  $("#pick-continue").addEventListener("click", () => {
    const chosen = [...selectedIds].map((i) => candidates[i]);
    goToForm(chosen, activeSource);
  });

  // form view
  $("#form-back").addEventListener("click", () => showView("source-view"));
  $("#add-ref").addEventListener("click", () => addRefRow());
  $("#submit-referral").addEventListener("click", submitReferral);
}

document.addEventListener("DOMContentLoaded", init);
