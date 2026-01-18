"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type FirmMemberRow = {
  firm_id: string;
  role: "staff" | "admin";
};

type BatchRow = {
  id: string;
  name: string | null;
  locked: boolean;
  submitted_at: string | null;
  submitted_count: number | null;
  created_at: string;
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

export default function StaffPage() {
  const router = useRouter();

  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [member, setMember] = useState<FirmMemberRow | null>(null);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return batches;
    return batches.filter((b) => (b.name ?? "").toLowerCase().includes(q));
  }, [batches, search]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  async function load() {
    setMsg(null);
    setChecking(true);

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr) {
      setMsg(userErr.message);
      setMember(null);
      setChecking(false);
      return;
    }

    if (!userData.user) {
      router.replace("/login");
      return;
    }

    // Staff check (role must be staff/admin)
    const memberRes = await supabase
      .from("firm_members")
      .select("firm_id,role")
      .eq("user_id", userData.user.id)
      .in("role", ["staff", "admin"])
      .maybeSingle();

    if (memberRes.error) {
      setMsg(memberRes.error.message);
      setMember(null);
      setChecking(false);
      return;
    }

    if (!memberRes.data) {
      setMsg("Access denied: your account is not listed as staff/admin.");
      setMember(null);
      setChecking(false);
      return;
    }

    setMember(memberRes.data as FirmMemberRow);
    setChecking(false);

    setLoading(true);
    const batchesRes = await supabase
      .from("batches")
      .select("id,name,locked,submitted_at,submitted_count,created_at")
      .order("created_at", { ascending: false });

    if (batchesRes.error) {
      setMsg(batchesRes.error.message);
      setBatches([]);
      setLoading(false);
      return;
    }

    setBatches(batchesRes.data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roleText = member
    ? "Signed in as staff (" + member.role + ")"
    : "Checking access...";

  return (
    <div style={{ maxWidth: 1100, margin: "40px auto", padding: "0 24px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          alignItems: "center",
          marginBottom: 24,
          paddingBottom: 16,
          borderBottom: "2px solid #e0e0e0",
        }}
      >
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "#30a9a0" }}>
            Staff Review
          </h1>
          <p style={{ fontSize: 14, color: "#666" }}>{roleText}</p>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={() => router.push("/dashboard")}
            style={{
              padding: "10px 20px",
              background: "white",
              border: "1px solid #e0e0e0",
              borderRadius: 4,
              color: "#003d82",
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Client Dashboard
          </button>

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
              cursor: "pointer",
            }}
          >
            Sign Out
          </button>
        </div>
      </div>

      {msg ? (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 4,
            background: "#fee",
            border: "1px solid #fcc",
            color: "#c33",
            fontSize: 14,
          }}
        >
          {msg}
        </div>
      ) : null}

      {checking ? (
        <p style={{ marginTop: 16 }}>Checking staff access...</p>
      ) : !member ? (
        <div
          style={{
            marginTop: 16,
            padding: 16,
            border: "1px solid #e0e0e0",
            borderRadius: 8,
            background: "#f8f9fa",
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#003d82" }}>
            Staff access required
          </h2>
          <p style={{ marginTop: 8, color: "#666", fontSize: 14 }}>
            Add this user to <code>firm_members</code> in Supabase with role{" "}
            <code>staff</code> or <code>admin</code>.
          </p>

          <button
            onClick={load}
            style={{
              marginTop: 14,
              padding: "10px 16px",
              background: "#30a9a0",
              color: "white",
              border: "none",
              borderRadius: 4,
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Re-check access
          </button>
        </div>
      ) : (
        <div>
          <div
            style={{
              marginTop: 16,
              padding: 18,
              border: "1px solid #e0e0e0",
              borderRadius: 8,
              background: "#f8f9fa",
            }}
          >
            <h2
              style={{
                fontSize: 18,
                fontWeight: 600,
                color: "#003d82",
                marginBottom: 8,
              }}
            >
              Find a batch
            </h2>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by batch name..."
                style={{
                  padding: "12px 16px",
                  width: 420,
                  maxWidth: "100%",
                  border: "1px solid #e0e0e0",
                  borderRadius: 4,
                  fontSize: 14,
                }}
              />

              <button
                onClick={load}
                style={{
                  padding: "12px 24px",
                  background: "#30a9a0",
                  color: "white",
                  border: "none",
                  borderRadius: 4,
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                Refresh
              </button>
            </div>
          </div>

          <div style={{ marginTop: 28 }}>
            <h2
              style={{
                fontSize: 20,
                fontWeight: 600,
                color: "#003d82",
                marginBottom: 16,
              }}
            >
              Firm Batches
            </h2>

            {loading ? (
              <p style={{ marginTop: 10 }}>Loading...</p>
            ) : filtered.length === 0 ? (
              <p style={{ marginTop: 10 }}>No batches found.</p>
            ) : (
              <div
                style={{
                  marginTop: 10,
                  border: "1px solid #e0e0e0",
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 200px 140px 220px",
                    padding: "14px 16px",
                    fontWeight: 600,
                    background: "#f8f9fa",
                    borderBottom: "2px solid #e0e0e0",
                    color: "#30a9a0",
                    fontSize: 14,
                  }}
                >
                  <div>Batch Name</div>
                  <div>Status</div>
                  <div>Receipts</div>
                  <div>Created</div>
                </div>

                {filtered.map((b, idx) => (
                  <div
                    key={b.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 200px 140px 220px",
                      padding: "16px",
                      borderBottom:
                        idx < filtered.length - 1 ? "1px solid #f0f0f0" : "none",
                      cursor: "pointer",
                      transition: "background 0.2s",
                      background: "white",
                    }}
                    onClick={() => router.push("/batches/" + b.id)}
                  >
                    <div style={{ fontWeight: 600, color: "#1a1a1a" }}>
                      {b.name ?? "(Untitled batch)"}
                    </div>

                    <div style={{ color: "#666", fontSize: 14 }}>
                      <span
                        style={{
                          padding: "4px 8px",
                          borderRadius: 4,
                          background: b.locked ? "#e8f5e9" : "#fff3e0",
                          color: b.locked ? "#2e7d32" : "#e65100",
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        {b.locked ? "Submitted" : "Open"}
                      </span>
                    </div>

                    <div style={{ color: "#666", fontSize: 14 }}>
                      {typeof b.submitted_count === "number"
                        ? b.submitted_count
                        : "—"}
                    </div>

                    <div style={{ color: "#666", fontSize: 14 }}>
                      {fmtDate(b.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
