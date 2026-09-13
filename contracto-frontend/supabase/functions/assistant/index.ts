// ============================================================
// CONTRALABOS — AI ASSISTANT EDGE FUNCTION
// ------------------------------------------------------------
// Deploy with: supabase functions deploy assistant
// Then set one provider secret (never put this in frontend code):
//   supabase secrets set GEMINI_API_KEY=your-google-ai-studio-key
// Anthropic remains supported with ANTHROPIC_API_KEY if preferred.
//
// This runs on Supabase's free Edge Functions tier (Deno runtime).
// If ANTHROPIC_API_KEY isn't set, it returns a clear "not connected"
// stub instead of erroring, so the chatbot UI degrades gracefully.
// ============================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const LANG_NAMES: Record<string,string> = { en: "English", hi: "Hindi", mr: "Marathi" };

const SYSTEM_PROMPT = `You are a helpful, professional general-purpose assistant inside Contralabos.
Answer questions across everyday topics, learning, writing, planning, technology, and general
knowledge. You are especially useful for Contralabos and construction management topics such as
projects, workers, attendance, wages, materials, budgets, and requests. Use the supplied live app
context for account-specific questions, and never invent account data. Be concise but useful,
explain steps clearly, ask a short clarifying question when needed, and acknowledge uncertainty
when a fact may be current or location-dependent. Follow normal safety guidelines and do not help
with harmful or illegal activity.`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if(req.method === "OPTIONS"){
    return new Response("ok", { headers: corsHeaders });
  }

  try{
    const { text, lang = "en", history = [], context = null } = await req.json();

    if(!text || typeof text !== "string" || text.length > 2000){
      return new Response(JSON.stringify({ error: "Message text is required (max 2000 characters)." }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
    }
    const safeHistory = Array.isArray(history) ? history
      .filter((item: any) => item && (item.role === "user" || item.role === "model") && typeof item.text === "string")
      .slice(-10)
      .map((item: any) => ({ role: item.role, text: item.text.slice(0, 2000) })) : [];

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    const configuredAnthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    const anthropicKey = configuredAnthropicKey && !configuredAnthropicKey.includes("your-real-key")
      ? configuredAnthropicKey
      : null;
    if(!geminiKey && !anthropicKey){
      return new Response(JSON.stringify({
        reply: null,
        stub: true,
        note: "No AI provider is configured. Set GEMINI_API_KEY or ANTHROPIC_API_KEY in Supabase secrets.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
    }

    const langInstruction = lang === "mr"
      ? " Respond entirely in Marathi using Devanagari script. Do not switch to English unless a product name, URL, code, or database field must remain unchanged."
      : lang === "hi"
        ? " Respond entirely in Hindi using Devanagari script. Do not switch to English unless a product name, URL, code, or database field must remain unchanged."
        : lang !== "en" ? ` Respond entirely in ${LANG_NAMES[lang] || lang}.` : "";
    const contextInstruction = context && typeof context === "object"
      ? `\nThe signed-in user currently has this live application context: ${JSON.stringify(context).slice(0, 6000)}. Use it when answering count or status questions. If the context does not contain the requested information, say so. Do not invent data.`
      : "";

    if(geminiKey){
      const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
      const requestBody = {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT + langInstruction + contextInstruction }] },
        contents: [...safeHistory.map((item: any) => ({ role: item.role, parts: [{ text: item.text }] })), { role: "user", parts: [{ text }] }],
        generationConfig: { maxOutputTokens: 400 },
      };
      const callGemini = (requestedModel: string) => fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:generateContent?key=${encodeURIComponent(geminiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
      let geminiRes = await callGemini(model);
      if((geminiRes.status === 400 || geminiRes.status === 404) && model !== "gemini-2.5-flash"){
        geminiRes = await callGemini("gemini-2.5-flash");
      }
      if(!geminiRes.ok){
        const errText = await geminiRes.text();
        console.error("Gemini API error:", geminiRes.status, errText);
        const providerMessage = geminiRes.status === 401 || geminiRes.status === 403
          ? "Gemini rejected the API key. Check that it is a valid Google AI Studio key."
          : geminiRes.status === 429
            ? "Gemini quota or rate limit reached. Check the Google AI Studio quota for this key."
            : geminiRes.status === 400 || geminiRes.status === 404
              ? `Gemini model '${model}' is unavailable for this key.`
              : "Gemini rejected the request. Check the API key, model, and quota.";
        return new Response(JSON.stringify({ error: providerMessage, providerStatus: geminiRes.status }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
      }
      const data = await geminiRes.json();
      const reply = data.candidates?.[0]?.content?.parts?.map((part: any) => part.text || "").join("\n").trim();
      if(!reply) throw new Error("Gemini returned no text response.");
      return new Response(JSON.stringify({ reply, stub: false, provider: "gemini" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
    }

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-6",
        max_tokens: 400,
        system: SYSTEM_PROMPT + langInstruction + contextInstruction,
        messages: [...safeHistory.map((item: any) => ({ role: item.role === "model" ? "assistant" : "user", content: item.text })), { role: "user", content: text }],
      }),
    });

    if(!anthropicRes.ok){
      const errText = await anthropicRes.text();
      console.error("Anthropic API error:", anthropicRes.status, errText);
      return new Response(JSON.stringify({ error: "The assistant is temporarily unavailable." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
    }

    const data = await anthropicRes.json();
    const reply = data.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");

    return new Response(JSON.stringify({ reply, stub: false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });

  }catch(err){
    console.error(err);
    return new Response(JSON.stringify({ error: "Something went wrong." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
  }
});
