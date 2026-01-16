"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Batch = {
  id: string;
  name: string | null;
  locked: boolean;
  submitted_at: string | null;
  submitted_count: number | null;
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

  extracted_at: string | null;
  extraction_source: string | null;
  extraction_model: string | null;
};

type ExtractResult = {
  vendor: string | null;
  receipt_date: string | null;
  total: number | null;
  currency: string | null;
  category_suggested: string | null;
  confidence: number | null;
};

const CATEGORY_OPTIONS = [
  "Meals",
  "Fuel",
  "Office Supplies",
  "Travel",
  "Repairs",
  "Advertising",
  "Insurance",
  "Rent",
  "Utilities",
  "Software",
  "Professional Fees",
  "Other"
];

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("File read failed"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export default function BatchDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const batchId = useMemo(() => params?.id, [params]);

  const [batch, setBatch] = useState<Batch | null>(null);
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [processing, setProcessing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setMsg(null);

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      router.replace("/login");
      return;
    }

    const batchRes = await supabase
      .from("batches")
      .select("id,name,locked,submitted_at,submitted_count")
      .eq("id", batchId)
      .single();

    if (batchRes.error) {
      setMsg(batchRes.error.message);
      setLoading(false);
      return;
    }

    setBatch(batchRes.data as any);

    const receiptsRes = await supabase
      .from("receipts")
      .select("id,vendor,receipt_date,total,category_suggested,category_final,confidence,reviewed,created_at,extracted_at,extraction_source,extraction_model")
      .eq("batch_id", batchId)
      .order("created_at", { ascending: false });

    if (receiptsRes.error) {
      setMsg(receiptsRes.error.message);
      setRows([]);
      setLoading(false);
      return;
    }

    setRows(receiptsRes.data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (batchId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  async function extractOne(imageDataUrl: string): Promise<{ result: ExtractResult; model_used: string }> {
    const res = await fetch("/api/receipts/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageDataUrl })
    });

    const json = await res.json();
    if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Extraction failed");

    return { result: json.result as ExtractResult, model_used: String(json.model_used || "") };
  }

  async function insertReceipt(result: ExtractResult, modelUsed: string) {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) {
      router.replace("/login");
      return;
    }

    const ins = await supabase.from("receipts").insert({
      user_id: user.id,
      batch_id: batchId,
      vendor: result.vendor,
      receipt_date: result.receipt_date,
      total: result.total,
      category_suggested: result.category_suggested,
      category_final: null,
      confidence: result.confidence,
      reviewed: false,

      extracted_at: new Date().toISOString(),
      extraction_source: "ai",
      extraction_model: modelUsed || null,
      extraction_result: result
    });

    if (ins.error) throw new Error(ins.error.message);
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (batch && batch.locked) return;

    setMsg(null);
    setProcessing(true);

    try {
      for (const f of Array.from(files)) {
        const dataUrl = await fileToDataUrl(f);
        const ex = await extractOne(dataUrl);
        await insertReceipt(ex.result, ex.model_used);
      }
      await load();
    } catch (e: any) {
      setMsg(e?.message ?? "Something went wrong.");
    } finally {
      setProcessing(false);
    }
  }

  async function setReviewed(id: string, reviewed: boolean) {
    setMsg(null);
    const res = await supabase
      .from("receipts")
      .update({ reviewed: reviewed, extraction_source: "manual" })
      .eq("id", id);

    if (res.error) setMsg(res.error.message);
    else setRows((prev) => prev.map((r) => (r.id === id ? { ...r, reviewed: reviewed, extraction_source: "manual" } : r)));
  }

  async function setCategoryFinal(id: string, category: string | null) {
    setMsg(null);
    const res = await supabase
      .from("receipts")
      .update({ category_final: category, extraction_source: "manual" })
      .eq("id", id);

    if (res.error) setMsg(res.error.message);
    else setRows((prev) => prev.map((r) => (r.id === id ? { ...r, category_final: category, extraction_source: "manual" } : r)));
  }

  async function submitBatch() {
    if (!batchId) return;
    setMsg(null);
    setSubmitting(true);

    try {
      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes?.data?.session?.access_token;
      if (!token) {
        router.replace("/login");
        return;
      }

      const res = await fetch("/api/batches/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({ batchId: batchId })
      });

      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Submit failed");

      setMsg("Sent to accountant. Receipts: " + json.count + ". This batch is now locked.");
      await load();
    } catch (e: any) {
      setMsg(e?.message ?? "Submit failed.");
    } finally {
      setSubmitting(false);
    }
  }

  function rowBg(conf: number | null): string {
    if (typeof conf !== "number") return "transparent";
    if (conf < 0.60) return "#ffe5e5";
    if (conf < 0.75) return "#fff6d6";
    return "transparent";
  }

  const locked = !!batch?.locked;
  const lockedText =
    locked
      ? "Submitted" + (batch?.submitted_at ? " on " + new Date(batch.submitted_at).toLocaleString() : "")
      : "In progress";

  return (
    <div style={{ maxWidth: 980, margin: "40px auto", padding: 16 }}>
      <button onClick={() => router.push("/dashboard")} style={{ padding: 10 }}>
        ← Back
      </button>

      {loading ? (
        <p style={{ marginTop: 16 }}>Loading...</p>
      ) : (
        <>
          <h1 style={{ fontSize: 22, fontWeight: 800, marginTop: 12 }}>
            {batch?.name ?? "Receipt Batch"}
          </h1>

          <div style={{ marginTop: 8, color: "#666" }}>{lockedText}</div>

          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              id="file"
              type="file"
              accept="image/*"
              multiple
              disabled={processing || submitting || locked}
              onChange={(e) => handleFiles(e.target.files)}
              style={{ display: "none" }}
            />

            <button
              onClick={() => document.getElementById("file")?.click()}
              disabled={processing || submitting || locked}
              style={{ padding: 12, fontWeight: 800 }}
            >
              {locked ? "Batch Locked" : (processing ? "Adding..." : "Add receipts")}
            </button>

            <button
              onClick={submitBatch}
              disabled={submitting || processing || locked || rows.length === 0}
              style={{ padding: 12, fontWeight: 800 }}
            >
              {locked ? "Sent" : (submitting ? "Sending..." : "Send to accountant")}
            </button>
          </div>

          {msg && <p style={{ marginTop: 12 }}>{msg}</p>}

          <div style={{ marginTop: 22 }}>
            <h2 style={{ fontSize: 16, fontWeight: 800 }}>Receipts</h2>

            {rows.length === 0 ? (
              <p style={{ marginTop: 10 }}>No receipts yet.</p>
            ) : (
              <div style={{ marginTop: 10, border: "1px solid #ddd", borderRadius: 10, overflow: "hidden" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "90px 140px 1fr 120px 210px 120px 170px",
                    padding: 10,
                    fontWeight: 800,
                    background: "#f7f7f7",
                    borderBottom: "1px solid #ddd"
                  }}
                >
                  <div>Reviewed</div>
                  <div>Date</div>
                  <div>Vendor</div>
                  <div>Total</div>
                  <div>Category</div>
                  <div>Confidence</div>
                  <div>Source</div>
                </div>

                {rows.map((r) => {
                  const categoryDisplay = r.category_final ?? r.category_suggested ?? "";
                  const confText = typeof r.confidence === "number" ? r.confidence.toFixed(2) : "—";
                  const source = r.extraction_source ? r.extraction_source : "—";
                  const model = r.extraction_model ? r.extraction_model : "";
                  const sourceText = model ? (source + " (" + model + ")") : source;

                  return (
                    <div
                      key={r.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "90px 140px 1fr 120px 210px 120px 170px",
                        padding: 10,
                        borderBottom: "1px solid #eee",
                        background: rowBg(r.confidence)
                      }}
                    >
                      <div>
                        <input
                          type="checkbox"
                          checked={!!r.reviewed}
                          disabled={locked}
                          onChange={(e) => setReviewed(r.id, e.target.checked)}
                        />
                      </div>

                      <div>{r.receipt_date ?? "—"}</div>
                      <div>{r.vendor ?? "—"}</div>
                      <div>{r.total ?? "—"}</div>

                      <div>
                        <select
                          value={r.category_final ?? ""}
                          disabled={locked}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCategoryFinal(r.id, val === "" ? null : val);
                          }}
                          style={{ width: "100%", padding: 6 }}
                        >
                          <option value="">(Use suggestion){categoryDisplay ? " - " + categoryDisplay : ""}</option>
                          {CATEGORY_OPTIONS.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>{confText}</div>
                      <div>{sourceText}</div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ marginTop: 10, color: "#666" }}>
              Confidence colors: yellow &lt; 0.75, red &lt; 0.60
            </div>
          </div>
        </>
      )}
    </div>
  );
}