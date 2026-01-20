"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

// UI-only helper hook for mobile detection
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 900);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  return isMobile;
}

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
  note?: string | null;

  extracted_at?: string | null;
  extraction_source?: string | null;
  extraction_model?: string | null;
};

export default function BatchDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const batchId = useMemo(() => params?.id, [params]);
  const isMobile = useIsMobile();

  const [batch, setBatch] = useState<Batch | null>(null);
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);

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

  // Notes (Option A: only shown when category is Other)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string>("");
  const [noteErrors, setNoteErrors] = useState<Record<string, string>>({}); // receiptId -> error

  const firmId = process.env.NEXT_PUBLIC_FIRM_ID;

  const categories = [
    "Meals",
    "Fuel",
    "Office Supplies",
    "Travel",
    "Repairs",
    "Telephone",
    "Internet",
    "Utilities",
    "Software",
    "Subscriptions",
    "Rent",
    "Insurance",
    "Equipment",
    "Banking Fees",
    "Payroll",
    "Training / Education",
    "Professional Services",
    "Taxes & Licenses",
    "Dues & Memberships",
    "Marketing",
    "Other",
  ];

  function effectiveCategory(r: ReceiptRow) {
    return (r.category_final ?? r.category_suggested ?? "").trim();
  }

  function needsOtherNote(r: ReceiptRow) {
    return effectiveCategory(r) === "Other";
  }

  async function load(opts?: { refresh?: boolean }) {
    const refresh = !!opts?.refresh;

    // Key change: only show full-page loading on the initial page load.
    if (!refresh) setInitialLoading(true);
    setMsg(null);

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      router.replace("/login");
      return;
    }

    const { data: batchData, error: batchErr } = await supabase
      .from("batches")
      .select("id,name,status,created_at,locked,submitted_at,submitted_count")
      .eq("id", batchId)
      .single();

    if (batchErr) {
      setMsg(batchErr.message);
      if (!refresh) setInitialLoading(false);
      return;
    }
    setBatch(batchData);

    const { data: rowsData, error: rowsErr } = await supabase
      .from("receipts")
      .select(
        "id,vendor,receipt_date,total,category_suggested,category_final,confidence,reviewed,created_at,extracted_at,extraction_source,extraction_model,note"
      )
      .eq("batch_id", batchId)
      .order("created_at", { ascending: false });

    if (rowsErr) setMsg(rowsErr.message);

    const nextRows = rowsData ?? [];
    setRows(nextRows);

    // Refresh note error state deterministically
    const errs: Record<string, string> = {};
    for (const r of nextRows) {
      if (needsOtherNote(r) && !String(r.note ?? "").trim()) {
        errs[r.id] = "Required when category is Other.";
      }
    }
    setNoteErrors(errs);

    if (!refresh) setInitialLoading(false);
  }

  useEffect(() => {
    if (batchId) load({ refresh: false });
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
          file.type === "application/pdf" ||
          file.name.toLowerCase().endsWith(".pdf");

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
            }
          }
        } catch {
          // continue to insert even if extraction fails
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
          note: null,
        });

        if (error) setMsg(`Error saving receipt: ${error.message}`);
      }

      await load({ refresh: true });
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

    const next = category || null;

    const { error } = await supabase
      .from("receipts")
      .update({ category_final: next, extraction_source: "manual" })
      .eq("id", receiptId);

    if (error) {
      setMsg(`Error updating category: ${error.message}`);
      return;
    }

    // If set to Other, mark note as required (and keep existing note if present)
    if (next === "Other") {
      setNoteErrors((prev) => ({
        ...prev,
        [receiptId]: "Required when category is Other.",
      }));
    } else {
      // Not Other => clear note error + optionally clear noteDraft state
      setNoteErrors((prev) => {
        const copy = { ...prev };
        delete copy[receiptId];
        return copy;
      });
    }

    await load({ refresh: true });
    setEditingCategory(null);
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

    await load({ refresh: true });
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

    await load({ refresh: true });
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
      .update({ total: nextTotal, extraction_source: "manual" })
      .eq("id", receiptId);

    if (error) {
      setMsg(`Error updating total: ${error.message}`);
      return;
    }

    await load({ refresh: true });
    setEditingTotalId(null);
  }

  async function updateNote(receiptId: string, note: string) {
    if (batch?.locked) return;

    const trimmed = note.trim();
    const next = trimmed.length ? trimmed.slice(0, 200) : null;

    const { error } = await supabase
      .from("receipts")
      .update({ note: next, extraction_source: "manual" })
      .eq("id", receiptId);

    if (error) {
      setMsg(`Error updating note: ${error.message}`);
      return;
    }

    setNoteErrors((prev) => {
      const copy = { ...prev };
      if (!next) copy[receiptId] = "Required when category is Other.";
      else delete copy[receiptId];
      return copy;
    });

    await load({ refresh: true });
    setEditingNoteId(null);
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

    await load({ refresh: true });
  }

  async function toggleReviewed(receiptId: string, current: boolean) {
    if (batch?.locked) return;

    const next = !current;
    const { error } = await supabase
      .from("receipts")
      .update({ reviewed: next, extraction_source: "manual" })
      .eq("id", receiptId);

    if (error) setMsg(`Error updating reviewed: ${error.message}`);
    else await load({ refresh: true });
  }

  function validateOtherNotes(currentRows: ReceiptRow[]) {
    const errs: Record<string, string> = {};
    for (const r of currentRows) {
      if (needsOtherNote(r) && !String(r.note ?? "").trim()) {
        errs[r.id] = "Required when category is Other.";
      }
    }
    setNoteErrors(errs);
    return Object.keys(errs).length === 0;
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

    // Option A: block submit if any "Other" lacks a note
    const okNotes = validateOtherNotes(rows);
    if (!okNotes) {
      setMsg('Please add a description for receipts categorized as "Other".');
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

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session?.access_token) {
        setMsg("Unable to authenticate. Please sign out and sign back in.");
        setSending(false);
        return;
      }

      const response = await fetch("/api/batches/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({ batchId: batch.id }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMsg(
          result.error ||
            "Failed to send email. Batch was locked but email may not have been sent."
        );
      } else {
        setMsg("Batch sent successfully to the accountant!");
        await load({ refresh: true });
      }
    } catch (err) {
      setMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      style={{
        maxWidth: 980,
        margin: isMobile ? "20px auto" : "40px auto",
        padding: isMobile ? "0 16px" : "0 24px",
        paddingBottom:
          isMobile && rows.length > 0 && !batch?.locked ? "100px" : undefined,
      }}
    >
      <button
        onClick={() => router.push("/dashboard")}
        style={{
          padding: isMobile ? "12px 16px" : "10px 20px",
          marginBottom: isMobile ? 16 : 24,
          background: "white",
          border: "1px solid #e0e0e0",
          borderRadius: 4,
          color: "#30a9a0",
          fontWeight: 600,
          fontSize: 14,
          cursor: "pointer",
          minHeight: 44,
          width: isMobile ? "100%" : "auto",
        }}
      >
        ← Back to Batches
      </button>

      {initialLoading ? (
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
              padding: isMobile ? 16 : 24,
              border: "1px solid #e0e0e0",
              borderRadius: 8,
              background: "#f8f9fa",
            }}
          >
            <h2
              style={{
                fontSize: isMobile ? 16 : 18,
                fontWeight: 600,
                color: "#30a9a0",
                marginBottom: 8,
              }}
            >
              Add Receipts
            </h2>
            <p style={{ marginTop: 4, color: "#666", fontSize: isMobile ? 13 : 14 }}>
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
              onClick={() =>
                document.getElementById("receipt-file-input")?.click()
              }
              disabled={adding || !!batch.locked}
              style={{
                marginTop: 16,
                padding: isMobile ? "14px 20px" : "12px 24px",
                borderRadius: 4,
                border: "none",
                background: adding || batch.locked ? "#ccc" : "#30a9a0",
                color: "white",
                fontWeight: 600,
                fontSize: isMobile ? 15 : 14,
                cursor: adding || batch.locked ? "not-allowed" : "pointer",
                width: isMobile ? "100%" : "auto",
                minHeight: 44,
              }}
            >
              {batch.locked
                ? "Batch Locked"
                : adding
                ? "Adding…"
                : "Choose Receipt Files"}
            </button>

            <p style={{ marginTop: 8, color: "#666", fontSize: isMobile ? 12 : 14 }}>
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
              flexWrap: isMobile ? "wrap" : "nowrap",
              gap: isMobile ? 12 : 0,
            }}
          >
            <h2
              style={{
                fontSize: isMobile ? 18 : 20,
                fontWeight: 600,
                color: "#30a9a0",
                width: isMobile ? "100%" : "auto",
              }}
            >
              Receipts in This Batch
            </h2>

            {!isMobile && rows.length > 0 && !batch.locked && (
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
                  minHeight: 44,
                }}
              >
                {sending ? "Sending…" : "Send to Accountant"}
              </button>
            )}

            {!isMobile && batch.locked && (
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
          ) : isMobile ? (
            // Mobile: Card-based layout
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 16 }}>
              {rows.map((r) => {
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
                const cat = effectiveCategory(r);
                const showNote = cat === "Other";

                return (
                  <div key={r.id}>
                    <div
                      style={{
                        border: "1px solid #e0e0e0",
                        borderRadius: 8,
                        background: "white",
                        padding: 16,
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      {/* Vendor */}
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 4 }}>
                          Vendor
                        </div>
                        {editingVendorId === r.id ? (
                          <input
                            type="text"
                            value={vendorDraft}
                            onChange={(e) => setVendorDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") updateVendor(r.id, vendorDraft);
                              if (e.key === "Escape") setEditingVendorId(null);
                            }}
                            onBlur={() => updateVendor(r.id, vendorDraft)}
                            autoFocus
                            disabled={isLocked}
                            style={{
                              width: "100%",
                              padding: "10px 12px",
                              borderRadius: 4,
                              border: "1px solid #30a9a0",
                              fontSize: 14,
                              minHeight: 44,
                            }}
                          />
                        ) : (
                          <div
                            onClick={() => {
                              if (isLocked) return;
                              setEditingVendorId(r.id);
                              setVendorDraft(r.vendor ?? "");
                              setMsg(null);
                            }}
                            style={{
                              padding: "10px 12px",
                              borderRadius: 4,
                              border: "1px solid #e0e0e0",
                              background: "#fafafa",
                              cursor: isLocked ? "default" : "pointer",
                              minHeight: 44,
                              display: "flex",
                              alignItems: "center",
                              color: r.vendor ? "#1a1a1a" : "#666",
                              fontSize: 14,
                            }}
                            title={isLocked ? "" : "Tap to edit vendor"}
                          >
                            {r.vendor ?? "—"}
                          </div>
                        )}
                      </div>

                      {/* Total + Date */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 4 }}>
                            Total
                          </div>
                          {editingTotalId === r.id ? (
                            <input
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              value={totalDraft}
                              onChange={(e) => setTotalDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") updateTotal(r.id, totalDraft);
                                if (e.key === "Escape") setEditingTotalId(null);
                              }}
                              onBlur={() => updateTotal(r.id, totalDraft)}
                              autoFocus
                              disabled={isLocked}
                              style={{
                                width: "100%",
                                padding: "10px 12px",
                                borderRadius: 4,
                                border: "1px solid #30a9a0",
                                fontSize: 14,
                                fontWeight: 600,
                                minHeight: 44,
                              }}
                            />
                          ) : (
                            <div
                              onClick={() => {
                                if (isLocked) return;
                                setEditingTotalId(r.id);
                                setTotalDraft(typeof r.total === "number" ? String(r.total) : "");
                                setMsg(null);
                              }}
                              style={{
                                padding: "10px 12px",
                                borderRadius: 4,
                                border: "1px solid #e0e0e0",
                                background: "#fafafa",
                                cursor: isLocked ? "default" : "pointer",
                                minHeight: 44,
                                display: "flex",
                                alignItems: "center",
                                color: typeof r.total === "number" ? "#1a1a1a" : "#666",
                                fontSize: 14,
                                fontWeight: 600,
                              }}
                              title={isLocked ? "" : "Tap to edit total"}
                            >
                              {typeof r.total === "number" ? `$${r.total.toFixed(2)}` : "—"}
                            </div>
                          )}
                        </div>

                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 4 }}>
                            Date
                          </div>
                          {editingDateId === r.id ? (
                            <input
                              type="date"
                              value={dateDraft}
                              onChange={(e) => setDateDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") updateReceiptDate(r.id, dateDraft);
                                if (e.key === "Escape") setEditingDateId(null);
                              }}
                              onBlur={() => updateReceiptDate(r.id, dateDraft)}
                              autoFocus
                              disabled={isLocked}
                              style={{
                                width: "100%",
                                padding: "10px 12px",
                                borderRadius: 4,
                                border: "1px solid #30a9a0",
                                fontSize: 14,
                                minHeight: 44,
                              }}
                            />
                          ) : (
                            <div
                              onClick={() => {
                                if (isLocked) return;
                                setEditingDateId(r.id);
                                setDateDraft(r.receipt_date ?? "");
                                setMsg(null);
                              }}
                              style={{
                                padding: "10px 12px",
                                borderRadius: 4,
                                border: "1px solid #e0e0e0",
                                background: "#fafafa",
                                cursor: isLocked ? "default" : "pointer",
                                minHeight: 44,
                                display: "flex",
                                alignItems: "center",
                                color: r.receipt_date ? "#1a1a1a" : "#666",
                                fontSize: 14,
                              }}
                              title={isLocked ? "" : "Tap to edit date"}
                            >
                              {r.receipt_date ?? "—"}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Category */}
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 4 }}>
                          Category
                        </div>
                        {editingCategory === r.id ? (
                          <select
                            value={r.category_final ?? r.category_suggested ?? ""}
                            onChange={(e) => updateCategory(r.id, e.target.value)}
                            onBlur={() => setEditingCategory(null)}
                            autoFocus
                            disabled={isLocked}
                            style={{
                              width: "100%",
                              padding: "10px 12px",
                              borderRadius: 4,
                              border: "1px solid #30a9a0",
                              fontSize: 14,
                              cursor: isLocked ? "not-allowed" : "pointer",
                              minHeight: 44,
                              background: "white",
                            }}
                          >
                            <option value="">—</option>
                            {categories.map((catOpt) => (
                              <option key={catOpt} value={catOpt}>
                                {catOpt}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div
                            onClick={() => {
                              if (!isLocked) setEditingCategory(r.id);
                            }}
                            style={{
                              padding: "10px 12px",
                              borderRadius: 4,
                              border: "1px solid #e0e0e0",
                              background: "#fafafa",
                              cursor: isLocked ? "default" : "pointer",
                              minHeight: 44,
                              display: "flex",
                              alignItems: "center",
                              color: "#666",
                              fontSize: 14,
                            }}
                            title={isLocked ? "" : "Tap to edit category"}
                          >
                            {r.category_final ?? r.category_suggested ?? "—"}
                          </div>
                        )}
                      </div>

                      {/* Confidence + Reviewed */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 4 }}>
                            Confidence
                          </div>
                          {confidencePercent !== null ? (
                            <div
                              style={{
                                padding: "10px 12px",
                                borderRadius: 4,
                                background: confidenceBg,
                                color: confidenceColor,
                                fontSize: 14,
                                fontWeight: 600,
                                minHeight: 44,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              {confidencePercent}%
                            </div>
                          ) : (
                            <div
                              style={{
                                padding: "10px 12px",
                                borderRadius: 4,
                                border: "1px solid #e0e0e0",
                                background: "#fafafa",
                                color: "#666",
                                fontSize: 14,
                                minHeight: 44,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              —
                            </div>
                          )}
                        </div>

                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 4 }}>
                            Reviewed
                          </div>
                          <button
                            onClick={() => toggleReviewed(r.id, r.reviewed)}
                            disabled={isLocked}
                            style={{
                              width: "100%",
                              padding: "10px 12px",
                              borderRadius: 4,
                              border: "none",
                              background: r.reviewed ? "#e8f5e9" : "#fff3e0",
                              color: r.reviewed ? "#2e7d32" : "#e65100",
                              fontSize: 14,
                              fontWeight: 600,
                              cursor: isLocked ? "not-allowed" : "pointer",
                              minHeight: 44,
                            }}
                            title={isLocked ? "" : "Tap to toggle reviewed"}
                          >
                            {r.reviewed ? "Yes" : "No"}
                          </button>
                        </div>
                      </div>

                      {/* Delete */}
                      <button
                        onClick={() => deleteReceipt(r.id)}
                        disabled={isLocked}
                        style={{
                          width: "100%",
                          padding: "12px",
                          borderRadius: 4,
                          border: "1px solid #e0e0e0",
                          background: isLocked ? "#f5f5f5" : "white",
                          color: isLocked ? "#999" : "#c33",
                          fontSize: 14,
                          fontWeight: 600,
                          cursor: isLocked ? "not-allowed" : "pointer",
                          minHeight: 44,
                        }}
                        title={isLocked ? "" : "Delete this receipt row"}
                      >
                        Delete
                      </button>

                      {/* Mobile: Other note */}
                      {showNote && (
                        <div style={{ marginTop: 4 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#444", marginBottom: 6 }}>
                            Describe (required)
                          </div>
                          {editingNoteId === r.id ? (
                            <textarea
                              value={noteDraft}
                              onChange={(e) => setNoteDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") setEditingNoteId(null);
                                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                                  updateNote(r.id, noteDraft);
                                }
                              }}
                              onBlur={() => updateNote(r.id, noteDraft)}
                              autoFocus
                              disabled={isLocked}
                              rows={3}
                              style={{
                                width: "100%",
                                padding: "10px 12px",
                                borderRadius: 6,
                                border: noteErrors[r.id] ? "1px solid #c33" : "1px solid #30a9a0",
                                fontSize: 14,
                                resize: "vertical",
                                minHeight: 80,
                              }}
                              placeholder="e.g., Flowers for service / Reimbursement / Client supplies"
                            />
                          ) : (
                            <div
                              onClick={() => {
                                if (isLocked) return;
                                setEditingNoteId(r.id);
                                setNoteDraft(String(r.note ?? ""));
                                setMsg(null);
                              }}
                              style={{
                                width: "100%",
                                minHeight: 80,
                                padding: "10px 12px",
                                borderRadius: 6,
                                border: noteErrors[r.id] ? "1px solid #c33" : "1px solid #e0e0e0",
                                background: "#fafafa",
                                cursor: isLocked ? "default" : "pointer",
                                fontSize: 14,
                                color: r.note ? "#1a1a1a" : "#777",
                                display: "flex",
                                alignItems: "flex-start",
                              }}
                              title={isLocked ? "" : "Tap to add/edit description"}
                            >
                              {r.note?.trim()
                                ? r.note
                                : "Tap to add a short description (required for Other)"}
                            </div>
                          )}
                          {noteErrors[r.id] && (
                            <div style={{ marginTop: 6, color: "#c33", fontSize: 12, fontWeight: 600 }}>
                              {noteErrors[r.id]}
                            </div>
                          )}
                          <div style={{ marginTop: 6, color: "#777", fontSize: 12 }}>
                            Tip: Press Ctrl+Enter (or Cmd+Enter) to save while typing.
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            // Desktop: Grid Layout
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
                const cat = effectiveCategory(r);
                const showNote = cat === "Other";

                return (
                  <div key={r.id}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "140px 1fr 120px 160px 110px 110px 90px",
                        padding: "14px 16px",
                        borderBottom: showNote
                          ? "none"
                          : idx < rows.length - 1
                          ? "1px solid #f0f0f0"
                          : "none",
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
                              if (e.key === "Escape") setEditingDateId(null);
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
                              if (e.key === "Escape") setEditingVendorId(null);
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
                              if (e.key === "Escape") setEditingTotalId(null);
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
                              setTotalDraft(typeof r.total === "number" ? String(r.total) : "");
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
                            {categories.map((catOpt) => (
                              <option key={catOpt} value={catOpt}>
                                {catOpt}
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

                    {/* Option A: note row shown only when category is Other */}
                    {showNote && (
                      <div
                        style={{
                          padding: "0 16px 14px 16px",
                          borderBottom: idx < rows.length - 1 ? "1px solid #f0f0f0" : "none",
                          background: "white",
                        }}
                      >
                        <div style={{ marginLeft: 140 + 8, marginTop: 8 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#444", marginBottom: 6 }}>
                            Describe (required)
                          </div>

                          {editingNoteId === r.id ? (
                            <textarea
                              value={noteDraft}
                              onChange={(e) => setNoteDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") setEditingNoteId(null);
                                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                                  updateNote(r.id, noteDraft);
                                }
                              }}
                              onBlur={() => updateNote(r.id, noteDraft)}
                              autoFocus
                              disabled={isLocked}
                              rows={2}
                              style={{
                                width: "100%",
                                maxWidth: 560,
                                padding: "8px 10px",
                                borderRadius: 6,
                                border: noteErrors[r.id] ? "1px solid #c33" : "1px solid #30a9a0",
                                fontSize: 13,
                                resize: "vertical",
                              }}
                              placeholder="e.g., Flowers for service / Reimbursement / Client supplies"
                            />
                          ) : (
                            <div
                              onClick={() => {
                                if (isLocked) return;
                                setEditingNoteId(r.id);
                                setNoteDraft(String(r.note ?? ""));
                                setMsg(null);
                              }}
                              style={{
                                width: "100%",
                                maxWidth: 560,
                                minHeight: 44,
                                padding: "8px 10px",
                                borderRadius: 6,
                                border: noteErrors[r.id] ? "1px solid #c33" : "1px solid #e0e0e0",
                                background: "#fafafa",
                                cursor: isLocked ? "default" : "pointer",
                                fontSize: 13,
                                color: r.note ? "#1a1a1a" : "#777",
                                display: "flex",
                                alignItems: "center",
                              }}
                              title={isLocked ? "" : "Click to add/edit description"}
                            >
                              {r.note?.trim()
                                ? r.note
                                : "Click to add a short description (required for Other)"}
                            </div>
                          )}

                          {noteErrors[r.id] && (
                            <div style={{ marginTop: 6, color: "#c33", fontSize: 12, fontWeight: 600 }}>
                              {noteErrors[r.id]}
                            </div>
                          )}

                          <div style={{ marginTop: 6, color: "#777", fontSize: 12 }}>
                            Tip: Press Ctrl+Enter (or Cmd+Enter) to save while typing.
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Mobile: Sticky bottom bar for Send to Accountant */}
          {isMobile && rows.length > 0 && !batch.locked && (
            <div
              style={{
                position: "fixed",
                bottom: 0,
                left: 0,
                right: 0,
                background: "white",
                borderTop: "2px solid #e0e0e0",
                padding: "16px",
                boxShadow: "0 -2px 8px rgba(0,0,0,0.1)",
                zIndex: 1000,
              }}
            >
              <button
                onClick={sendToAccountant}
                disabled={sending}
                style={{
                  width: "100%",
                  padding: "16px",
                  borderRadius: 4,
                  border: "none",
                  background: sending ? "#ccc" : "#30a9a0",
                  color: "white",
                  fontWeight: 600,
                  fontSize: 16,
                  cursor: sending ? "not-allowed" : "pointer",
                  minHeight: 56,
                }}
              >
                {sending ? "Sending…" : "Send to Accountant"}
              </button>
            </div>
          )}

          {/* Mobile: Locked status indicator */}
          {isMobile && batch.locked && (
            <div
              style={{
                marginTop: 16,
                padding: "16px",
                borderRadius: 8,
                background: "#e8f5e9",
                border: "1px solid #2e7d32",
                textAlign: "center",
              }}
            >
              <span
                style={{
                  color: "#2e7d32",
                  fontSize: 16,
                  fontWeight: 600,
                }}
              >
                ✓ Sent to Accountant
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
