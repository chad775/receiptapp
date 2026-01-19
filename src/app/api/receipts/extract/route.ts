import OpenAI from "openai";

export const runtime = "nodejs";

type ExtractResult = {
  vendor: string | null;
  receipt_date: string | null; // YYYY-MM-DD
  total: number | null;
  currency: string | null;
  category_suggested: string | null;
  confidence: number | null; // 0..1
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function stripDataUrlPrefix(dataUrl: string): { mimeType: string; base64: string } {
  // Expected: data:<mime>;base64,<...>
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) return { mimeType: "", base64: "" };
  return { mimeType: match[1], base64: match[2] };
}

function normalizeBase64(b64: string): string {
  // Remove whitespace/newlines; add padding if missing
  let s = (b64 || "").replace(/\s+/g, "");
  const pad = s.length % 4;
  if (pad !== 0) s = s + "=".repeat(4 - pad);
  return s;
}

function approxBytesFromBase64(b64: string): number {
  const s = normalizeBase64(b64);
  const padding = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  return Math.floor((s.length * 3) / 4) - padding;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const imageDataUrl = body?.imageDataUrl as string | undefined;

    // PDF payload (from your updated BatchDetailPage)
    const fileBase64Raw = body?.fileBase64 as string | undefined; // base64 WITHOUT data: prefix (expected)
    const fileName = body?.fileName as string | undefined;
    const mimeType = body?.mimeType as string | undefined;

    if (!process.env.OPENAI_API_KEY) {
      return Response.json({ ok: false, error: "Missing OPENAI_API_KEY in env" }, { status: 500 });
    }

    const isPdfByFields =
      mimeType === "application/pdf" ||
      (typeof fileName === "string" && fileName.toLowerCase().endsWith(".pdf"));

    const isPdfByDataUrl =
      typeof imageDataUrl === "string" && imageDataUrl.startsWith("data:application/pdf");

    const isImageByDataUrl =
      typeof imageDataUrl === "string" && imageDataUrl.startsWith("data:image/");

    if (!isPdfByFields && !isPdfByDataUrl && !isImageByDataUrl) {
      return Response.json(
        {
          ok: false,
          error:
            "Unsupported input. Provide imageDataUrl (data:image/...;base64,...) or PDF (fileBase64 + mimeType=application/pdf, or imageDataUrl data:application/pdf...).",
        },
        { status: 400 }
      );
    }

    const model = "gpt-4o-mini";
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        vendor: { anyOf: [{ type: "string" }, { type: "null" }] },
        receipt_date: { anyOf: [{ type: "string" }, { type: "null" }] },
        total: { anyOf: [{ type: "number" }, { type: "null" }] },
        currency: { anyOf: [{ type: "string" }, { type: "null" }] },
        category_suggested: { anyOf: [{ type: "string" }, { type: "null" }] },
        confidence: { anyOf: [{ type: "number" }, { type: "null" }] },
      },
      required: ["vendor", "receipt_date", "total", "currency", "category_suggested", "confidence"],
    } as const;

    const content: any[] = [];

    if (isPdfByFields || isPdfByDataUrl) {
      // Resolve base64 PDF bytes (NO "data:" prefix in incoming payload)
      let pdfBase64 = "";

      if (typeof fileBase64Raw === "string" && fileBase64Raw.length > 0) {
        pdfBase64 = fileBase64Raw;
      } else if (typeof imageDataUrl === "string" && imageDataUrl.startsWith("data:application/pdf")) {
        const parsed = stripDataUrlPrefix(imageDataUrl);
        if (!parsed.base64) {
          return Response.json({ ok: false, error: "Invalid PDF data URL" }, { status: 400 });
        }
        pdfBase64 = parsed.base64;
      } else {
        return Response.json(
          { ok: false, error: "Missing PDF data. Provide fileBase64 or data:application/pdf base64 URL." },
          { status: 400 }
        );
      }

      pdfBase64 = normalizeBase64(pdfBase64);

      // Guardrail: JSON body/base64 can get truncated; fail fast with a clear error.
      if (pdfBase64.length < 2000) {
        return Response.json(
          {
            ok: false,
            error:
              "PDF payload looks too small / truncated. Try a smaller PDF or upload a JPG/PNG instead.",
          },
          { status: 400 }
        );
      }

      const approxBytes = approxBytesFromBase64(pdfBase64);
      const maxBytes = 12 * 1024 * 1024; // conservative for JSON/base64 transport
      if (approxBytes > maxBytes) {
        return Response.json(
          {
            ok: false,
            error: `PDF is too large (~${(approxBytes / (1024 * 1024)).toFixed(
              1
            )}MB) for JSON/base64 upload. Please upload a smaller PDF or an image.`,
          },
          { status: 413 }
        );
      }

      // IMPORTANT: The OpenAI docs' Node example uses a full data URL for file_data. :contentReference[oaicite:0]{index=0}
      const pdfDataUrl = `data:application/pdf;base64,${pdfBase64}`;

      content.push({
        type: "input_file",
        filename: fileName || "receipt.pdf",
        file_data: pdfDataUrl,
      });

      content.push({
        type: "input_text",
        text:
          "This file is a receipt (possibly a scanned PDF). Extract bookkeeping fields. " +
          "Return vendor, receipt_date (YYYY-MM-DD), total (number), currency (e.g. USD), " +
          "category_suggested (e.g. Meals, Fuel, Office Supplies, Travel, Repairs), " +
          "and confidence (0 to 1). If missing, use null. Do not guess wildly.",
      });
    } else {
      // Image path (existing behavior)
      if (!imageDataUrl || typeof imageDataUrl !== "string") {
        return Response.json({ ok: false, error: "Missing imageDataUrl" }, { status: 400 });
      }
      if (!imageDataUrl.startsWith("data:image/")) {
        return Response.json(
          { ok: false, error: "imageDataUrl must be a data:image/... base64 data URL" },
          { status: 400 }
        );
      }

      content.push({
        type: "input_image",
        image_url: imageDataUrl,
        detail: "auto",
      });

      content.push({
        type: "input_text",
        text:
          "Extract bookkeeping fields from this receipt image. " +
          "Return vendor, receipt_date (YYYY-MM-DD), total (number), currency (e.g. USD), " +
          "category_suggested (e.g. Meals, Fuel, Office Supplies, Travel, Repairs), " +
          "and confidence (0 to 1). If missing, use null. Do not guess wildly.",
      });
    }

    const response = await client.responses.create({
      model,
      input: [
        {
          role: "user",
          content,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "receipt_extract_v1",
          strict: true,
          schema,
        },
      },
    });

    const rawText = response.output_text || "";

    let parsed: ExtractResult;
    try {
      parsed = JSON.parse(rawText) as ExtractResult;
    } catch {
      return Response.json({ ok: false, error: "Model returned non-JSON output", raw: rawText }, { status: 502 });
    }

    if (typeof parsed.confidence === "number") {
      parsed.confidence = clamp(parsed.confidence, 0, 1);
    }

    return Response.json({
      ok: true,
      model_used: model,
      result: parsed,
    });
  } catch (err: any) {
    return Response.json({ ok: false, error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
