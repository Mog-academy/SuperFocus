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

    // ── Get all config ────────────────────────────────────────────
    if (type === "get-all") {
      const res = await supabaseFetch("GET", ROW + "&select=notify_times,start_date,end_date,entries,categories,cycles,active_cycle_id");
      const rows: any[] = await res.json();
      const row = rows[0] ?? {};
      return json({
        ok: true,
        notify_times: row.notify_times ?? ["06:00", "12:00", "18:00"],
        start_date: row.start_date ?? "",
        end_date: row.end_date ?? "",
        entries: row.entries ?? {},
        categories: row.categories ?? [],
        cycles: row.cycles ?? [],
        active_cycle_id: row.active_cycle_id ?? "",
      });
    }

    // ── Save app data (date range + entries) ──────────────────────
    if (type === "save-data") {
      const r = await supabaseUpsert({
        cycles: body.cycles ?? [],
        active_cycle_id: body.active_cycle_id ?? "",
        updated_at: new Date().toISOString(),
      });
      return json({ ok: r.ok });
    }

    // ── Save / refresh push subscription ─────────────────────────
    if (type === "subscribe") {
      const r = await supabaseUpsert({
        subscription: body.subscription,
        user_text: body.user_text ?? "",
        notify_times: body.notify_times ?? ["06:00", "12:00", "18:00"],
        updated_at: new Date().toISOString(),
      });
      return json({ ok: r.ok, status: r.status });
    }

    // ── Update today's focus text ─────────────────────────────────
    if (type === "update-text") {
      const r = await supabaseUpsert({
        user_text: body.user_text,
        updated_at: new Date().toISOString(),
      });
      return json({ ok: r.ok });
    }

    // ── Update notification times ─────────────────────────────────
    if (type === "update-times") {
      const r = await supabaseUpsert({
        notify_times: body.notify_times,
        updated_at: new Date().toISOString(),
      });
      const text = await r.text();
      return json({ ok: r.ok, status: r.status, body: text });
    }

    // ── Debug: show DB state + time match info ────────────────────
    if (type === "debug") {
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
      const row = rows[0] ?? null;

      const hasSubscription = !!(row?.subscription);
      const notifyTimes: string[] = Array.isArray(row?.notify_times) ? row.notify_times : [];
      const timeMatches = notifyTimes.map(t => ({
        time: t,
        windowStart: dubaiHHMM,
        windowEnd: `${String(dubaiDate.getUTCHours()).padStart(2,'0')}:${String(dubaiDate.getUTCMinutes() + 4).padStart(2,'0')}`,
        wouldFire: (() => { const tm = toMinutes(t); return tm >= dubaiMinutes && tm < dubaiMinutes + 5; })(),
      }));

      return json({
        ok: true,
        dubaiTime: dubaiHHMM,
        hasSubscription,
        notifyTimes,
        timeMatches,
        userText: row?.user_text ?? null,
        dbRowFound: !!row,
        lastSendLog: row?.last_send_log ?? "(no log yet)",
      });
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
      if (!rows.length || !rows[0].subscription) {
        await supabaseUpsert({ last_send_log: `No subscription at ${dubaiHHMM}` });
        return json({ sent: 0, reason: "No subscription", dubaiHHMM });
      }

      const row = rows[0];
      const wantedTimes: string[] = Array.isArray(row.notify_times) ? row.notify_times : ["06:00", "12:00", "18:00"];
      const matches = wantedTimes.some(t => {
        const tm = toMinutes(t);
        return tm >= dubaiMinutes && tm < dubaiMinutes + 5;
      });
      if (!matches) {
        await supabaseUpsert({ last_send_log: `Cron reached at ${dubaiHHMM}, no match (times: ${JSON.stringify(wantedTimes)})` });
        return json({ sent: 0, reason: "Not a notification time", dubaiHHMM });
      }

      const notifBody = row.user_text?.trim()
        ? `Today's focus on: ${row.user_text}`
        : "Open SuperFocus — time to log today!";

      let sendResult = "";
      try {
        await webpush.sendNotification(
          row.subscription,
          JSON.stringify({
            title: "SuperFocus",
            body: notifBody,
            icon: "/SuperFocus/icons/icon-192.png",
          })
        );
        sendResult = `✓ Sent at ${dubaiHHMM}`;
      } catch (err: any) {
        sendResult = `✗ webpush error at ${dubaiHHMM}: ${err?.message ?? err}`;
      }

      await supabaseUpsert({ last_send_log: sendResult });
      return json({ sent: 1, dubaiHHMM, sendResult });
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

// ── Upsert row id=1 (creates if missing, merges if exists) ────
async function supabaseUpsert(data: any) {
  return supabaseFetch("POST", "/rest/v1/superfocus_config", { id: 1, ...data }, {
    "Prefer": "resolution=merge-duplicates",
  });
}

function json(data: any) {
  return new Response(JSON.stringify(data), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
