import OpenAI from "openai";
import * as pdfjsLib from "pdfjs-dist";
import { createCanvas } from "canvas";

export const runtime = "nodejs";

// Configure PDF.js worker - use disableWorker to avoid issues in serverless
// In production, you may need to serve the worker file or use a different approach
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
} catch (e) {
  // Fallback if worker fails
  console.warn("PDF.js worker configuration warning:", e);
}

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

async function pdfToImageDataUrl(pdfDataUrl: string): Promise<string> {
  try {
    // Extract base64 data from data URL
    const base64Data = pdfDataUrl.split(",")[1];
    const pdfBuffer = Buffer.from(base64Data, "base64");

    // Load PDF document
    const loadingTask = pdfjsLib.getDocument({ data: pdfBuffer });
    const pdf = await loadingTask.promise;

    // Get first page (for receipts, usually just one page)
    const page = await pdf.getPage(1);

    // Render page to canvas
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext("2d");

    await page.render({
      canvasContext: context as any,
      viewport: viewport,
    }).promise;

    // Convert canvas to base64 image
    const imageDataUrl = canvas.toDataURL("image/png");
    return imageDataUrl;
  } catch (error) {
    throw new Error(`Failed to convert PDF to image: ${error instanceof Error ? error.message : String(error)}`);
  }
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

    // Convert PDF to image if needed
    let processedImageDataUrl = imageDataUrl;
    if (imageDataUrl.startsWith("data:application/pdf")) {
      try {
        processedImageDataUrl = await pdfToImageDataUrl(imageDataUrl);
      } catch (pdfError) {
        return Response.json({ 
          ok: false, 
          error: `Failed to process PDF: ${pdfError instanceof Error ? pdfError.message : String(pdfError)}` 
        }, { status: 400 });
      }
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
                "Extract bookkeeping fields from this receipt image. " +
                "Return vendor, receipt_date (YYYY-MM-DD), total (number), currency (e.g. USD), " +
                "category_suggested (e.g. Meals, Fuel, Office Supplies, Travel, Repairs), " +
                "and confidence (0 to 1). If missing, use null. Do not guess wildly."
            },
            {
              type: "input_image",
              image_url: processedImageDataUrl,
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