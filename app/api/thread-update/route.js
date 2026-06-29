import { createClient } from "@supabase/supabase-js";

// Uses SERVICE ROLE KEY — bypasses RLS, consistent with the other API routes.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Continue-thread: when the user taps "↩ Continue" on a message that has no thread_id yet,
// stamp the chosen thread_id onto that ai_messages row so the chain anchors there and
// survives reloads. Kept behind an API route (not a direct browser write) for consistency.
export async function POST(req) {
  try {
    const { aiMessageId, thread_id } = await req.json();
    if (!aiMessageId || !thread_id) {
      return Response.json({ ok: false, error: "missing aiMessageId or thread_id" }, { status: 400 });
    }
    const { error } = await supabase
      .from("ai_messages")
      .update({ thread_id })
      .eq("id", aiMessageId);
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}