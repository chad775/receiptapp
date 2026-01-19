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
    <div style={{ position: "fixed", top: 12, right: 12, zIndex: 2000 }}>
      <Link
        href="/staff"
        style={{ 
          fontSize: 12, 
          opacity: 0.8, 
          textDecoration: "none",
          padding: "8px 12px",
          background: "rgba(255, 255, 255, 0.9)",
          borderRadius: 4,
          border: "1px solid #e0e0e0",
          display: "inline-block",
          minHeight: 32,
          lineHeight: "16px",
        }}
      >
        Staff Review
      </Link>
    </div>
  );
}
