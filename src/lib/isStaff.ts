import "server-only";
import { supabaseServer } from "@/lib/supabaseServer";

export async function isStaffMember() {
  const supabase = supabaseServer();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return { isStaff: false as const, user: null };
  }

  const { data, error } = await supabase
    .from("firm_members")
    .select("role")
    .eq("user_id", user.id)
    .in("role", ["staff", "admin"])
    .maybeSingle();

  if (error || !data) {
    return { isStaff: false as const, user };
  }

  return {
    isStaff: true as const,
    user,
    role: data.role as "staff" | "admin",
  };
}