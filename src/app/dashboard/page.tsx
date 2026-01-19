"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
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
  const firmId = process.env.NEXT_PUBLIC_FIRM_ID;

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

    setMsg(null);

    const firmIdValue = firmId;
    if (!firmIdValue) {
      setMsg("Missing NEXT_PUBLIC_FIRM_ID env var.");
      return;
    }
    
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
    firm_id: firmIdValue,
    submitted_by_email:user.email,
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
    <div style={{ maxWidth: 980, margin: "40px auto", padding: "0 24px" }}>
      <div style={{ 
        display: "flex", 
        justifyContent: "space-between", 
        gap: 10, 
        alignItems: "center",
        marginBottom: 32,
        paddingBottom: 16,
        borderBottom: "2px solid #e0e0e0"
      }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "#30a9a0", marginBottom: 4 }}>
            Receipt Management
          </h1>
          <p style={{ fontSize: 14, color: "#666" }}>Boyd Group Services</p>
        </div>
        <button 
          onClick={signOut} 
          style={{ 
            padding: "10px 20px",
            background: "white",
            border: "1px solid #e0e0e0",
            borderRadius: 4,
            color: "#30a9a0",
            fontWeight: 600,
            fontSize: 14,
            cursor: "pointer"
          }}
        >
          Sign Out
        </button>
      </div>

      <div
        style={{
          marginTop: 16,
          padding: 24,
          border: "1px solid #e0e0e0",
          borderRadius: 8,
          background: "#f8f9fa"
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 600, color: "#003d82", marginBottom: 8 }}>Start a New Batch</h2>
        <p style={{ marginTop: 4, color: "#666", fontSize: 14 }}>
          Create a batch, add receipts, then submit when ready for processing.
        </p>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Receipts - January 2026"
            style={{ 
              padding: "12px 16px", 
              width: 360, 
              maxWidth: "100%",
              border: "1px solid #e0e0e0",
              borderRadius: 4,
              fontSize: 14
            }}
            disabled={creating}
          />
          <button 
            onClick={createBatch} 
            disabled={creating} 
            style={{ 
              padding: "12px 24px",
              background: creating ? "#ccc" : "#30a9a0",
              color: "white",
              border: "none",
              borderRadius: 4,
              fontWeight: 600,
              fontSize: 14,
              cursor: creating ? "not-allowed" : "pointer"
            }}
          >
            {creating ? "Creating..." : "Create Batch"}
          </button>
        </div>
      </div>

      {msg && (
        <div style={{ 
          marginTop: 16, 
          padding: 12, 
          borderRadius: 4,
          background: "#fee",
          border: "1px solid #fcc",
          color: "#c33",
          fontSize: 14
        }}>
          {msg}
        </div>
      )}

      <div style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: "#003d82", marginBottom: 16 }}>Your Batches</h2>

        {loading ? (
          <p style={{ marginTop: 10 }}>Loading...</p>
        ) : batches.length === 0 ? (
          <p style={{ marginTop: 10 }}>No batches yet. Create your first one above.</p>
        ) : (
          <div style={{ marginTop: 10, border: "1px solid #e0e0e0", borderRadius: 8, overflow: "hidden" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 180px 140px",
                padding: "14px 16px",
                fontWeight: 600,
                background: "#f8f9fa",
                borderBottom: "2px solid #e0e0e0",
                color: "#30a9a0",
                fontSize: 14
              }}
            >
              <div>Batch Name</div>
              <div>Status</div>
              <div>Receipts</div>
            </div>

            {batches.map((b, idx) => (
              <div
                key={b.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 180px 140px",
                  padding: "16px",
                  borderBottom: idx < batches.length - 1 ? "1px solid #f0f0f0" : "none",
                  cursor: "pointer",
                  transition: "background 0.2s",
                  background: "white"
                }}
                onClick={() => router.push("/batches/" + b.id)}
                onMouseEnter={(e) => e.currentTarget.style.background = "#f8f9fa"}
                onMouseLeave={(e) => e.currentTarget.style.background = "white"}
              >
                <div style={{ fontWeight: 600, color: "#1a1a1a" }}>{b.name ?? "(Untitled batch)"}</div>
                <div style={{ color: "#666", fontSize: 14 }}>
                  <span style={{
                    padding: "4px 8px",
                    borderRadius: 4,
                    background: b.locked ? "#e8f5e9" : "#fff3e0",
                    color: b.locked ? "#2e7d32" : "#e65100",
                    fontSize: 12,
                    fontWeight: 600
                  }}>
                    {b.locked ? "Submitted" : "Open"}
                  </span>
                </div>
                <div style={{ color: "#666", fontSize: 14 }}>
                  {typeof b.submitted_count === "number" ? b.submitted_count : "—"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 60, paddingTop: 32, borderTop: "1px solid #e0e0e0", textAlign: "center" }}>
        <Image 
          src="/logo.png" 
          alt="Boyd Group Services" 
          width={200}
          height={50}
          style={{ 
            width: "40%",
            height: "auto",
            objectFit: "contain",
            opacity: 0.7
          }}
          unoptimized
        />
      </div>
    </div>
  );
}