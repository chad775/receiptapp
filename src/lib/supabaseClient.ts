import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  const missing = [];
  if (!supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!supabaseAnonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  
  throw new Error(
    `Missing Supabase environment variables: ${missing.join(", ")}. ` +
    `Please create a .env.local file in the project root with:\n` +
    `NEXT_PUBLIC_SUPABASE_URL=your_supabase_url\n` +
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key\n` +
    `Then restart your dev server.`
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
