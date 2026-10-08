import { assistantStatus, callOpenAiChat, jsonResponse, trimContext } from "@/lib/assistant-openai";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatMessage = { role: "user" | "assistant"; content: string };

type ChatBody = {
  messages?: ChatMessage[];
  context?: string;
  page?: string;
  executiveName?: string;
  auth?: { accessLevel?: string; aiAssistantApproved?: boolean };
};

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return jsonResponse(503, {
        error: "OPENAI_API_KEY is not set on the server. Add it in Vercel → Settings → Environment Variables, then redeploy.",
        code: "missing_openai_key",
        assistant: assistantStatus(),
      });
    }

    let body: ChatBody;
    try {
      body = (await request.json()) as ChatBody;
    } catch {
      return jsonResponse(400, { error: "Request body must be valid JSON.", code: "invalid_json" });
    }

    const allowed = body.auth?.accessLevel === "executive" || body.auth?.aiAssistantApproved === true;
    if (!allowed) {
      return jsonResponse(403, {
        error: "AI Assistant is available to executives or admin-approved users only.",
        code: "forbidden",
      });
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const context = typeof body.context === "string" ? body.context : "";
    if (!context.trim()) {
      return jsonResponse(400, { error: "App context is required.", code: "missing_context" });
    }
    if (!messages.length || messages[messages.length - 1]?.role !== "user") {
      return jsonResponse(400, { error: "Include at least one user message.", code: "invalid_messages" });
    }

    const pageNote = body.page ? `\n\nUser is currently viewing: ${body.page}` : "";
    const reply = await callOpenAiChat(apiKey, trimContext(`${context}${pageNote}`), messages, {
      executiveName: body.executiveName,
      page: body.page,
    });
    return jsonResponse(200, { reply });
  } catch (error) {
    console.error("Assistant chat handler failed:", error);
    const message = error instanceof Error ? error.message : "Assistant handler failed unexpectedly.";
    return jsonResponse(500, {
      error: message,
      code: "handler_error",
      assistant: assistantStatus(),
    });
  }
}
