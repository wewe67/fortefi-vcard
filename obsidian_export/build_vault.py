#!/usr/bin/env python3
"""
build_vault.py — turn Fortéfi's employees and referrals into an Obsidian vault.

The resulting graph has three tiers:

    Fortéfi employee (tier 0)
        └── Client / first-degree connection (tier 1)
                └── Referral / the client's top 5 (tier 2)

Every note links to its neighbours with [[wikilinks]], so Obsidian's graph view
draws the network automatically. Referral notes carry a consent stamp in their
frontmatter, so the vault doubles as a light audit trail.

People are matched by name: two referrals with the same name are merged into
one note, with links back to every client who named them. If you have genuine
name clashes, disambiguate the names in the source data.

Usage:
    python build_vault.py
    python build_vault.py --referrals ../data/referrals.example.json --out ./obsidian-vault
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")


# --- loading ---------------------------------------------------------------
def load_json(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


# --- filename / link safety ------------------------------------------------
_ILLEGAL = re.compile(r'[\\/:*?"<>|#^\[\]]')


def safe_filename(name: str) -> str:
    """Obsidian-safe file stem. Keeps the human name readable."""
    cleaned = _ILLEGAL.sub(" ", name).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned or "Unnamed"


def link(name: str) -> str:
    return f"[[{safe_filename(name)}]]"


def yaml_value(value) -> str:
    """Quote strings, leave numbers and booleans bare so Dataview can query them."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return '"' + str(value).replace('"', "'") + '"'


def write_note(folder: Path, name: str, frontmatter: dict, body: str) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    fm_lines = ["---"]
    for key, val in frontmatter.items():
        if isinstance(val, list):
            fm_lines.append(f"{key}:")
            fm_lines.extend(f"  - {yaml_value(v)}" for v in val)
        else:
            fm_lines.append(f"{key}: {yaml_value(val)}")
    fm_lines.append("---")
    content = "\n".join(fm_lines) + "\n\n" + body.rstrip() + "\n"
    (folder / f"{safe_filename(name)}.md").write_text(content, encoding="utf-8")


# --- canvas (radial mindmap) -----------------------------------------------
def _sides(ax, ay, bx, by):
    """Pick which edge of each node a connector should leave/enter from."""
    dx, dy = bx - ax, by - ay
    if abs(dx) >= abs(dy):
        return ("right", "left") if dx >= 0 else ("left", "right")
    return ("bottom", "top") if dy >= 0 else ("top", "bottom")


def write_canvas(out: Path, employees, emp_by_id, emp_to_clients,
                 client_info, client_referrals) -> None:
    """Generate a Fortéfi-in-the-centre mindmap as an Obsidian .canvas file.

    Rings, outward: Fortéfi (centre) → employees → clients → referrals.
    Each branch gets an angular slice sized by how much sits under it, so
    busy employees/clients spread out instead of overlapping.
    """
    RING = {"emp": 560, "client": 1080, "ref": 1560}
    SIZE = {"fortefi": (320, 160), "emp": (240, 100),
            "client": (210, 88), "ref": (196, 76)}
    COLOR = {"fortefi": "1", "emp": "2", "client": "4", "ref": "6"}

    nodes, edges = [], []
    eid = [0]

    def node(kind, file_path, cx, cy):
        w, h = SIZE[kind]
        nid = f"n{eid[0]}"; eid[0] += 1
        nodes.append({
            "id": nid, "type": "file", "file": file_path,
            "x": round(cx - w / 2), "y": round(cy - h / 2),
            "width": w, "height": h, "color": COLOR[kind],
        })
        return nid, cx, cy

    def edge(a, b):
        ax, ay, bx, by = a[1], a[2], b[1], b[2]
        fs, ts = _sides(ax, ay, bx, by)
        edges.append({"id": f"e{eid[0]}", "fromNode": a[0], "toNode": b[0],
                      "fromSide": fs, "toSide": ts, "color": COLOR["emp"]})
        eid[0] += 1

    fortefi = node("fortefi", "Fortefi.md", 0, 0)

    # Order employees: those defined in employees.json first, then any
    # unknown employee_ids that still have clients attached.
    ordered = [e["id"] for e in employees]
    ordered += [eid_ for eid_ in emp_to_clients if eid_ not in emp_by_id]

    def client_weight(c):
        return max(1, len({r["name"] for r in client_referrals.get(c, [])}))

    def emp_weight(eid_):
        cs = emp_to_clients.get(eid_, set())
        return max(1, sum(client_weight(c) for c in cs)) if cs else 1

    total = sum(emp_weight(e) for e in ordered) or 1
    drawn_refs: set[str] = set()
    cursor = -math.pi / 2  # start at the top, sweep clockwise

    for eid_ in ordered:
        span = 2 * math.pi * emp_weight(eid_) / total
        emp = emp_by_id.get(eid_, {"name": eid_})
        ename = emp.get("name", eid_)
        a_emp = cursor + span / 2
        en = node("emp", f"Employees/{safe_filename(ename)}.md",
                  RING["emp"] * math.cos(a_emp), RING["emp"] * math.sin(a_emp))
        edge(fortefi, en)

        clients = sorted(emp_to_clients.get(eid_, []))
        csub = cursor
        ew = emp_weight(eid_)
        for c in clients:
            cspan = span * client_weight(c) / ew
            a_cli = csub + cspan / 2
            cn = node("client", f"Clients/{safe_filename(c)}.md",
                      RING["client"] * math.cos(a_cli),
                      RING["client"] * math.sin(a_cli))
            edge(en, cn)

            refs = list(dict.fromkeys(
                r["name"] for r in client_referrals.get(c, [])
            ))
            refs = [r for r in refs if r not in client_info]  # clients shown once
            rsub = csub
            for r in refs:
                rspan = cspan / max(1, len(refs))
                a_ref = rsub + rspan / 2
                if r not in drawn_refs:
                    rn = node("ref", f"Referrals/{safe_filename(r)}.md",
                              RING["ref"] * math.cos(a_ref),
                              RING["ref"] * math.sin(a_ref))
                    drawn_refs.add(r)
                    edge(cn, rn)
                rsub += rspan
            csub += cspan
        cursor += span

    canvas = {"nodes": nodes, "edges": edges}
    (out / "Fortéfi Mindmap.canvas").write_text(
        json.dumps(canvas, ensure_ascii=False, indent=2), encoding="utf-8"
    )


# --- core build ------------------------------------------------------------
def build(employees: list[dict], referrals: list[dict], out: Path) -> dict:
    emp_by_id = {e["id"]: e for e in employees}

    emp_to_clients: dict[str, set[str]] = defaultdict(set)
    client_info: dict[str, dict] = {}
    client_referrals: dict[str, list[dict]] = defaultdict(list)
    referral_sources: dict[str, list[dict]] = defaultdict(list)
    referral_detail: dict[str, dict] = {}

    for sub in referrals:
        emp_id = sub.get("employee_id", "unknown")
        client = sub.get("client", {})
        cname = (client.get("name") or "").strip()
        if not cname:
            continue

        emp_to_clients[emp_id].add(cname)
        # Last submission wins for client metadata, but keep the first employee tie.
        info = client_info.setdefault(
            cname, {"company": "", "email": "", "employee_id": emp_id}
        )
        if client.get("company"):
            info["company"] = client["company"]
        if client.get("email"):
            info["email"] = client["email"]

        consent = sub.get("consent", {})
        consent_stamp = (
            "permission_or_warm_intro"
            if consent.get("has_permission_or_will_introduce")
            else "unconfirmed"
        )

        for ref in sub.get("referrals", []):
            rname = (ref.get("name") or "").strip()
            if not rname:
                continue
            client_referrals[cname].append({"name": rname, **ref})
            referral_sources[rname].append({
                "client": cname,
                "designation": ref.get("designation", ""),
            })
            detail = referral_detail.setdefault(
                rname,
                {
                    "email": "",
                    "phone": "",
                    "designation": "",
                    "company": "",
                    "consent": consent_stamp,
                },
            )
            for field in ("email", "phone", "designation", "company"):
                if ref.get(field):
                    detail[field] = ref[field]

    # --- Fortefi root node (hub that all other nodes link to) ---
    emp_links = [f"- {link(e.get('name', e['id']))}" for e in employees]
    write_note(
        out,
        "Fortefi",
        {"type": "company", "tier": -1},
        "\n".join(["# Fortéfi Capital Sdn. Bhd.", "",
                   "## Team"] + emp_links),
    )

    # --- employee notes (tier 0) ---
    for emp in employees:
        clients = sorted(emp_to_clients.get(emp["id"], []))
        body = [
            f"# {emp.get('name', emp['id'])}",
            f"**{emp.get('title', '')}** · [[Fortefi|Fortéfi Capital Sdn. Bhd.]]",
            "",
            "## First-degree connections (clients)",
        ]
        body += [f"- {link(c)}" for c in clients] or ["_None yet._"]
        write_note(
            out / "Employees",
            emp.get("name", emp["id"]),
            {
                "type": "employee",
                "tier": 0,
                "title": emp.get("title", ""),
                "email": emp.get("email", ""),
            },
            "\n".join(body),
        )

    # Submissions from employees not in employees.json still get a node.
    for emp_id, clients in emp_to_clients.items():
        if emp_id in emp_by_id:
            continue
        body = [f"# {emp_id}", f"**Unknown employee** · [[Fortefi|Fortéfi Capital Sdn. Bhd.]]",
                "", "## First-degree connections (clients)"]
        body += [f"- {link(c)}" for c in sorted(clients)]
        write_note(out / "Employees", emp_id,
                   {"type": "employee", "tier": 0, "title": "", "email": ""},
                   "\n".join(body))

    # --- client notes (tier 1) ---
    for cname, info in client_info.items():
        emp = emp_by_id.get(info["employee_id"], {"name": info["employee_id"]})
        body = [
            f"# {cname}",
            f"Client · {info['company']}".rstrip(" ·"),
            f"Introduced through {link(emp.get('name', info['employee_id']))}.",
            "",
            "## Their referrals (top 5)",
        ]
        rows = client_referrals.get(cname, [])
        if rows:
            seen = set()
            for r in rows:
                if r["name"] in seen:
                    continue
                seen.add(r["name"])
                desig = f" — {r['designation']}" if r.get("designation") else ""
                comp = f", {r['company']}" if r.get("company") else ""
                body.append(f"- {link(r['name'])}{desig}{comp}")
        else:
            body.append("_None shared._")
        write_note(
            out / "Clients",
            cname,
            {
                "type": "client",
                "tier": 1,
                "company": info["company"],
                "email": info["email"],
                "introduced_by": emp.get("name", info["employee_id"]),
            },
            "\n".join(body),
        )

    # --- referral notes (tier 2) ---
    # A person can be referred AND later become a client themselves. In that
    # case the client note (tier 1) is the canonical node — writing a second
    # note with the same name would make Obsidian's [[wikilinks]] ambiguous.
    for rname, detail in referral_detail.items():
        if rname in client_info:
            continue
        sources = referral_sources[rname]
        seen_clients = []
        for s in sources:
            if s["client"] not in seen_clients:
                seen_clients.append(s["client"])

        headline = " · ".join(
            v for v in (detail["designation"], detail["company"]) if v
        )
        body = [f"# {rname}"]
        if headline:
            body.append(f"Referral · {headline}")
        else:
            body.append("Referral")
        body += ["", "## Referred by"]
        body += [f"- {link(c)}" for c in seen_clients]

        contact_bits = []
        if detail["email"]:
            contact_bits.append(f"**Email:** {detail['email']}")
        if detail["phone"]:
            contact_bits.append(f"**Phone:** {detail['phone']}")
        if contact_bits:
            body += [""] + contact_bits

        write_note(
            out / "Referrals",
            rname,
            {
                "type": "referral",
                "tier": 2,
                "email": detail["email"],
                "phone": detail["phone"],
                "designation": detail["designation"],
                "company": detail["company"],
                "consent": detail["consent"],
                "referred_by": seen_clients,
            },
            "\n".join(body),
        )

    # --- index / map of content ---
    index = ["# Fortéfi Network Map", "",
             "Open the graph view (the orbit icon) to see the three tiers.", "",
             "## Employees and their clients", ""]
    for emp in employees:
        clients = sorted(emp_to_clients.get(emp["id"], []))
        index.append(f"### {link(emp.get('name', emp['id']))}")
        if clients:
            for c in clients:
                n = len({r['name'] for r in client_referrals.get(c, [])})
                index.append(f"- {link(c)} — {n} referral(s)")
        else:
            index.append("- _No clients onboarded yet._")
        index.append("")
    write_note(out, "Network Map", {"type": "index", "tier": -1}, "\n".join(index))

    # --- canvas mindmap (Fortéfi centred) ---
    write_canvas(out, employees, emp_by_id, emp_to_clients,
                 client_info, client_referrals)

    return {
        "employees": len(employees),
        "clients": len(client_info),
        "referrals": len(referral_detail),
    }


def main() -> None:
    here = Path(__file__).resolve().parent
    data = here.parent / "data"

    p = argparse.ArgumentParser(description="Build an Obsidian vault from Fortéfi referral data.")
    p.add_argument("--employees", default=str(data / "employees.json"))
    p.add_argument("--referrals", default=str(data / "referrals.json"))
    p.add_argument("--out", default=str(here / "obsidian-vault"))
    args = p.parse_args()

    employees = load_json(Path(args.employees))
    referrals = load_json(Path(args.referrals))
    if not referrals:
        example = data / "referrals.example.json"
        if example.exists():
            print("No referrals.json found — using referrals.example.json for the demo.")
            referrals = load_json(example)

    out = Path(args.out)
    stats = build(employees, referrals, out)
    print(f"Vault written to {out}")
    print(f"  {stats['employees']} employee note(s)")
    print(f"  {stats['clients']} client note(s)")
    print(f"  {stats['referrals']} referral note(s)")
    print("Open that folder as a vault in Obsidian, then switch on the graph view.")


if __name__ == "__main__":
    main()
