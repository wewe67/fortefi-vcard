/* =========================================================
   Referral submissions — Cloudflare Pages Function
   ---------------------------------------------------------
   Same contract as the Flask backend, but records go into
   the REFERRALS KV namespace instead of data/referrals.json.

   POST /api/referrals          submit a referral (public)
   GET  /api/referrals          export all records — requires
                                Authorization: Bearer <ADMIN_TOKEN>
                                (used by pull_referrals.py)
   ========================================================= */

const MAX_REFERRALS = 5;

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  // Consent is mandatory. No consent, no record.
  const consent = body.consent || {};
  if (!consent.has_permission_or_will_introduce) {
    return Response.json({ error: "consent is required" }, { status: 400 });
  }

  const client = body.client || {};
  if (!client.name) {
    return Response.json({ error: "client name is required" }, { status: 400 });
  }

  let referrals = (body.referrals || []).filter((r) => r && r.name);
  if (referrals.length === 0) {
    return Response.json(
      { error: "at least one referral name is required" },
      { status: 400 }
    );
  }
  referrals = referrals.slice(0, MAX_REFERRALS); // honour the top-5 cap server-side too

  const submissionId = `sub_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const record = {
    submission_id: submissionId,
    employee_id: body.employee_id || "unknown",
    submitted_at: body.submitted_at || new Date().toISOString(),
    source: body.source || "manual", // m365 | picker | csv | manual
    client: {
      name: client.name || "",
      company: client.company || "",
      email: client.email || "",
    },
    consent: {
      has_permission_or_will_introduce: true,
      consent_text_version: consent.consent_text_version || "",
      ip_recorded: false,
    },
    referrals: referrals.map((r) => ({
      name: r.name || "",
      email: r.email || "",
      phone: r.phone || "",
      designation: r.designation || "",
      company: r.company || "",
    })),
  };

  await env.REFERRALS.put(submissionId, JSON.stringify(record));
  return Response.json({ ok: true, submission_id: submissionId }, { status: 201 });
}

export async function onRequestGet({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const items = [];
  let cursor;
  do {
    const page = await env.REFERRALS.list({ cursor });
    for (const key of page.keys) {
      const value = await env.REFERRALS.get(key.name, "json");
      if (value) items.push(value);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  items.sort((a, b) =>
    String(a.submitted_at || "").localeCompare(String(b.submitted_at || ""))
  );
  return Response.json(items);
}
