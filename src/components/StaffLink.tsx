"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

export default function StaffLink() {
  const [isStaff, setIsStaff] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) return;

      const res = await supabase
        .from("firm_members")
        .select("role")
        .eq("user_id", userData.user.id)
        .in("role", ["staff", "admin"])
        .maybeSingle();

      if (!cancelled && !res.error && res.data) {
        setIsStaff(true);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isStaff) return null;

  return (
    <div style={{ position: "fixed", top: 12, right: 12, zIndex: 50 }}>
      <Link
        href="/staff"
        style={{ fontSize: 12, opacity: 0.8, textDecoration: "none" }}
      >
        Staff Review
      </Link>
    </div>
  );
}
