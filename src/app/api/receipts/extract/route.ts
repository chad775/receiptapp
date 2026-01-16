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

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const imageDataUrl = body?.imageDataUrl;

    if (!process.env.OPENAI_API_KEY) {
      return Response.json({ ok: false, error: "Missing OPENAI_API_KEY in env" }, { status: 500 });
    }
    if (!imageDataUrl || typeof imageDataUrl !== "string") {
      return Response.json({ ok: false, error: "Missing imageDataUrl" }, { status: 400 });
    }
    if (!imageDataUrl.startsWith("data:image/") && !imageDataUrl.startsWith("data:application/pdf")) {
      return Response.json({ ok: false, error: "imageDataUrl must be a data:image/... or data:application/pdf base64 data URL" }, { status: 400 });
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
        confidence: { anyOf: [{ type: "number" }, { type: "null" }] }
      },
      required: ["vendor", "receipt_date", "total", "currency", "category_suggested", "confidence"]
    } as const;

    const response = await client.responses.create({
      model: model,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Extract bookkeeping fields from this receipt image or PDF. " +
                "Return vendor, receipt_date (YYYY-MM-DD), total (number), currency (e.g. USD), " +
                "category_suggested (e.g. Meals, Fuel, Office Supplies, Travel, Repairs), " +
                "and confidence (0 to 1). If missing, use null. Do not guess wildly."
            },
            imageDataUrl.startsWith("data:application/pdf") 
              ? {
                  type: "input_file",
                  file_url: imageDataUrl
                }
              : {
                  type: "input_image",
                  image_url: imageDataUrl,
                  detail: "auto"
                }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "receipt_extract_v1",
          strict: true,
          schema: schema
        }
      }
    });

    const rawText = response.output_text || "";
    const parsed = JSON.parse(rawText) as ExtractResult;

    if (typeof parsed.confidence === "number") {
      parsed.confidence = clamp(parsed.confidence, 0, 1);
    }

    return Response.json({
      ok: true,
      model_used: model,
      result: parsed
    });
  } catch (err: any) {
    return Response.json({ ok: false, error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}