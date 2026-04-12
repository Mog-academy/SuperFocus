// @ts-nocheck
import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC  = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

webpush.setVapidDetails("mailto:admin@superfocus.app", VAPID_PUBLIC, VAPID_PRIVATE);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ROW = "/rest/v1/superfocus_config?id=eq.1";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const body = await req.json();
    const { type } = body;

    // ── Save / refresh push subscription ─────────────────────────
    if (type === "subscribe") {
      const r = await supabaseFetch("PATCH", ROW, {
        subscription: body.subscription,
        user_text: body.user_text ?? "",
        notify_times: body.notify_times ?? ["06:00", "12:00", "18:00"],
        updated_at: new Date().toISOString(),
      });
      return json({ ok: r.ok, status: r.status });
    }

    // ── Update today's focus text ─────────────────────────────────
    if (type === "update-text") {
      const r = await supabaseFetch("PATCH", ROW, {
        user_text: body.user_text,
        updated_at: new Date().toISOString(),
      });
      return json({ ok: r.ok });
    }

    // ── Update notification times ─────────────────────────────────
    if (type === "update-times") {
      const r = await supabaseFetch("PATCH", ROW, {
        notify_times: body.notify_times,
        updated_at: new Date().toISOString(),
      });
      const text = await r.text();
      return json({ ok: r.ok, status: r.status, body: text });
    }

    // ── Send a test notification immediately ──────────────────────
    if (type === "test") {
      const res = await supabaseFetch("GET", ROW + "&select=subscription");
      const rows: any[] = await res.json();
      if (!rows.length || !rows[0].subscription) return json({ ok: false, error: "No subscription in DB" });
      await webpush.sendNotification(
        rows[0].subscription,
        JSON.stringify({
          title: "SuperFocus",
          body: "Test notification — it works!",
          icon: "/SuperFocus/icons/icon-192.png",
        })
      );
      return json({ ok: true });
    }

    // ── Send notification if time matches (called by cron) ────────
    if (type === "send") {
      const auth = req.headers.get("Authorization") ?? "";
      if (auth !== `Bearer ${SERVICE_KEY}`) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });
      }

      // Current time in Dubai (UTC+4, no DST)
      const dubaiMs = Date.now() + 4 * 60 * 60 * 1000;
      const dubaiDate = new Date(dubaiMs);
      const dubaiMinutes = dubaiDate.getUTCHours() * 60 + dubaiDate.getUTCMinutes();
      const dubaiHHMM = `${String(dubaiDate.getUTCHours()).padStart(2, '0')}:${String(dubaiDate.getUTCMinutes()).padStart(2, '0')}`;

      const toMinutes = (hhmm: string) => {
        const [h, m] = hhmm.split(':').map(Number);
        return h * 60 + m;
      };

      const res = await supabaseFetch("GET", ROW);
      const rows: any[] = await res.json();
      if (!rows.length || !rows[0].subscription) return json({ sent: 0, reason: "No subscription", dubaiHHMM });

      const row = rows[0];
      const wantedTimes: string[] = Array.isArray(row.notify_times) ? row.notify_times : ["06:00", "12:00", "18:00"];
      const matches = wantedTimes.some(t => {
        const tm = toMinutes(t);
        return tm >= dubaiMinutes && tm < dubaiMinutes + 5;
      });
      if (!matches) return json({ sent: 0, reason: "Not a notification time", dubaiHHMM });

      const notifBody = row.user_text?.trim()
        ? `Today's focus on: ${row.user_text}`
        : "Open SuperFocus — time to log today!";

      await webpush.sendNotification(
        row.subscription,
        JSON.stringify({
          title: "SuperFocus",
          body: notifBody,
          icon: "/SuperFocus/icons/icon-192.png",
        })
      );
      return json({ sent: 1, dubaiHHMM });
    }

    return new Response(JSON.stringify({ error: "Unknown type" }), { status: 400, headers: cors });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: cors });
  }
});

// ── Helper: call Supabase REST API with service role ──────────
async function supabaseFetch(method: string, path: string, body?: any, extraHeaders: Record<string, string> = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function json(data: any) {
  return new Response(JSON.stringify(data), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
