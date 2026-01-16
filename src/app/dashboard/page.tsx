"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type BatchRow = {
  id: string;
  name: string | null;
  locked: boolean;
  submitted_at: string | null;
  submitted_count: number | null;
  created_at: string;
};

function defaultBatchName(): string {
  const d = new Date();
  const month = d.toLocaleString(undefined, { month: "long" });
  const year = d.getFullYear();
  return "Receipts - " + month + " " + year;
}

export default function DashboardPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const [newName, setNewName] = useState<string>(defaultBatchName());
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    setMsg(null);

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      router.replace("/login");
      return;
    }

    const res = await supabase
      .from("batches")
      .select("id,name,locked,submitted_at,submitted_count,created_at")
      .order("created_at", { ascending: false });

    if (res.error) {
      setMsg(res.error.message);
      setBatches([]);
      setLoading(false);
      return;
    }

    setBatches(res.data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  async function createBatch() {
    setMsg(null);

    const name = (newName || "").trim();
    if (!name) {
      setMsg("Please enter a batch name.");
      return;
    }

    setCreating(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) {
        router.replace("/login");
        return;
      }

      const ins = await supabase
        .from("batches")
        .insert({
          user_id: user.id,
          name: name,
          locked: false
        })
        .select("id")
        .single();

      if (ins.error) throw new Error(ins.error.message);

      const id = ins.data.id as string;
      await load();
      router.push("/batches/" + id);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to create batch.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ maxWidth: 980, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <h1 style={{ fontSize: 24, fontWeight: 900 }}>Dashboard</h1>
        <button onClick={signOut} style={{ padding: 10 }}>
          Sign out
        </button>
      </div>

      <div
        style={{
          marginTop: 16,
          padding: 16,
          border: "1px solid #eee",
          borderRadius: 10,
          background: "#fafafa"
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 900 }}>Start a new batch</h2>
        <p style={{ marginTop: 6, color: "#555" }}>
          Create a batch, add receipts, then click "Send to accountant" on the batch page.
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Receipts - January 2026"
            style={{ padding: 10, width: 360, maxWidth: "100%" }}
            disabled={creating}
          />
          <button onClick={createBatch} disabled={creating} style={{ padding: 10, fontWeight: 800 }}>
            {creating ? "Creating..." : "Start new batch"}
          </button>
        </div>
      </div>

      {msg && <p style={{ marginTop: 12 }}>{msg}</p>}

      <div style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: 16, fontWeight: 900 }}>Your batches</h2>

        {loading ? (
          <p style={{ marginTop: 10 }}>Loading...</p>
        ) : batches.length === 0 ? (
          <p style={{ marginTop: 10 }}>No batches yet. Create your first one above.</p>
        ) : (
          <div style={{ marginTop: 10, border: "1px solid #ddd", borderRadius: 10, overflow: "hidden" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 180px 140px",
                padding: 10,
                fontWeight: 900,
                background: "#f7f7f7",
                borderBottom: "1px solid #ddd"
              }}
            >
              <div>Batch</div>
              <div>Status</div>
              <div>Receipts</div>
            </div>

            {batches.map((b) => (
              <div
                key={b.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 180px 140px",
                  padding: 10,
                  borderBottom: "1px solid #eee",
                  cursor: "pointer"
                }}
                onClick={() => router.push("/batches/" + b.id)}
              >
                <div style={{ fontWeight: 800 }}>{b.name ?? "(Untitled batch)"}</div>
                <div style={{ color: "#555" }}>{b.locked ? "Sent" : "Open"}</div>
                <div style={{ color: "#555" }}>
                  {typeof b.submitted_count === "number" ? b.submitted_count : "—"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}