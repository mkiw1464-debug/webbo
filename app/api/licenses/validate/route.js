import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { normalizeKey } from "../../../../lib/license";

export async function POST(req) {
  try {
    const body = await req.json();
    const { key, hwid } = body;
    const k = normalizeKey(key);
    if (!k) return NextResponse.json({ valid: false, error: "Key required" }, { status: 400 });

    const { data, error } = await supabase
      .from("licenses").select("*").eq("license_key", k).maybeSingle();

    if (error) return NextResponse.json({ valid: false, error: "Server error" }, { status: 500 });
    if (!data) return NextResponse.json({ valid: false, error: "Invalid key" }, { status: 404 });
    if (data.status === "banned")
      return NextResponse.json({ valid: false, error: "Key banned" }, { status: 403 });

    if (data.expires_at && new Date(data.expires_at) <= new Date()) {
      await supabase.from("licenses").update({ status: "expired" }).eq("id", data.id);
      return NextResponse.json({ valid: false, error: "Key expired", status: "expired" }, { status: 403 });
    }

    // HWID check — global keys skip
    const isGlobal = data.license_type === "global";
    if (!isGlobal) {
      if (data.hwid && hwid && data.hwid !== hwid)
        return NextResponse.json({ valid: false, error: "HWID mismatch" }, { status: 403 });
    }

    const update = {};
    if (hwid && !data.hwid && !isGlobal) update.hwid = String(hwid);

    if (data.status === "unused") {
      update.status = "active";
      update.activated_at = new Date().toISOString();

      // Hours-based expiry
      if (data.duration_hours && data.duration_hours > 0) {
        update.expires_at = new Date(Date.now() + data.duration_hours * 3600000).toISOString();
      }
      // Days-based expiry
      else if (Number.isFinite(Number(data.duration_days)) && Number(data.duration_days) > 0) {
        update.expires_at = new Date(Date.now() + data.duration_days * 86400000).toISOString();
      }
      // null duration_days = lifetime, no expiry
    }

    if (Object.keys(update).length) {
      await supabase.from("licenses").update(update).eq("id", data.id);
    }

    // Log device
    if (hwid) {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        || req.headers.get("x-real-ip") || null;
      supabase.from("device_logs").insert({
        license_id: data.id,
        hwid: String(hwid),
        ip_address: ip,
      }).then(() => {});
    }

    return NextResponse.json({
      valid: true,
      status: "active",
      license_type: data.license_type,
      is_global: isGlobal,
      duration_hours: data.duration_hours || null,
      duration_days: data.duration_days || null,
      expires_at: update.expires_at || data.expires_at || null,
      hwid: isGlobal ? null : (update.hwid || data.hwid || null),
    });
  } catch {
    return NextResponse.json({ valid: false, error: "Invalid request" }, { status: 400 });
  }
}
