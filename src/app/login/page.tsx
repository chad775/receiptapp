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
    <div style={{ maxWidth: 480, margin: "60px auto", padding: "40px 32px" }}>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <img 
          src="/logo.png" 
          alt="Boyd Group Services" 
          style={{ 
            maxWidth: "300px", 
            width: "100%", 
            height: "auto",
            marginBottom: 16,
            display: "block",
            marginLeft: "auto",
            marginRight: "auto"
          }}
        />
        <p style={{ fontSize: 16, color: "#666", marginTop: 8 }}>
          Receipt Management Portal
        </p>
      </div>

      <div style={{ 
        border: "1px solid #e0e0e0", 
        borderRadius: 8, 
        padding: 32, 
        background: "#fff",
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)"
      }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8, color: "#1a1a1a" }}>
          Sign In
        </h2>
        <p style={{ marginTop: 8, color: "#666", fontSize: 14 }}>
          Enter your email address and we'll send you a secure sign-in link.
        </p>

        <input
          type="email"
          style={{ 
            width: "100%", 
            padding: "12px 16px", 
            marginTop: 24,
            border: "1px solid #e0e0e0",
            borderRadius: 4,
            fontSize: 14,
            boxSizing: "border-box"
          }}
          placeholder="your.email@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <button
          style={{ 
            width: "100%", 
            padding: 12, 
            marginTop: 16,
            background: email ? "#003d82" : "#ccc",
            color: "white",
            border: "none",
            borderRadius: 4,
            fontWeight: 600,
            fontSize: 14,
            cursor: email ? "pointer" : "not-allowed"
          }}
          onClick={sendMagicLink}
          disabled={!email}
        >
          Send Sign-In Link
        </button>

        {status && (
          <div style={{ 
            marginTop: 16, 
            padding: 12, 
            borderRadius: 4,
            background: status.includes("Error") ? "#fee" : "#efe",
            border: `1px solid ${status.includes("Error") ? "#fcc" : "#cec"}`,
            color: status.includes("Error") ? "#c33" : "#363",
            fontSize: 14
          }}>
            {status}
          </div>
        )}
      </div>
    </div>
  );
}
