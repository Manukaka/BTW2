// Beyond Tourism World — backend (Netlify Function)
// Lives at:  https://<your-site>/.netlify/functions/btw-backend
//
// Set these in Netlify → Site configuration → Environment variables:
//   ANTHROPIC_API_KEY   sk-ant-...        (or GEMINI_API_KEY for Google's free tier)
//   ANTHROPIC_MODEL     optional, default claude-opus-5   (GEMINI_MODEL likewise, default gemini-2.0-flash)
//   CRM_ACCESS_CODE     any long secret   (the CRM sends this; keeps strangers out)
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID   (optional, auto-send)
//   SUPABASE_URL, SUPABASE_ANON_KEY            (optional; lets signed-in team members call this without the code)
//
// Tasks: ai_itinerary | ocr_passport | ocr_card | whatsapp_send

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const CRM_ACCESS_CODE = process.env.CRM_ACCESS_CODE || "";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "";
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------- auth: access code OR a valid Supabase session ----------
async function authorised(token) {
  if (!token) return false;
  if (CRM_ACCESS_CODE && token === CRM_ACCESS_CODE) return true;
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
      });
      if (r.ok) { const u = await r.json(); return !!u?.id; }
    } catch (_) {}
  }
  return false;
}

// ---------- model helpers ----------
async function claude(system, content, maxTokens = 1000) {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set in Netlify environment variables");
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
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}
async function gemini(system, parts, maxTokens = 1000) {
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
  return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("\n");
}
const llmText = (system, prompt, max) =>
  GEMINI_API_KEY ? gemini(system, [{ text: prompt }], max) : claude(system, prompt, max);
const llmImage = (system, image, mediaType, max) =>
  GEMINI_API_KEY
    ? gemini(system, [{ inlineData: { mimeType: mediaType, data: image } }, { text: "Extract the fields." }], max)
    : claude(system, [
        { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
        { type: "text", text: "Extract the fields." },
      ], max);
const stripFences = (t) => t.replace(/```json|```/g, "").trim();

// ---------- tasks ----------
const PASSPORT_SYSTEM = `You read passport photos for a travel agency. Extract fields and reply with ONLY a JSON object, no commentary:
{"fullName":"Given names + surname as printed","passportNumber":"","nationality":"","dateOfBirth":"YYYY-MM-DD","expiryDate":"YYYY-MM-DD","issueDate":"YYYY-MM-DD","sex":"","placeOfBirth":""}
Use the MRZ lines to verify the passport number, DOB and expiry when visible. Leave a field as empty string if unreadable. Never guess.`;
const CARD_SYSTEM = `You read business cards for a travel agency's vendor database. Reply with ONLY a JSON object, no commentary:
{"name":"person's name","designation":"","company":"","phone":"primary phone with country code if shown","email":"","website":"","address":"","city":""}
Leave unreadable fields as empty strings. Never invent values.`;

async function ocr(p, system) {
  if (!p?.image) throw new Error("No image supplied");
  const mediaType = /^image\/(jpeg|png|webp|gif)$/.test(p.mediaType || "") ? p.mediaType : "image/jpeg";
  const text = await llmImage(system, p.image, mediaType, 600);
  try { return { fields: JSON.parse(stripFences(text)) }; }
  catch { throw new Error("Could not parse the document"); }
}

async function whatsappSend(p) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) throw new Error("WhatsApp is not configured on the backend");
  const to = String(p.to || "").replace(/\D/g, "");
  if (!to) throw new Error("Missing recipient number");
  const body = p.template
    ? { messaging_product: "whatsapp", to, type: "template", template: p.template }
    : { messaging_product: "whatsapp", to, type: "text", text: { body: p.text || "" } };
  const r = await fetch(`https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) {
    const msg = data?.error?.message || `WhatsApp error ${r.status}`;
    throw new Error(data?.error?.code === 131047 ? "Outside the 24-hour window: " + msg : msg);
  }
  return { ok: true, id: data?.messages?.[0]?.id || null };
}

// ---------- entry ----------
export default async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!(await authorised(token))) return json({ error: "Not authorised — check the backend access code in Settings" }, 401);

    const { task, payload } = await req.json();
    switch (task) {
      case "ai_itinerary": return json({ text: await llmText(payload.system, payload.prompt, 1000) });
      case "ocr_passport": return json(await ocr(payload, PASSPORT_SYSTEM));
      case "ocr_card": return json(await ocr(payload, CARD_SYSTEM));
      case "whatsapp_send": return json(await whatsappSend(payload));
      case "ping": return json({ ok: true, ai: GEMINI_API_KEY ? "gemini" : (ANTHROPIC_API_KEY ? "anthropic" : "none"), model: GEMINI_API_KEY ? GEMINI_MODEL : (ANTHROPIC_API_KEY ? MODEL : null), whatsapp: !!(WHATSAPP_TOKEN && WHATSAPP_PHONE_NUMBER_ID) });
      default: return json({ error: `Unknown task: ${task}` }, 400);
    }
  } catch (e) {
    return json({ error: e?.message || String(e) }, 500);
  }
};

export const config = { path: "/.netlify/functions/btw-backend" };
