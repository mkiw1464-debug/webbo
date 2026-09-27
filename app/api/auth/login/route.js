import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabase } from "../../../../lib/supabase";
import { signToken } from "../../../../lib/auth";

function hash(s) { return crypto.createHash("sha256").update(s).digest("hex"); }

export async function POST(req) {
  try {
    const { username, password } = await req.json();
    if (!username || !password)
      return NextResponse.json({ error: "Username and password required" }, { status: 400 });

    // Developer — hardcoded env
    if (username === process.env.DEVELOPER_USERNAME && password === process.env.DEVELOPER_PASSWORD) {
      const token = await signToken({ sub: "developer", role: "developer", username });
      return NextResponse.json({ token, role: "developer" });
    }

    // Admin or Reseller — from DB
    const { data, error } = await supabase
      .from("users")
      .select("id,username,password_hash,role,credit_balance,is_banned")
      .eq("username", username)
      .maybeSingle();

    if (error) throw error;
    if (!data || data.password_hash !== hash(password))
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

    const token = await signToken({ sub: data.id, role: data.role, username: data.username });
    return NextResponse.json({ token, role: data.role, is_banned: data.is_banned || false });
  } catch (e) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
