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

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const imageDataUrl = body?.imageDataUrl as string | undefined;
    const fileBase64 = body?.fileBase64 as string | undefined; // base64 WITHOUT data: prefix
    const fileName = body?.fileName as string | undefined;
    const mimeType = body?.mimeType as string | undefined;

    if (!process.env.OPENAI_API_KEY) {
      return Response.json(
        { ok: false, error: "Missing OPENAI_API_KEY in env" },
        { status: 500 }
      );
    }

    // Determine if this request is an image or a PDF
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
            "Missing or unsupported input. Provide imageDataUrl (data:image/...) or a PDF (fileBase64 + mimeType=application/pdf, or imageDataUrl data:application/pdf...).",
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

    // Build content parts
    const content: any[] = [
      {
        type: "input_text",
        text:
          "Extract bookkeeping fields from this receipt. " +
          "Return vendor, receipt_date (YYYY-MM-DD), total (number), currency (e.g. USD), " +
          "category_suggested (e.g. Meals, Fuel, Office Supplies, Travel, Repairs), " +
          "and confidence (0 to 1). If missing, use null. Do not guess wildly.",
      },
    ];

    if (isPdfByFields || isPdfByDataUrl) {
      // Preferred path: fileBase64 (no data: prefix) + mimeType
      let pdfBase64 = "";
      let resolvedFilename = fileName || "receipt.pdf";

      if (typeof fileBase64 === "string" && fileBase64.length > 0) {
        pdfBase64 = fileBase64;
      } else if (typeof imageDataUrl === "string" && imageDataUrl.startsWith("data:application/pdf")) {
        const parsed = stripDataUrlPrefix(imageDataUrl);
        if (!parsed.base64) {
          return Response.json({ ok: false, error: "Invalid PDF data URL" }, { status: 400 });
        }
        pdfBase64 = parsed.base64;
        if (!resolvedFilename) resolvedFilename = "receipt.pdf";
      } else {
        return Response.json(
          { ok: false, error: "Missing PDF base64 data (fileBase64 or data:application/pdf URL)" },
          { status: 400 }
        );
      }

      content.push({
        type: "input_file",
        filename: resolvedFilename,
        file_data: pdfBase64, // base64 PDF bytes (no data: prefix)
      });
    } else {
      // Image path (existing behavior)
      if (!imageDataUrl || typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
        return Response.json({ ok: false, error: "Missing imageDataUrl" }, { status: 400 });
      }

      content.push({
        type: "input_image",
        image_url: imageDataUrl,
        detail: "auto",
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
      return Response.json(
        {
          ok: false,
          error: "Model returned non-JSON output",
          raw: rawText,
        },
        { status: 502 }
      );
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
    return Response.json(
      { ok: false, error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
