import { NextResponse } from "next/server";
import { generateTutorResponse } from "@/lib/claude-tutor";
import {
  errorResponse,
  parseChatRequest,
  readJsonBody,
} from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    return NextResponse.json(
      await generateTutorResponse(parseChatRequest(await readJsonBody(request))),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
