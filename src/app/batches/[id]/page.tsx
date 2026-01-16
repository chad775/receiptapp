"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Batch = {
  id: string;
  name: string;
  status: string;
  created_at: string;
  locked?: boolean;
};

type ReceiptRow = {
  id: string;
  vendor: string | null;
  receipt_date: string | null;
  total: number | null;
  category_suggested: string | null;
  category_final: string | null;
  confidence: number | null;
  reviewed: boolean;
  created_at: string;
};

export default function BatchDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const batchId = useMemo(() => params?.id, [params]);

  const [batch, setBatch] = useState<Batch | null>(null);
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [sending, setSending] = useState(false);

  async function load() {
    setLoading(true);
    setMsg(null);

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      router.replace("/login");
      return;
    }

    // Load batch
    const { data: batchData, error: batchErr } = await supabase
      .from("batches")
      .select("id,name,status,created_at,locked")
      .eq("id", batchId)
      .single();

    if (batchErr) {
      setMsg(batchErr.message);
      setLoading(false);
      return;
    }
    setBatch(batchData);

    // Load receipt rows
    const { data: rowsData, error: rowsErr } = await supabase
      .from("receipts")
      .select(
        "id,vendor,receipt_date,total,category_suggested,category_final,confidence,reviewed,created_at"
      )
      .eq("batch_id", batchId)
      .order("created_at", { ascending: false });

    if (rowsErr) setMsg(rowsErr.message);
    setRows(rowsData ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (batchId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  async function addReceipts(files: FileList | null) {
    if (!files || files.length === 0) return;

    setMsg(null);
    setAdding(true);

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) {
      router.replace("/login");
      return;
    }

    // For now: create placeholder receipt rows (we'll extract with OpenAI in the next step)
    const inserts = Array.from(files).map(() => ({
      user_id: user.id,
      batch_id: batchId,
      vendor: null,
      receipt_date: null,
      total: null,
      category_suggested: null,
      category_final: null,
      confidence: null,
      reviewed: false,
    }));

    const { error } = await supabase.from("receipts").insert(inserts);

    if (error) {
      setMsg(error.message);
    } else {
      await load();
    }

    setAdding(false);
  }

  async function sendToAccountant() {
    if (!batch || rows.length === 0) {
      setMsg("Please add at least one receipt before sending.");
      return;
    }

    if (batch.locked) {
      setMsg("This batch has already been sent to the accountant.");
      return;
    }

    if (!confirm(`Are you sure you want to send "${batch.name}" with ${rows.length} receipt(s) to the accountant? This will lock the batch.`)) {
      return;
    }

    setMsg(null);
    setSending(true);

    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        router.replace("/login");
        return;
      }

      // Update batch to locked
      const { error: updateError } = await supabase
        .from("batches")
        .update({
          locked: true,
          submitted_at: new Date().toISOString(),
          submitted_count: rows.length,
        })
        .eq("id", batchId);

      if (updateError) {
        setMsg(updateError.message);
        setSending(false);
        return;
      }

      // Get session token for API authentication
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session?.access_token) {
        setMsg("Unable to authenticate. Please sign out and sign back in.");
        setSending(false);
        return;
      }

      // Send email via API
      const response = await fetch("/api/batches/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({
          batchId: batch.id,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMsg(result.error || "Failed to send email. Batch was locked but email may not have been sent.");
      } else {
        setMsg("Batch sent successfully to the accountant!");
        await load();
      }
    } catch (err) {
      setMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ maxWidth: 980, margin: "40px auto", padding: "0 24px" }}>
      <button 
        onClick={() => router.push("/dashboard")} 
        style={{ 
          padding: "10px 20px",
          marginBottom: 24,
          background: "white",
          border: "1px solid #e0e0e0",
          borderRadius: 4,
          color: "#30a9a0",
          fontWeight: 600,
          fontSize: 14,
          cursor: "pointer"
        }}
      >
        ← Back to Batches
      </button>

      {loading ? (
        <p style={{ marginTop: 16, color: "#666" }}>Loading…</p>
      ) : msg ? (
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
      ) : !batch ? (
        <p style={{ marginTop: 16, color: "#666" }}>Batch not found.</p>
      ) : (
        <>
          <div style={{
            marginBottom: 32,
            paddingBottom: 16,
            borderBottom: "2px solid #e0e0e0"
          }}>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: "#30a9a0", marginBottom: 8 }}>
              {batch.name}
            </h1>
            <p style={{ color: "#666", fontSize: 14 }}>
              Status: <strong>{batch.status}</strong> • Created: {new Date(batch.created_at).toLocaleString()}
            </p>
          </div>

          <div
            style={{
              marginTop: 20,
              padding: 24,
              border: "1px solid #e0e0e0",
              borderRadius: 8,
              background: "#f8f9fa"
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 600, color: "#30a9a0", marginBottom: 8 }}>Add Receipts</h2>
            <p style={{ marginTop: 4, color: "#666", fontSize: 14 }}>
              Choose multiple receipt images from your computer. We'll extract vendor, date, and total automatically.
            </p>

            {/* Hidden file input */}
            <input
              id="receipt-file-input"
              type="file"
              accept="image/*,.pdf"
              multiple
              disabled={adding}
              onChange={(e) => addReceipts(e.target.files)}
              style={{ display: "none" }}
            />

            {/* Visible button */}
            <button
              type="button"
              onClick={() =>
                document.getElementById("receipt-file-input")?.click()
              }
              disabled={adding}
              style={{
                marginTop: 16,
                padding: "12px 24px",
                borderRadius: 4,
                border: "none",
                background: adding ? "#ccc" : "#30a9a0",
                color: "white",
                fontWeight: 600,
                fontSize: 14,
                cursor: adding ? "not-allowed" : "pointer",
              }}
            >
              {adding ? "Adding…" : "Choose Receipt Images"}
            </button>

            <p style={{ marginTop: 8, color: "#666" }}>
              Tip: you can select multiple photos at once.
            </p>
          </div>

          <div style={{ marginTop: 32, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, color: "#30a9a0" }}>
              Receipts in This Batch
            </h2>
            {rows.length > 0 && !batch.locked && (
              <button
                onClick={sendToAccountant}
                disabled={sending}
                style={{
                  padding: "12px 24px",
                  borderRadius: 4,
                  border: "none",
                  background: sending ? "#ccc" : "#30a9a0",
                  color: "white",
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: sending ? "not-allowed" : "pointer",
                }}
              >
                {sending ? "Sending…" : "Send to Accountant"}
              </button>
            )}
            {batch.locked && (
              <span style={{
                padding: "8px 16px",
                borderRadius: 4,
                background: "#e8f5e9",
                color: "#2e7d32",
                fontSize: 14,
                fontWeight: 600
              }}>
                ✓ Sent to Accountant
              </span>
            )}
          </div>
          
          {rows.length === 0 ? (
              <p style={{ marginTop: 10 }}>
                No receipts yet. Add some above.
              </p>
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
                    gridTemplateColumns: "160px 1fr 120px 140px 110px",
                    padding: "14px 16px",
                    fontWeight: 600,
                    background: "#f8f9fa",
                    borderBottom: "2px solid #e0e0e0",
                    color: "#30a9a0",
                    fontSize: 14
                  }}
                >
                  <div>Date</div>
                  <div>Vendor</div>
                  <div>Total</div>
                  <div>Category</div>
                  <div>Reviewed</div>
                </div>

                {rows.map((r, idx) => (
                  <div
                    key={r.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "160px 1fr 120px 140px 110px",
                      padding: "14px 16px",
                      borderBottom: idx < rows.length - 1 ? "1px solid #f0f0f0" : "none",
                      background: "white",
                      fontSize: 14
                    }}
                  >
                    <div style={{ color: "#1a1a1a" }}>{r.receipt_date ?? "—"}</div>
                    <div style={{ color: "#1a1a1a" }}>{r.vendor ?? "—"}</div>
                    <div style={{ color: "#1a1a1a", fontWeight: 600 }}>
                      {r.total ? `$${r.total.toFixed(2)}` : "—"}
                    </div>
                    <div style={{ color: "#666" }}>{r.category_final ?? r.category_suggested ?? "—"}</div>
                    <div>
                      <span style={{
                        padding: "4px 8px",
                        borderRadius: 4,
                        background: r.reviewed ? "#e8f5e9" : "#fff3e0",
                        color: r.reviewed ? "#2e7d32" : "#e65100",
                        fontSize: 12,
                        fontWeight: 600
                      }}>
                        {r.reviewed ? "Yes" : "No"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </>
      )}
    </div>
  );
}
