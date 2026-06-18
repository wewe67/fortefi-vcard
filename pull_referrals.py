"""
Pull referral submissions from the deployed Cloudflare site
into data/referrals.json, so build_vault.py works exactly as before.

Run:
    python pull_referrals.py
Then:
    python obsidian_export/build_vault.py
"""

import json
import sys
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

BASE = Path(__file__).resolve().parent
SECRETS_FILE = BASE / "admin_secret.local.txt"  # line 1: site URL, line 2: admin token
OUT = BASE / "data" / "referrals.json"


def main() -> None:
    if not SECRETS_FILE.exists():
        sys.exit(f"Missing {SECRETS_FILE.name} — line 1: site URL, line 2: admin token.")
    site_url, token = [
        line.strip() for line in SECRETS_FILE.read_text(encoding="utf-8-sig").splitlines()[:2]
    ]

    req = urllib.request.Request(
        f"{site_url.rstrip('/')}/api/referrals",
        headers={
            "Authorization": f"Bearer {token}",
            # Cloudflare blocks urllib's default agent string with a 403.
            "User-Agent": "fortefi-pull-referrals/1.0",
        },
    )
    with urllib.request.urlopen(req) as res:
        items = json.loads(res.read().decode("utf-8"))

    OUT.write_text(json.dumps(items, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Saved {len(items)} submission(s) to {OUT}")


if __name__ == "__main__":
    main()
