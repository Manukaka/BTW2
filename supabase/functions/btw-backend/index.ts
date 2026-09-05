// Beyond Tourism World — backend function
// Deploy:  supabase functions deploy btw-backend
// Secrets: supabase secrets set GEMINI_API_KEY=...   (free tier)   — OR —   ANTHROPIC_API_KEY=sk-ant-...
//          supabase secrets set WHATSAPP_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=...   (optional, for auto-send)
//
// Every request must carry a signed-in team member's JWT (the CRM sends it automatically).
// Tasks: ai_itinerary | ocr_passport | ocr_card | whatsapp_send

import { createClient } from "npm:@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";       // free tier at aistudio.google.com
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.0-flash";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-opus-5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------- Anthropic helper ----------
async function claude(system: string, content: unknown, maxTokens = 1000): Promise<string> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "server-side-fallback-2026-07-01", // if the model declines, Anthropic retries on a fallback model
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content }], fallbacks: "default" }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `Anthropic error ${r.status}`);
  if (data.stop_reason === "refusal") throw new Error("The AI declined this request");
  return (data.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n");
}
const stripFences = (t: string) => t.replace(/```json|```/g, "").trim();

// ---------- Gemini helper (used when GEMINI_API_KEY is set; free tier) ----------
type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
async function gemini(system: string, parts: Part[], maxTokens = 1000): Promise<string> {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 },
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `Gemini error ${r.status}`);
  return (data.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("\n");
}

// Picks Gemini if configured (free), otherwise Anthropic.
async function llmText(system: string, prompt: string, maxTokens = 1000) {
  if (GEMINI_API_KEY) return gemini(system, [{ text: prompt }], maxTokens);
  return claude(system, prompt, maxTokens);
}
async function llmImage(system: string, image: string, mediaType: string, maxTokens = 600) {
  if (GEMINI_API_KEY) return gemini(system, [{ inlineData: { mimeType: mediaType, data: image } }, { text: "Extract the fields." }], maxTokens);
  return claude(system, [
    { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
    { type: "text", text: "Extract the fields." },
  ], maxTokens);
}

// ---------- tasks ----------
async function aiItinerary(p: { system: string; prompt: string }) {
  const text = await llmText(p.system, p.prompt, 1000);
  return { text };
}

const PASSPORT_SYSTEM = `You read passport photos for a travel agency. Extract fields and reply with ONLY a JSON object, no commentary:
{"fullName":"Given names + surname as printed","passportNumber":"","nationality":"","dateOfBirth":"YYYY-MM-DD","expiryDate":"YYYY-MM-DD","issueDate":"YYYY-MM-DD","sex":"","placeOfBirth":""}
Use the MRZ lines to verify the passport number, DOB and expiry when visible. Leave a field as empty string if unreadable. Never guess.`;

const CARD_SYSTEM = `You read business cards for a travel agency's vendor database. Reply with ONLY a JSON object, no commentary:
{"name":"person's name","designation":"","company":"","phone":"primary phone with country code if shown","email":"","website":"","address":"","city":""}
Leave unreadable fields as empty strings. Never invent values.`;

async function ocr(p: { image: string; mediaType?: string }, system: string) {
  if (!p?.image) throw new Error("No image supplied");
  const mediaType = p.mediaType && /^image\/(jpeg|png|webp|gif)$/.test(p.mediaType) ? p.mediaType : "image/jpeg";
  const text = await llmImage(system, p.image, mediaType, 600);
  let fields = {};
  try { fields = JSON.parse(stripFences(text)); } catch { throw new Error("Could not parse the document"); }
  return { fields };
}

// WhatsApp Cloud API (Meta). Free-form text only works inside the 24-hour customer window;
// for first-contact messages pass { template: { name, language, components } } instead of text.
async function whatsappSend(p: { to: string; text?: string; template?: unknown }) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) throw new Error("WhatsApp is not configured on the backend");
  const to = String(p.to || "").replace(/\D/g, "");
  if (!to) throw new Error("Missing recipient number");
  const body = p.template
    ? { messaging_product: "whatsapp", to, type: "template", template: p.template }
    : { messaging_product: "whatsapp", to, type: "text", text: { body: p.text ?? "" } };
  const r = await fetch(`https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) {
    const msg = data?.error?.message || `WhatsApp error ${r.status}`;
    // 131047 = re-engagement required (outside 24h window)
    throw new Error(data?.error?.code === 131047 ? "Outside the 24-hour window: " + msg : msg);
  }
  return { ok: true, id: data?.messages?.[0]?.id ?? null };
}

// ---------- entry ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    // Only signed-in team members may use the backend
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: "Not signed in" }, 401);

    const { task, payload } = await req.json();
    switch (task) {
      case "ai_itinerary": return json(await aiItinerary(payload));
      case "ocr_passport": return json(await ocr(payload, PASSPORT_SYSTEM));
      case "ocr_card": return json(await ocr(payload, CARD_SYSTEM));
      case "whatsapp_send": return json(await whatsappSend(payload));
      case "ping": return json({ ok: true, ai: GEMINI_API_KEY ? "gemini" : (ANTHROPIC_API_KEY ? "anthropic" : "none"), whatsapp: !!(WHATSAPP_TOKEN && WHATSAPP_PHONE_NUMBER_ID) });
      default: return json({ error: `Unknown task: ${task}` }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error)?.message ?? String(e) }, 500);
  }
});
