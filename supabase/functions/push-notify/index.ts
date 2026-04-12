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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const body = await req.json();
    const { type, subscription, endpoint, user_text } = body;

    // ── Save a new push subscription ─────────────────────────────
    if (type === "subscribe") {
      const r = await supabaseFetch("POST", "/rest/v1/push_subscriptions", {
        endpoint: subscription.endpoint,
        subscription,
        user_text: user_text ?? "",
        notify_times: body.notify_times ?? ["06:00", "12:00", "18:00"],
        updated_at: new Date().toISOString(),
      }, { "Prefer": "resolution=merge-duplicates" });
      return json({ ok: r.ok });
    }

    // ── Update today's focus text for a subscription ──────────────
    if (type === "update-text") {
      const r = await supabaseFetch(
        "PATCH",
        `/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`,
        { user_text, updated_at: new Date().toISOString() }
      );
      return json({ ok: r.ok });
    }

    // ── Update notification times for a subscription ──────────────
    if (type === "update-times") {
      const r = await supabaseFetch(
        "PATCH",
        `/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`,
        { notify_times: body.notify_times, updated_at: new Date().toISOString() }
      );
      const text = await r.text();
      return json({ ok: r.ok, status: r.status, body: text });
    }

    // ── Send a test notification to a single subscriber ──────────
    if (type === "test") {
      const subsRes = await supabaseFetch(
        "GET",
        `/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}&select=subscription`
      );
      const rows: any[] = await subsRes.json();
      if (!rows.length) return json({ ok: false, error: "Endpoint not found in DB" });
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

    // ── Send notifications to all subscribers (called by cron) ───
    if (type === "send") {
      // Only allow calls from cron (service role bearer token)
      const auth = req.headers.get("Authorization") ?? "";
      if (auth !== `Bearer ${SERVICE_KEY}`) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });
      }

      // Current time in Dubai (UTC+4, no DST), expressed as minutes since midnight
      const dubaiMs = Date.now() + 4 * 60 * 60 * 1000;
      const dubaiDate = new Date(dubaiMs);
      const dubaiMinutes = dubaiDate.getUTCHours() * 60 + dubaiDate.getUTCMinutes();
      const dubaiHHMM = `${String(dubaiDate.getUTCHours()).padStart(2, '0')}:${String(dubaiDate.getUTCMinutes()).padStart(2, '0')}`;

      // Helper: parse "HH:MM" to minutes since midnight
      const toMinutes = (hhmm: string) => {
        const [h, m] = hhmm.split(':').map(Number);
        return h * 60 + m;
      };

      const subsRes = await supabaseFetch("GET", "/rest/v1/push_subscriptions");
      const subs: any[] = await subsRes.json();

      let sent = 0;
      const toDelete: string[] = [];

      for (const row of subs) {
        // Fire if any stored time falls within the current 5-minute cron window
        const wantedTimes: string[] = Array.isArray(row.notify_times) ? row.notify_times : ["06:00", "12:00", "18:00"];
        const matches = wantedTimes.some(t => {
          const tm = toMinutes(t);
          return tm >= dubaiMinutes && tm < dubaiMinutes + 5;
        });
        if (!matches) continue;

        const notifBody = row.user_text?.trim()
          ? `Today's focus on: ${row.user_text}`
          : "Open SuperFocus — time to log today!";

        try {
          await webpush.sendNotification(
            row.subscription,
            JSON.stringify({
              title: "SuperFocus",
              body: notifBody,
              icon: "/SuperFocus/icons/icon-192.png",
            })
          );
          sent++;
        } catch (err: any) {
          if (err?.statusCode === 410 || err?.statusCode === 404) {
            toDelete.push(row.endpoint);
          }
        }
      }

      for (const ep of toDelete) {
        await supabaseFetch(
          "DELETE",
          `/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(ep)}`
        );
      }

      return json({ sent, deleted: toDelete.length, dubaiHHMM });
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
