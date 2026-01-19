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
  submitted_at?: string | null;
  submitted_count?: number | null;
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

  extracted_at?: string | null;
  extraction_source?: string | null;
  extraction_model?: string | null;
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

  // Inline edit states (vendor/date/total)
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [vendorDraft, setVendorDraft] = useState<string>("");

  const [editingDateId, setEditingDateId] = useState<string | null>(null);
  const [dateDraft, setDateDraft] = useState<string>("");

  const [editingTotalId, setEditingTotalId] = useState<string | null>(null);
  const [totalDraft, setTotalDraft] = useState<string>("");

  const firmId = process.env.NEXT_PUBLIC_FIRM_ID;

  const categories = [
    "Meals",
  "Fuel",
  "Office Supplies",
  "Travel",
  "Repairs",

  // Utilities & services
  "Telephone",
  "Internet",
  "Utilities",

  // Software & subscriptions
  "Software",
  "Subscriptions",

  // Facilities & overhead
  "Rent",
  "Insurance",
  "Equipment",
  "Banking Fees",

  // People & compliance
  "Payroll",
  "Training / Education",
  "Professional Services",
  "Taxes & Licenses",
  "Dues & Memberships",

  // Marketing
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
      .select("id,name,status,created_at,locked,submitted_at,submitted_count")
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
        "id,vendor,receipt_date,total,category_suggested,category_final,confidence,reviewed,created_at,extracted_at,extraction_source,extraction_model"
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

  async function fileToBase64(file: File): Promise<string> {
    // Returns base64 WITHOUT the data: prefix
    const dataUrl = await fileToDataUrl(file);
    const commaIdx = dataUrl.indexOf(",");
    return commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  }

  async function addReceipts(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (batch?.locked) {
      setMsg("This batch has already been sent and is locked.");
      return;
    }

    setMsg(null);
    setAdding(true);

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) {
      router.replace("/login");
      return;
    }

    if (!firmId) {
      setMsg("Missing NEXT_PUBLIC_FIRM_ID env var.");
      setAdding(false);
      return;
    }

    try {
      for (const file of Array.from(files)) {
        const isPdf =
          file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

        const maxBytes = 15 * 1024 * 1024;
        if (file.size > maxBytes) {
          setMsg(
            `File too large: ${file.name}. Please upload a smaller file (max ~15MB).`
          );
          continue;
        }

        let extractPayload: any = null;

        if (isPdf) {
          const fileBase64 = await fileToBase64(file);
          extractPayload = {
            fileBase64,
            fileName: file.name,
            mimeType: "application/pdf",
          };
        } else {
          const imageDataUrl = await fileToDataUrl(file);
          extractPayload = { imageDataUrl };
        }

        let extractedData = {
          vendor: null as string | null,
          receipt_date: null as string | null,
          total: null as number | null,
          category_suggested: null as string | null,
          confidence: null as number | null,
        };

        let modelUsed: string | null = null;

        try {
          const extractResponse = await fetch("/api/receipts/extract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(extractPayload),
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
              modelUsed = extractResult.model_used ?? null;
            } else {
              console.error("Extraction returned not-ok:", extractResult);
            }
          } else {
            const errText = await extractResponse.text();
            console.error("Extraction failed:", extractResponse.status, errText);
          }
        } catch (extractErr) {
          console.error("Error extracting receipt:", extractErr);
        }

        const { error } = await supabase.from("receipts").insert({
          user_id: user.id,
          firm_id: firmId,
          batch_id: batchId,

          vendor: extractedData.vendor,
          receipt_date: extractedData.receipt_date,
          total: extractedData.total,
          category_suggested: extractedData.category_suggested,
          category_final: null,
          confidence: extractedData.confidence,
          reviewed: false,

          extracted_at: new Date().toISOString(),
          extraction_source: "ai",
          extraction_model: modelUsed,
          extraction_result: extractedData,
        });

        if (error) setMsg(`Error saving receipt: ${error.message}`);
      }

      await load();
    } catch (err) {
      setMsg(
        `Error processing receipts: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    } finally {
      setAdding(false);
    }
  }

  async function updateCategory(receiptId: string, category: string) {
    if (batch?.locked) return;

    const { error } = await supabase
      .from("receipts")
      .update({ category_final: category || null, extraction_source: "manual" })
      .eq("id", receiptId);

    if (error) {
      setMsg(`Error updating category: ${error.message}`);
    } else {
      await load();
      setEditingCategory(null);
    }
  }

  async function updateVendor(receiptId: string, vendor: string) {
    if (batch?.locked) return;

    const trimmed = vendor.trim();
    const { error } = await supabase
      .from("receipts")
      .update({
        vendor: trimmed.length ? trimmed : null,
        extraction_source: "manual",
      })
      .eq("id", receiptId);

    if (error) {
      setMsg(`Error updating vendor: ${error.message}`);
      return;
    }

    await load();
    setEditingVendorId(null);
  }

  async function updateReceiptDate(receiptId: string, receiptDate: string) {
    if (batch?.locked) return;

    const trimmed = receiptDate.trim();
    if (trimmed.length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      setMsg("Date must be in YYYY-MM-DD format.");
      return;
    }

    const { error } = await supabase
      .from("receipts")
      .update({
        receipt_date: trimmed.length ? trimmed : null,
        extraction_source: "manual",
      })
      .eq("id", receiptId);

    if (error) {
      setMsg(`Error updating date: ${error.message}`);
      return;
    }

    await load();
    setEditingDateId(null);
  }

  async function updateTotal(receiptId: string, totalStr: string) {
    if (batch?.locked) return;

    const trimmed = totalStr.trim();
    let nextTotal: number | null = null;

    if (trimmed.length) {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        setMsg("Total must be a valid number.");
        return;
      }
      nextTotal = parsed;
    }

    const { error } = await supabase
      .from("receipts")
      .update({
        total: nextTotal,
        extraction_source: "manual",
      })
      .eq("id", receiptId);

    if (error) {
      setMsg(`Error updating total: ${error.message}`);
      return;
    }

    await load();
    setEditingTotalId(null);
  }

  async function deleteReceipt(receiptId: string) {
    if (batch?.locked) return;

    if (!confirm("Delete this receipt row? This cannot be undone.")) return;

    setMsg(null);
    const { error } = await supabase.from("receipts").delete().eq("id", receiptId);

    if (error) {
      setMsg(`Error deleting receipt: ${error.message}`);
      return;
    }

    await load();
  }

  async function toggleReviewed(receiptId: string, current: boolean) {
    if (batch?.locked) return;

    const next = !current;
    const { error } = await supabase
      .from("receipts")
      .update({ reviewed: next, extraction_source: "manual" })
      .eq("id", receiptId);

    if (error) setMsg(`Error updating reviewed: ${error.message}`);
    else await load();
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

    if (
      !confirm(
        `Are you sure you want to send "${batch.name}" with ${rows.length} receipt(s) to the accountant? This will lock the batch.`
      )
    ) {
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
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({
          batchId: batch.id,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMsg(
          result.error ||
            "Failed to send email. Batch was locked but email may not have been sent."
        );
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

  function endInlineEdit() {
    setEditingVendorId(null);
    setEditingDateId(null);
    setEditingTotalId(null);
    setEditingCategory(null);
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
          cursor: "pointer",
        }}
      >
        ← Back to Batches
      </button>

      {loading ? (
        <p style={{ marginTop: 16, color: "#666" }}>Loading…</p>
      ) : msg ? (
        <div
          style={{
            marginTop: 16,
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
      ) : !batch ? (
        <p style={{ marginTop: 16, color: "#666" }}>Batch not found.</p>
      ) : (
        <>
          <div
            style={{
              marginBottom: 32,
              paddingBottom: 16,
              borderBottom: "2px solid #e0e0e0",
            }}
          >
            <h1
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: "#30a9a0",
                marginBottom: 8,
              }}
            >
              {batch.name}
            </h1>
            <p style={{ color: "#666", fontSize: 14 }}>
              Status: <strong>{batch.status}</strong> • Created:{" "}
              {new Date(batch.created_at).toLocaleString()}
            </p>
          </div>

          <div
            style={{
              marginTop: 20,
              padding: 24,
              border: "1px solid #e0e0e0",
              borderRadius: 8,
              background: "#f8f9fa",
            }}
          >
            <h2
              style={{
                fontSize: 18,
                fontWeight: 600,
                color: "#30a9a0",
                marginBottom: 8,
              }}
            >
              Add Receipts
            </h2>
            <p style={{ marginTop: 4, color: "#666", fontSize: 14 }}>
              Choose multiple receipt images (PNG, JPG) or PDF files from your
              computer/phone. We'll extract vendor, date, and total automatically.
            </p>

            <input
              id="receipt-file-input"
              type="file"
              accept="image/*,application/pdf"
              multiple
              disabled={adding || !!batch.locked}
              onChange={(e) => addReceipts(e.target.files)}
              style={{ display: "none" }}
            />

            <button
              type="button"
              onClick={() => document.getElementById("receipt-file-input")?.click()}
              disabled={adding || !!batch.locked}
              style={{
                marginTop: 16,
                padding: "12px 24px",
                borderRadius: 4,
                border: "none",
                background: adding || batch.locked ? "#ccc" : "#30a9a0",
                color: "white",
                fontWeight: 600,
                fontSize: 14,
                cursor: adding || batch.locked ? "not-allowed" : "pointer",
              }}
            >
              {batch.locked ? "Batch Locked" : adding ? "Adding…" : "Choose Receipt Files"}
            </button>

            <p style={{ marginTop: 8, color: "#666" }}>
              Tip: you can select multiple photos and PDFs at once.
            </p>
          </div>

          <div
            style={{
              marginTop: 32,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
            }}
          >
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
              <span
                style={{
                  padding: "8px 16px",
                  borderRadius: 4,
                  background: "#e8f5e9",
                  color: "#2e7d32",
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                ✓ Sent to Accountant
              </span>
            )}
          </div>

          {rows.length === 0 ? (
            <p style={{ marginTop: 10 }}>No receipts yet. Add some above.</p>
          ) : (
            <div
              style={{
                marginTop: 10,
                border: "1px solid #e0e0e0",
                borderRadius: 8,
                overflow: "hidden",
              }}
              onClick={() => {
                // Click outside inputs shouldn't nuke edits; leave as-is.
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "140px 1fr 120px 160px 110px 110px 90px",
                  padding: "14px 16px",
                  fontWeight: 600,
                  background: "#f8f9fa",
                  borderBottom: "2px solid #e0e0e0",
                  color: "#30a9a0",
                  fontSize: 14,
                }}
              >
                <div>Date</div>
                <div>Vendor</div>
                <div>Total</div>
                <div>Category</div>
                <div>Reviewed</div>
                <div>Confidence</div>
                <div>Actions</div>
              </div>

              {rows.map((r, idx) => {
                const confidence = r.confidence ?? null;
                const confidencePercent =
                  confidence !== null ? Math.round(confidence * 100) : null;

                let confidenceColor = "#666";
                let confidenceBg = "transparent";
                if (confidencePercent !== null) {
                  if (confidencePercent < 70) {
                    confidenceColor = "#d32f2f";
                    confidenceBg = "#ffebee";
                  } else if (confidencePercent < 85) {
                    confidenceColor = "#f57c00";
                    confidenceBg = "#fff3e0";
                  } else {
                    confidenceColor = "#2e7d32";
                    confidenceBg = "#e8f5e9";
                  }
                }

                const isLocked = !!batch.locked;

                return (
                  <div
                    key={r.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "140px 1fr 120px 160px 110px 110px 90px",
                      padding: "14px 16px",
                      borderBottom: idx < rows.length - 1 ? "1px solid #f0f0f0" : "none",
                      background: "white",
                      fontSize: 14,
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    {/* Date */}
                    <div style={{ color: "#1a1a1a" }}>
                      {editingDateId === r.id ? (
                        <input
                          type="date"
                          value={dateDraft}
                          onChange={(e) => setDateDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") updateReceiptDate(r.id, dateDraft);
                            if (e.key === "Escape") endInlineEdit();
                          }}
                          onBlur={() => updateReceiptDate(r.id, dateDraft)}
                          autoFocus
                          disabled={isLocked}
                          style={{
                            width: "100%",
                            padding: "6px 8px",
                            borderRadius: 4,
                            border: "1px solid #30a9a0",
                            fontSize: 12,
                          }}
                        />
                      ) : (
                        <span
                          style={{
                            cursor: isLocked ? "default" : "pointer",
                            padding: "4px 8px",
                            borderRadius: 4,
                            display: "inline-block",
                            minWidth: 100,
                            color: r.receipt_date ? "#1a1a1a" : "#666",
                          }}
                          onClick={() => {
                            if (isLocked) return;
                            setEditingDateId(r.id);
                            setDateDraft(r.receipt_date ?? "");
                            setMsg(null);
                          }}
                          title={isLocked ? "" : "Click to edit date"}
                        >
                          {r.receipt_date ?? "—"}
                        </span>
                      )}
                    </div>

                    {/* Vendor */}
                    <div style={{ color: "#1a1a1a" }}>
                      {editingVendorId === r.id ? (
                        <input
                          type="text"
                          value={vendorDraft}
                          onChange={(e) => setVendorDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") updateVendor(r.id, vendorDraft);
                            if (e.key === "Escape") endInlineEdit();
                          }}
                          onBlur={() => updateVendor(r.id, vendorDraft)}
                          autoFocus
                          disabled={isLocked}
                          style={{
                            width: "100%",
                            padding: "6px 8px",
                            borderRadius: 4,
                            border: "1px solid #30a9a0",
                            fontSize: 12,
                          }}
                        />
                      ) : (
                        <span
                          style={{
                            cursor: isLocked ? "default" : "pointer",
                            padding: "4px 8px",
                            borderRadius: 4,
                            display: "inline-block",
                            minWidth: 120,
                            color: r.vendor ? "#1a1a1a" : "#666",
                          }}
                          onClick={() => {
                            if (isLocked) return;
                            setEditingVendorId(r.id);
                            setVendorDraft(r.vendor ?? "");
                            setMsg(null);
                          }}
                          title={isLocked ? "" : "Click to edit vendor"}
                        >
                          {r.vendor ?? "—"}
                        </span>
                      )}
                    </div>

                    {/* Total */}
                    <div style={{ color: "#1a1a1a", fontWeight: 600 }}>
                      {editingTotalId === r.id ? (
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          value={totalDraft}
                          onChange={(e) => setTotalDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") updateTotal(r.id, totalDraft);
                            if (e.key === "Escape") endInlineEdit();
                          }}
                          onBlur={() => updateTotal(r.id, totalDraft)}
                          autoFocus
                          disabled={isLocked}
                          style={{
                            width: "100%",
                            padding: "6px 8px",
                            borderRadius: 4,
                            border: "1px solid #30a9a0",
                            fontSize: 12,
                            fontWeight: 600,
                          }}
                        />
                      ) : (
                        <span
                          style={{
                            cursor: isLocked ? "default" : "pointer",
                            padding: "4px 8px",
                            borderRadius: 4,
                            display: "inline-block",
                            minWidth: 90,
                            color: typeof r.total === "number" ? "#1a1a1a" : "#666",
                          }}
                          onClick={() => {
                            if (isLocked) return;
                            setEditingTotalId(r.id);
                            setTotalDraft(
                              typeof r.total === "number" ? String(r.total) : ""
                            );
                            setMsg(null);
                          }}
                          title={isLocked ? "" : "Click to edit total"}
                        >
                          {typeof r.total === "number" ? `$${r.total.toFixed(2)}` : "—"}
                        </span>
                      )}
                    </div>

                    {/* Category */}
                    <div>
                      {editingCategory === r.id ? (
                        <select
                          value={r.category_final ?? r.category_suggested ?? ""}
                          onChange={(e) => updateCategory(r.id, e.target.value)}
                          onBlur={() => setEditingCategory(null)}
                          autoFocus
                          disabled={isLocked}
                          style={{
                            padding: "6px 8px",
                            borderRadius: 4,
                            border: "1px solid #30a9a0",
                            fontSize: 12,
                            width: "100%",
                            cursor: isLocked ? "not-allowed" : "pointer",
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
                            cursor: isLocked ? "default" : "pointer",
                            padding: "4px 8px",
                            borderRadius: 4,
                            display: "inline-block",
                            minWidth: 120,
                          }}
                          onClick={() => {
                            if (!isLocked) setEditingCategory(r.id);
                          }}
                          title={isLocked ? "" : "Click to edit category"}
                        >
                          {r.category_final ?? r.category_suggested ?? "—"}
                        </span>
                      )}
                    </div>

                    {/* Reviewed */}
                    <div>
                      <button
                        onClick={() => toggleReviewed(r.id, r.reviewed)}
                        disabled={isLocked}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 4,
                          border: "none",
                          background: r.reviewed ? "#e8f5e9" : "#fff3e0",
                          color: r.reviewed ? "#2e7d32" : "#e65100",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: isLocked ? "not-allowed" : "pointer",
                          width: "100%",
                        }}
                        title={isLocked ? "" : "Click to toggle reviewed"}
                      >
                        {r.reviewed ? "Yes" : "No"}
                      </button>
                    </div>

                    {/* Confidence */}
                    <div>
                      {confidencePercent !== null ? (
                        <span
                          style={{
                            padding: "6px 10px",
                            borderRadius: 4,
                            background: confidenceBg,
                            color: confidenceColor,
                            fontSize: 12,
                            fontWeight: 600,
                            display: "inline-block",
                            minWidth: 70,
                            textAlign: "center",
                          }}
                        >
                          {confidencePercent}%
                        </span>
                      ) : (
                        <span style={{ color: "#666" }}>—</span>
                      )}
                    </div>

                    {/* Actions */}
                    <div>
                      <button
                        onClick={() => deleteReceipt(r.id)}
                        disabled={isLocked}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 4,
                          border: "1px solid #e0e0e0",
                          background: isLocked ? "#f5f5f5" : "white",
                          color: isLocked ? "#999" : "#c33",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: isLocked ? "not-allowed" : "pointer",
                          width: "100%",
                        }}
                        title={isLocked ? "" : "Delete this receipt row"}
                      >
                        Delete
                      </button>
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
