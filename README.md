# Fortéfi Connection Map

A digital business card for Fortéfi employees with a built-in referral flow,
feeding a three-tier relationship map in Obsidian:

```
Fortéfi → Employee → Client → Client's top-5 connections
```

## How the client experience works

The client opens your card link and taps **Refer a connection**. They choose how
to share their top 5:

| Source | What happens | Effort for the client |
|---|---|---|
| **Connect Microsoft 365** | One Microsoft consent popup. We call the Graph People API, which returns their contacts **already ranked by closeness** (Microsoft computes this from their email/Teams patterns). We filter out their own company's domain and show the suggestions. | ~3 clicks, zero typing |
| **Pick from phone contacts** | The phone's native contact picker opens (Android Chrome only). They multi-select. | ~4 taps |
| **Upload a contacts file** | They drop in a CSV export from Outlook, Gmail or LinkedIn. Parsed in the browser. | ~1 minute |
| **Type them in myself** | Classic manual form. | Most effort — the fallback |

Whatever the source, they land on the same screen: tick up to 5, edit the
details (name, email, contact number, designation, company), agree to the
consent statement, send.

**Privacy shape (this is what keeps it PDPA-defensible):** the full contact
list is only ever processed in the client's own browser. Fortéfi's server
receives nothing except the up-to-5 people the client explicitly confirmed.
The unchosen candidates are discarded the moment the page closes.

## Project layout

```
fortefi-connection-map/
├── frontend/            # the card + referral flow (static, deployable anywhere)
│   ├── index.html
│   ├── styles.css
│   ├── config.js        ← the only file you must edit
│   └── app.js
├── backend/             # small Flask app to receive + store referrals
│   ├── app.py
│   └── requirements.txt
├── data/
│   ├── employees.json           # your team — one card per person
│   └── referrals.example.json   # sample data so the exporter has output
└── obsidian_export/
    └── build_vault.py   # turns the JSON into a linked Obsidian vault
```

## Quick start

### 1. Run it locally

```bash
cd backend
pip install -r requirements.txt
python app.py
# open http://127.0.0.1:5000
```

Everything works immediately **except** the Microsoft 365 button, which needs
the one-time Azure setup below. CSV upload, phone picker and manual entry work
with no setup at all.

### 2. Azure setup (one time, free) — enables the Microsoft 365 button

You don't need an Azure subscription or a credit card. App registration is a
free feature of the Microsoft account Fortéfi already has.

1. Go to **https://portal.azure.com** and sign in with Fortéfi's Microsoft
   work account.
2. In the search bar at the top, type **App registrations** and open it.
3. Click **+ New registration**.
   - **Name:** `Fortefi Connection Map`
   - **Supported account types:** choose
     **"Accounts in any organizational directory and personal Microsoft accounts"**
     — this is the important one. Your clients are in *their* companies'
     Microsoft tenants, so the app must be multi-tenant.
   - **Redirect URI:** pick **Single-page application (SPA)** from the dropdown
     and enter `http://localhost:5000`
   - Click **Register**.
4. On the app's Overview page, copy the **Application (client) ID** (a GUID
   like `1a2b3c4d-...`).
5. Paste it into `frontend/config.js` as `AZURE_CLIENT_ID`.
6. (Recommended) Left menu → **API permissions** → **+ Add a permission** →
   **Microsoft Graph** → **Delegated permissions** → tick **People.Read** and
   **User.Read** → **Add permissions**. No admin consent needed — these are
   user-consentable.
7. When you deploy the site publicly, come back to **Authentication** →
   **Add URI** under the SPA section and add your real URL
   (e.g. `https://card.fortefi.com`). Localhost can stay for testing.

That's it. The button now opens a Microsoft sign-in popup; the client signs in
with *their* M365 account and approves the People.Read permission once.

**Heads-up:** some client companies configure Microsoft 365 so employees can't
approve third-party apps themselves — the popup then says an admin must
approve. The page handles this gracefully: the client just uses the CSV upload
or manual entry instead.

### 3. Add your team

Edit `data/employees.json` — one entry per colleague. Each person shares their
own link:

```
https://yoursite.com/?emp=wsuryanto
https://yoursite.com/?emp=employee-2
```

(Set the real contact details in `frontend/config.js` → `EMPLOYEE` too — that's
the fallback when the page is hosted statically without the backend.)

### 4. Build the Obsidian map

```bash
cd obsidian_export
python build_vault.py
# writes ./obsidian-vault
```

Open that folder as a vault in Obsidian and turn on **graph view** (the orbit
icon). Employees sit at the centre, clients one ring out, each client's top 5
on the outer ring. Notes carry frontmatter (`type`, `tier`, `consent`,
`email`, `phone`, `designation`), so you can filter or query with Dataview,
e.g. `WHERE tier = 2`.

To map the whole team's referrals in one shared vault, collect everyone's
`referrals.json` submissions into `data/` (or run one central backend) and
re-run the script. Point at other files with `--employees`, `--referrals`,
`--out`.

### Static hosting (no backend)

Host `frontend/` on Netlify / GitHub Pages and the form still works: on submit
it downloads the referral as a JSON file the client sends back to you, and you
drop those files into `data/referrals.json` for the exporter. Remember to add
the deployed URL as an SPA redirect URI in Azure (step 7 above).

## Before you ship this to real clients

1. **Publish a real privacy notice** and link it from the page footer.
2. **Decide your retention/deletion process** — anyone referred can ask to be
   removed. The `submission_id` and per-note frontmatter give you something to
   delete against.
3. **Secure the stored data.** `referrals.json` is plain text here for clarity;
   in production put it behind access controls and back it up like any PII.
4. **Tell referred people who referred them** when you first contact them, and
   give them an easy opt-out — good practice and good for conversion.
5. **Keep `data/` out of any public repository** once real referrals come in.
6. **Google clients:** Gmail contact suggestions need Google's (free) app
   verification first. If you want that later, it's a separate piece — the
   CSV-upload path already covers Gmail users meanwhile.
