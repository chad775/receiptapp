"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

function parseHashParams(hash: string) {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);
  return {
    access_token: params.get("access_token"),
    refresh_token: params.get("refresh_token"),
  };
}

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    async function handleMagicLinkAtRoot() {
      const hash = window.location.hash || "";
      if (!hash.includes("access_token=")) return;

      const { access_token, refresh_token } = parseHashParams(hash);
      if (!access_token || !refresh_token) return;

      const { data, error } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });

      if (!error && data.session) {
        // clear the hash so it doesn't hang around
        window.history.replaceState({}, document.title, "/");
        router.replace("/dashboard");
      }
    }

    handleMagicLinkAtRoot();
  }, [router]);

  // Keep your existing landing UI as-is
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm">
        <h1 className="text-4xl font-bold text-center mb-8">
          Welcome to Receipt App
        </h1>
        <p className="text-center text-lg">
          Get started by editing{" "}
          <code className="font-mono font-bold">src/app/page.tsx</code>
        </p>
      </div>
    </main>
  );
}
