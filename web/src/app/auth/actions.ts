"use server";

import { redirect } from "next/navigation";
import { createSessionClient } from "@/lib/supabase/server";

export async function signOutAction(): Promise<void> {
  const supabase = await createSessionClient();
  await supabase.auth.signOut();
  redirect("/");
}
