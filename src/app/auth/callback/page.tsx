"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

function parseHashParams(hash: string) {
  // hash comes in like: "#access_token=...&refresh_token=...&type=magiclink"
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);
  return {
    access_token: params.get("access_token"),
    refresh_token: params.get("refresh_token"),
    type: params.get("type"),
    expires_in: params.get("expires_in"),
    token_type: params.get("token_type"),
  };
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const [msg, setMsg] = useState("Signing you in…");

  useEffect(() => {
    async function finalizeLogin() {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");

      // 1) PKCE flow: ?code=...
      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);

        if (error) {
          setMsg(`Login error (code exchange): ${error.message}`);
          return;
        }

        if (data.session) {
          router.replace("/dashboard");
          return;
        }

        setMsg("No session created after code exchange. Redirecting to login…");
        router.replace("/login");
        return;
      }

      // 2) Implicit flow: #access_token=...&refresh_token=...
      if (url.hash) {
        const { access_token, refresh_token } = parseHashParams(url.hash);

        if (access_token && refresh_token) {
          const { data, error } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });

          if (error) {
            setMsg(`Login error (setSession): ${error.message}`);
            return;
          }

          if (data.session) {
            router.replace("/dashboard");
            return;
          }
        }
      }

      setMsg("No login details found. Redirecting to login…");
      router.replace("/login");
    }

    finalizeLogin();
  }, [router]);

  return (
    <div style={{ maxWidth: 520, margin: "40px auto", padding: 16 }}>
      <p>{msg}</p>
    </div>
  );
}
