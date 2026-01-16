import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function csvEscape(value: any) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.indexOf('"') >= 0 || s.indexOf(",") >= 0 || s.indexOf("\n") >= 0 || s.indexOf("\r") >= 0) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const emailTo = process.env.EMAIL_TO;
    const emailFrom = process.env.EMAIL_FROM;

    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    if (!supabaseUrl || !supabaseAnon) {
      return Response.json({ ok: false, error: "Missing Supabase env vars" }, { status: 500 });
    }
    if (!emailTo || !emailFrom) {
      return Response.json({ ok: false, error: "Missing EMAIL_TO or EMAIL_FROM in env" }, { status: 500 });
    }
    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
      return Response.json({ ok: false, error: "Missing SMTP_* env vars" }, { status: 500 });
    }

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return Response.json({ ok: false, error: "Missing Authorization Bearer token" }, { status: 401 });
    }

    const body = await req.json();
    const batchId = body?.batchId;
    if (!batchId || typeof batchId !== "string") {
      return Response.json({ ok: false, error: "Missing batchId" }, { status: 400 });
    }

    // Supabase client running as the user (RLS enforced)
    const supabaseUser = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: "Bearer " + token } }
    });

    const userRes = await supabaseUser.auth.getUser();
    if (userRes.error || !userRes.data.user) {
      return Response.json({ ok: false, error: "Unauthorized (invalid session)" }, { status: 401 });
    }

    // Check batch locked status (RLS ensures they can only see their own)
    const batchRes = await supabaseUser
      .from("batches")
      .select("id,name,locked,submitted_at")
      .eq("id", batchId)
      .single();

    if (batchRes.error || !batchRes.data) {
      return Response.json({ ok: false, error: "Batch not found" }, { status: 404 });
    }

    if (batchRes.data.locked) {
      return Response.json({ ok: false, error: "Batch is already submitted/locked." }, { status: 409 });
    }

    // Pull receipts for this batch (as user)
    const receiptsRes = await supabaseUser
      .from("receipts")
      .select("receipt_date,vendor,total,category_suggested,category_final,confidence,reviewed,created_at")
      .eq("batch_id", batchId)
      .order("created_at", { ascending: true });

    if (receiptsRes.error) {
      return Response.json({ ok: false, error: receiptsRes.error.message }, { status: 500 });
    }

    const rows = receiptsRes.data || [];
    if (rows.length === 0) {
      return Response.json({ ok: false, error: "No receipts in this batch." }, { status: 400 });
    }

    const batchName = batchRes.data.name ? batchRes.data.name : ("Batch " + String(batchId).slice(0, 8));

    // Build CSV
    const headers = ["receipt_date","vendor","total","category","confidence","reviewed","created_at"];
    let csv = headers.join(",") + "\n";

    for (const r of rows) {
      const category = r.category_final || r.category_suggested || "";
      const line = [
        csvEscape(r.receipt_date),
        csvEscape(r.vendor),
        csvEscape(r.total),
        csvEscape(category),
        csvEscape(r.confidence),
        csvEscape(r.reviewed),
        csvEscape(r.created_at)
      ].join(",");
      csv += line + "\n";
    }

    // Email CSV
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(smtpPort),
      secure: Number(smtpPort) === 465,
      auth: { user: smtpUser, pass: smtpPass }
    });

    const safeName = String(batchName).replace(/[^a-zA-Z0-9-_ ]/g, "").trim();
    const filename = (safeName || "batch") + ".csv";

    const info = await transporter.sendMail({
      from: emailFrom,
      to: emailTo,
      subject: "Receipts CSV - " + batchName,
      text: "Attached is the receipts CSV for batch: " + batchName + ". Receipts count: " + rows.length + ".",
      attachments: [{ filename: filename, content: csv, contentType: "text/csv" }]
    });

    console.log("Submit email sent:", info.messageId, "to:", emailTo, "count:", rows.length);

    // Lock the batch
    const updateRes = await supabaseUser
      .from("batches")
      .update({
        locked: true,
        submitted_at: new Date().toISOString(),
        submitted_count: rows.length
      })
      .eq("id", batchId);

    if (updateRes.error) {
      return Response.json({ ok: false, error: "Emailed, but failed to lock batch: " + updateRes.error.message }, { status: 500 });
    }

    return Response.json({ ok: true, sentTo: emailTo, count: rows.length, locked: true });
  } catch (err: any) {
    return Response.json({ ok: false, error: err?.message || "Unknown error" }, { status: 500 });
  }
}