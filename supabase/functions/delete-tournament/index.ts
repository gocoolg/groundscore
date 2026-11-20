import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function safeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

function getServiceRoleKey(): string | null {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;

  // New Supabase projects expose named secret keys through this variable.
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys);
      if (typeof parsed.default === "string") return parsed.default;
    } catch {
      // Fall through to the missing-key response below.
    }
  }
  return null;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const expectedPassword = Deno.env.get("TOURNAMENT_DELETE_PASSWORD");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = getServiceRoleKey();

    if (!expectedPassword || !supabaseUrl || !serviceRoleKey) {
      return json({
        error: "Tournament deletion is not configured. Set the Edge Function secrets and redeploy."
      }, 503);
    }

    const body = await request.json();
    const tournamentId = String(body?.tournamentId ?? "");
    const expectedName = String(body?.expectedName ?? "");
    const password = String(body?.password ?? "");

    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(tournamentId) || !expectedName.trim() || !password) {
      return json({ error: "Tournament, confirmation name and password are required." }, 400);
    }

    if (!safeEqual(password, expectedPassword)) {
      return json({ error: "Incorrect admin password." }, 401);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data, error } = await admin.rpc("delete_tournament_admin", {
      p_tournament_id: tournamentId,
      p_expected_name: expectedName
    });

    if (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      return json({ error: error.message }, status);
    }

    return json({ ok: true, result: data });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Unexpected deletion error."
    }, 500);
  }
});
