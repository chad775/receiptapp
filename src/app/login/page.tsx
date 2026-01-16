"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  async function sendMagicLink() {
    setStatus(null);
    try {
      const result = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (result.error) {
        setStatus(`Error: ${result.error.message}`);
      } else {
        setStatus("Check your email for the magic link.");
      }
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Sign in TEST 999</h1>
      <p style={{ marginTop: 8 }}>We'll email you a magic link.</p>

      <input
        type="email"
        style={{ width: "100%", padding: 12, marginTop: 16 }}
        placeholder="you@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <button
        style={{ width: "100%", padding: 12, marginTop: 12 }}
        onClick={sendMagicLink}
        disabled={!email}
      >
        Send magic link
      </button>

      {status && <p style={{ marginTop: 12 }}>{status}</p>}
    </div>
  );
}
