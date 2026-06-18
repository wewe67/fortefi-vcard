"""
Fortéfi connection map — backend
--------------------------------
A deliberately small Flask app:

  1. Serves the static vCard pages from ../frontend
  2. Accepts referral submissions and appends them to ../data/referrals.json

It never sees the client's full contact list — candidate suggestion (Microsoft
365 / contact picker / CSV) happens entirely in the client's browser. The only
personal data that reaches this server is the confirmed top-5 the client
consented to share. Submissions without the consent flag are rejected.

Run:
    pip install -r requirements.txt
    python app.py
Then open http://127.0.0.1:5000  (add ?emp=<id> for a colleague's card)
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

BASE = Path(__file__).resolve().parent.parent
FRONTEND = BASE / "frontend"
DATA = BASE / "data"
EMPLOYEES_FILE = DATA / "employees.json"
REFERRALS_FILE = DATA / "referrals.json"

MAX_REFERRALS = 5

app = Flask(__name__, static_folder=None)


# --- helpers ---------------------------------------------------------------
def load_employees() -> list[dict]:
    if EMPLOYEES_FILE.exists():
        return json.loads(EMPLOYEES_FILE.read_text(encoding="utf-8"))
    return []


def load_referrals() -> list[dict]:
    if REFERRALS_FILE.exists():
        return json.loads(REFERRALS_FILE.read_text(encoding="utf-8"))
    return []


def save_referrals(items: list[dict]) -> None:
    REFERRALS_FILE.write_text(
        json.dumps(items, indent=2, ensure_ascii=False), encoding="utf-8"
    )


# --- static frontend -------------------------------------------------------
@app.get("/")
def index():
    return send_from_directory(FRONTEND, "index.html")


@app.get("/<path:filename>")
def static_files(filename: str):
    return send_from_directory(FRONTEND, filename)


# --- API -------------------------------------------------------------------
@app.get("/api/employees")
def employees():
    return jsonify(load_employees())


@app.get("/api/employees/<emp_id>")
def employee(emp_id: str):
    match = next((e for e in load_employees() if e.get("id") == emp_id), None)
    if match is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(match)


@app.post("/api/referrals")
def create_referral():
    body = request.get_json(silent=True) or {}

    # Consent is mandatory. No consent, no record.
    consent = body.get("consent", {})
    if not consent.get("has_permission_or_will_introduce"):
        return jsonify({"error": "consent is required"}), 400

    client = body.get("client", {})
    if not client.get("name"):
        return jsonify({"error": "client name is required"}), 400

    referrals = [r for r in body.get("referrals", []) if r.get("name")]
    if not referrals:
        return jsonify({"error": "at least one referral name is required"}), 400
    referrals = referrals[:MAX_REFERRALS]  # honour the top-5 cap server-side too

    record = {
        "submission_id": f"sub_{uuid.uuid4().hex[:8]}",
        "employee_id": body.get("employee_id", "unknown"),
        "submitted_at": body.get("submitted_at")
        or datetime.now(timezone.utc).isoformat(),
        "source": body.get("source", "manual"),  # m365 | picker | csv | manual
        "client": {
            "name": client.get("name", ""),
            "company": client.get("company", ""),
            "email": client.get("email", ""),
        },
        "consent": {
            "has_permission_or_will_introduce": True,
            "consent_text_version": consent.get("consent_text_version", ""),
            "ip_recorded": False,
        },
        "referrals": [
            {
                "name": r.get("name", ""),
                "email": r.get("email", ""),
                "phone": r.get("phone", ""),
                "designation": r.get("designation", ""),
                "company": r.get("company", ""),
            }
            for r in referrals
        ],
    }

    items = load_referrals()
    items.append(record)
    save_referrals(items)

    return jsonify({"ok": True, "submission_id": record["submission_id"]}), 201


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
