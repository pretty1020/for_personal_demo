import { assistantStatus, jsonResponse } from "@/lib/assistant-openai";

export const runtime = "nodejs";

export async function GET() {
  try {
    const assistant = assistantStatus();
    return jsonResponse(200, { ok: assistant.openaiConfigured, assistant });
  } catch (error) {
    console.error("Assistant health check failed:", error);
    return jsonResponse(500, {
      ok: false,
      error: "Assistant health check failed.",
      code: "health_error",
      assistant: { openaiConfigured: false, model: "gpt-4o-mini" },
    });
  }
}
