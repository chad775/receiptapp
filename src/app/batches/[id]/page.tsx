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
  const [editingCategory, setEditingCategory] = useState<string | null>(null);

  const categories = [
    "Meals",
    "Fuel",
    "Office Supplies",
    "Travel",
    "Repairs",
    "Utilities",
    "Software",
    "Equipment",
    "Professional Services",
    "Marketing",
    "Other",
  ];

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

  async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

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

    try {
      // Process each file: extract data, then insert receipt
      for (const file of Array.from(files)) {
        // Convert file to data URL
        const imageDataUrl = await fileToDataUrl(file);

        // Call extraction API
        let extractedData = {
          vendor: null,
          receipt_date: null,
          total: null,
          category_suggested: null,
          confidence: null,
        };

        try {
          const extractResponse = await fetch("/api/receipts/extract", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ imageDataUrl }),
          });

          if (extractResponse.ok) {
            const extractResult = await extractResponse.json();
            if (extractResult.ok && extractResult.result) {
              extractedData = {
                vendor: extractResult.result.vendor,
                receipt_date: extractResult.result.receipt_date,
                total: extractResult.result.total,
                category_suggested: extractResult.result.category_suggested,
                confidence: extractResult.result.confidence,
              };
            }
          } else {
            console.error("Extraction failed for file:", file.name);
          }
        } catch (extractErr) {
          console.error("Error extracting receipt:", extractErr);
          // Continue to insert receipt even if extraction fails
        }

        // Insert receipt with extracted data
        const { error } = await supabase.from("receipts").insert({
          user_id: user.id,
          batch_id: batchId,
          vendor: extractedData.vendor,
          receipt_date: extractedData.receipt_date,
          total: extractedData.total,
          category_suggested: extractedData.category_suggested,
          category_final: null,
          confidence: extractedData.confidence,
          reviewed: false,
        });

        if (error) {
          setMsg(`Error saving receipt: ${error.message}`);
        }
      }

      await load();
    } catch (err) {
      setMsg(`Error processing receipts: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAdding(false);
    }
  }

  async function updateCategory(receiptId: string, category: string) {
    const { error } = await supabase
      .from("receipts")
      .update({ category_final: category || null })
      .eq("id", receiptId);

    if (error) {
      setMsg(`Error updating category: ${error.message}`);
    } else {
      await load();
      setEditingCategory(null);
    }
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
                    gridTemplateColumns: "160px 1fr 120px 140px 110px 100px",
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
                  <div>Confidence</div>
                </div>

                {rows.map((r, idx) => {
                  const confidence = r.confidence ?? null;
                  const confidencePercent = confidence !== null ? Math.round(confidence * 100) : null;
                  
                  // Color thresholds: red < 70%, yellow 70-85%, green >= 85%
                  let confidenceColor = "#666";
                  let confidenceBg = "transparent";
                  if (confidencePercent !== null) {
                    if (confidencePercent < 70) {
                      confidenceColor = "#d32f2f"; // red
                      confidenceBg = "#ffebee"; // light red background
                    } else if (confidencePercent < 85) {
                      confidenceColor = "#f57c00"; // yellow/orange
                      confidenceBg = "#fff3e0"; // light yellow background
                    } else {
                      confidenceColor = "#2e7d32"; // green
                      confidenceBg = "#e8f5e9"; // light green background
                    }
                  }
                  
                  return (
                    <div
                      key={r.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "160px 1fr 120px 140px 110px 100px",
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
                      <div>
                        {editingCategory === r.id ? (
                          <select
                            value={r.category_final ?? r.category_suggested ?? ""}
                            onChange={(e) => updateCategory(r.id, e.target.value)}
                            onBlur={() => setEditingCategory(null)}
                            autoFocus
                            style={{
                              padding: "4px 8px",
                              borderRadius: 4,
                              border: "1px solid #30a9a0",
                              fontSize: 12,
                              minWidth: 120,
                              cursor: "pointer"
                            }}
                          >
                            <option value="">—</option>
                            {categories.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span
                            style={{
                              color: "#666",
                              cursor: "pointer",
                              padding: "4px 8px",
                              borderRadius: 4,
                              display: "inline-block",
                              minWidth: 100
                            }}
                            onClick={() => setEditingCategory(r.id)}
                            title="Click to edit category"
                          >
                            {r.category_final ?? r.category_suggested ?? "—"}
                          </span>
                        )}
                      </div>
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
                      <div>
                        {confidencePercent !== null ? (
                          <span style={{
                            padding: "4px 8px",
                            borderRadius: 4,
                            background: confidenceBg,
                            color: confidenceColor,
                            fontSize: 12,
                            fontWeight: 600
                          }}>
                            {confidencePercent}%
                          </span>
                        ) : (
                          "—"
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
        </>
      )}
    </div>
  );
}
