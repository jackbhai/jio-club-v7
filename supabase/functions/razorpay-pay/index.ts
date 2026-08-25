// Razorpay payment — create order + server-side signature verification (ZERO DEPS, pure fetch)
// Flow: client -> create-order -> checkout -> verify (HMAC-SHA256 signature)
// Secrets read from settings table (admin-managed). Never exposed to the client.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REST = SUPABASE_URL + "/rest/v1";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function resp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}
async function rest(method: string, path: string, payload?: unknown, userJwt?: string) {
  const r = await fetch(REST + path, {
    method,
    headers: {
      apikey: SERVICE,
      Authorization: "Bearer " + (userJwt || SERVICE),
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: payload ? JSON.stringify(payload) : undefined
  });
  const text = await r.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!r.ok) {
    const msg = (json as any)?.message || (json as any)?.error || r.statusText;
    throw new Error(String(msg) + " (" + r.status + ")");
  }
  return json;
}
async function getUser(userJwt: string): Promise<string | null> {
  const r = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: SERVICE, Authorization: "Bearer " + userJwt }
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j?.id || null;
}
async function getPayments(): Promise<any> {
  const rows = await rest("GET", "/settings?key=eq.payments&select=value") as any[];
  return rows?.[0]?.value || {};
}
function basicAuth(key: string, secret: string) {
  return "Basic " + btoa(key + ":" + secret);
}
async function hmacSha256Hex(data: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    const userJwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const uid = await getUser(userJwt);
    if (!uid) return resp({ error: "unauthorized" }, 401);

    const payload = await req.json().catch(() => ({}));
    const pay = await getPayments();
    const env = payload.env === "live" && pay.env === "live" ? "live" : "test";
    const key = env === "live" ? pay.liveKeyId : pay.testKeyId;
    const secret = env === "live" ? pay.liveKeySecret : pay.testKeySecret;
    if (!key || !secret) return resp({ error: "Razorpay " + env + " keys not configured" }, 400);

    if (payload.action === "create-order") {
      const amountPaise = Math.round(Number(payload.amount) * 100);
      if (!amountPaise || amountPaise <= 0) return resp({ error: "invalid amount" }, 400);
      if (amountPaise > 100000000) return resp({ error: "amount too large" }, 400);
      const r = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: basicAuth(key, secret) },
        body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt: "dep_" + uid.slice(0, 8) })
      });
      const rj = await r.json().catch(() => ({}));
      if (!r.ok || !rj.id) return resp({ error: rj?.error?.description || "order creation failed" }, 400);
      return resp({ order_id: rj.id, amount: rj.amount / 100, env });
    }

    if (payload.action === "verify") {
      if (!payload.order_id || !payload.payment_id || !payload.signature) {
        return resp({ error: "missing fields" }, 400);
      }
      const expected = await hmacSha256Hex(payload.order_id + "|" + payload.payment_id, secret);
      if (expected.toLowerCase() !== String(payload.signature).toLowerCase()) {
        return resp({ error: "signature mismatch — payment rejected" }, 400);
      }
      const pr = await fetch("https://api.razorpay.com/v1/payments/" + payload.payment_id, {
        headers: { Authorization: basicAuth(key, secret) }
      });
      const pj = await pr.json().catch(() => ({}));
      if (pj?.status !== "captured") return resp({ error: "payment not captured (" + (pj?.status || "unknown") + ")" }, 400);

      const existing = await rest("GET", "/deposits?upi_ref=eq." + payload.payment_id + "&select=id") as any[];
      if (existing?.length) return resp({ ok: true, already: true });

      const orr = await fetch("https://api.razorpay.com/v1/orders/" + payload.order_id, {
        headers: { Authorization: basicAuth(key, secret) }
      });
      const oj = await orr.json().catch(() => ({}));
      const amount = (oj?.amount ?? 0) / 100;
      if (amount <= 0) return resp({ error: "order amount invalid" }, 400);

      // ATOMIC + idempotent credit via a single server-side RPC (no read-then-write race,
      // replay-safe by payment_id). Replaces the previous read-then-write race.
      const cred = (await rest("POST", "/rpc/razorpay_credit", {
        p_uid: uid, p_amount: amount, p_payment_id: payload.payment_id
      })) as any;
      if (cred?.[0] && cred?.[0].ok === false) {
        return resp({ error: cred[0].message || "credit failed" }, 400);
      }
      const credRow = Array.isArray(cred) ? cred[0] : cred;
      return resp({ ok: true, amount, balance: credRow?.balance, receipt: credRow?.receipt, already: !!credRow?.already });
    }

    return resp({ error: "unknown action" }, 400);
  } catch (e) {
    return resp({ error: String((e as Error)?.message || e) }, 500);
  }
});
