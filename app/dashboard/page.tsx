import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardClient from "@/components/dashboard-client";
import SetupError from "@/components/setup-error";
import type { Profile } from "@/lib/types";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");

  // The app's tables live in the event schema, not public.
  // Guard against a missing profile before rendering DashboardClient.
  const { data: profile, error: profileError } = await supabase
    .schema("event")
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("[Eventra] Cannot read event.profiles:", { code: profileError.code, message: profileError.message, details: profileError.details });
    return <SetupError kind="query-error" code={profileError.code} />;
  }
  if (!profile) {
    console.error("[Eventra] Profile missing from event.profiles for authenticated user:", user.id);
    return <SetupError kind="missing-profile" />;
  }

  const normalizedProfile: Profile = {
    ...(profile as Profile),
    full_name:
      typeof profile.full_name === "string" && profile.full_name.trim()
        ? profile.full_name
        : (user.email?.split("@")[0] || "Pengguna"),
  };

  return <DashboardClient profile={normalizedProfile} />;
}
