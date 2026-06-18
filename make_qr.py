"""Generate per-employee QR codes (PNG + SVG) pointing at the live card."""
import json
import sys
from pathlib import Path

import segno

sys.stdout.reconfigure(encoding="utf-8")

BASE = Path(__file__).resolve().parent
SITE = "https://fortefi-map.pages.dev/?emp="
OUT = BASE / "qr_codes"
OUT.mkdir(exist_ok=True)

employees = json.loads((BASE / "data" / "employees.json").read_text(encoding="utf-8"))
for e in employees:
    url = SITE + e["id"]
    qr = segno.make(url, error="h")
    qr.save(OUT / f"qr_{e['id']}.png", scale=18, border=3)
    qr.save(OUT / f"qr_{e['id']}.svg", scale=18, border=3)
    print(f"{e['id']:<9} -> {url}")
print(f"\nSaved {len(employees)} QR code(s) to {OUT}")
