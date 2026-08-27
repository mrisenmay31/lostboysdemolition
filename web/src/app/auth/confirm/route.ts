import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSessionClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/supabase/proxyDecision";

/**
 * Magic-link landing. Supabase's email links carry token_hash + type;
 * verifyOtp() through the cookie-bound session client sets the auth
 * cookies (Route Handlers CAN write cookies, unlike Server Components).
 * Failure lands back on sign-in with a visible error flag — never a
 * silent 500.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = (searchParams.get("type") ?? "email") as EmailOtpType;
  const next = safeNextPath(searchParams.get("next"));

  if (tokenHash) {
    const supabase = await createSessionClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
  }
  return NextResponse.redirect(new URL("/auth/sign-in?error=confirm", request.url));
}
