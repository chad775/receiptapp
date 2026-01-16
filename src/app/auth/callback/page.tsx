"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    // When the user clicks the magic link, Supabase stores the session automatically in the browser.
    // We can just redirect.
    supabase.auth.getSession().then(() => {
      router.replace("/dashboard");
    });
  }, [router]);

  return (
    <div style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <p>Signing you in…</p>
    </div>
  );
}
