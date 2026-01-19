import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function csvEscape(value: any) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (
    s.indexOf('"') >= 0 ||
    s.indexOf(",") >= 0 ||
    s.indexOf("\n") >= 0 ||
    s.indexOf("\r") >= 0
  ) {
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

    // Create a Supabase client that runs AS THE USER (RLS enforced)
    const supabaseUser = createClient(supabaseUrl, supabaseAnon, {
      global: {
        headers: {
          Authorization: "Bearer " + token,
        },
      },
    });

    // Confirm token is valid
    const userRes = await supabaseUser.auth.getUser();
    if (userRes.error || !userRes.data.user) {
      return Response.json({ ok: false, error: "Unauthorized (invalid session)" }, { status: 401 });
    }

    // Fetch receipts (RLS will ensure only their rows are returned)
    const receiptsRes = await supabaseUser
      .from("receipts")
      .select(
        "receipt_date,vendor,total,category_suggested,category_final,confidence,reviewed,created_at,note"
      )
      .eq("batch_id", batchId)
      .order("created_at", { ascending: true });

    if (receiptsRes.error) {
      return Response.json({ ok: false, error: receiptsRes.error.message }, { status: 500 });
    }

    const rows = receiptsRes.data || [];
    if (rows.length === 0) {
      // This will show as a 404 in the terminal but it's not a route problem.
      return Response.json(
        { ok: false, error: "No receipts found for this batch (as the signed-in user)." },
        { status: 404 }
      );
    }

    // Optional: batch name for nicer subject/filename (also RLS protected)
    let batchName = "Batch " + String(batchId).slice(0, 8);
    const batchRes = await supabaseUser.from("batches").select("name").eq("id", batchId).single();
    if (!batchRes.error && batchRes.data && batchRes.data.name) {
      batchName = batchRes.data.name;
    }

    // Build CSV
    const headers = [
      "receipt_date",
      "vendor",
      "total",
      "category",
      "note",
      "confidence",
      "reviewed",
      "created_at",
    ];
    let csv = headers.join(",") + "\n";

    for (const r of rows) {
      const category = r.category_final || r.category_suggested || "";
      const line = [
        csvEscape(r.receipt_date),
        csvEscape(r.vendor),
        csvEscape(r.total),
        csvEscape(category),
        csvEscape((category === "Other" ? r.note : r.note) || ""), // keep note in CSV; "Other" will commonly use it
        csvEscape(r.confidence),
        csvEscape(r.reviewed),
        csvEscape(r.created_at),
      ].join(",");
      csv += line + "\n";
    }

    // Send email
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(smtpPort),
      secure: Number(smtpPort) === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    const safeName = String(batchName).replace(/[^a-zA-Z0-9-_ ]/g, "").trim();
    const filename = (safeName || "batch") + ".csv";

    const info = await transporter.sendMail({
      from: emailFrom,
      to: emailTo,
      subject: "Receipts CSV - " + batchName,
      text:
        "Attached is the receipts CSV for batch: " +
        batchName +
        ". Receipts count: " +
        rows.length +
        ".",
      attachments: [{ filename: filename, content: csv, contentType: "text/csv" }],
    });

    console.log("Email sent:", info.messageId, "to:", emailTo, "count:", rows.length);

    return Response.json({ ok: true, sentTo: emailTo, count: rows.length });
  } catch (err: any) {
    return Response.json({ ok: false, error: err?.message || "Unknown error" }, { status: 500 });
  }
}
