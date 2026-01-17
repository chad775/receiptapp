"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [msg, setMsg] = useState("Signing you in…");

  useEffect(() => {
    async function finalizeLogin() {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");

      if (!code) {
        setMsg("Missing login code. Sending you back to login…");
        router.replace("/login");
        return;
      }

      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        setMsg(`Login error: ${error.message}`);
        return;
      }

      if (data.session) {
        router.replace("/dashboard");
      } else {
        setMsg("No session created. Sending you back to login…");
        router.replace("/login");
      }
    }

    finalizeLogin();
  }, [router]);

  return (
    <div style={{ maxWidth: 520, margin: "40px auto", padding: 16 }}>
      <p>{msg}</p>
    </div>
  );
}
