export const runtime = "nodejs";

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

    if (!supabaseUrl) {
      return Response.json({ ok: false, error: "Missing NEXT_PUBLIC_SUPABASE_URL" }, { status: 500 });
    }

    const response = await fetch(`${supabaseUrl}/auth/v1/health`);

    if (response.status === 200) {
      return Response.json({ ok: true });
    }

    return Response.json({ ok: false, error: "Health check failed" }, { status: 500 });
  } catch (error) {
    return Response.json({ ok: false, error: "Health check failed" }, { status: 500 });
  }
}
