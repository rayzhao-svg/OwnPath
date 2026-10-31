import { NextResponse } from "next/server";
import { generateLessonResponse } from "@/lib/claude-lesson";
import {
  errorResponse,
  parseLessonRequest,
  readJsonBody,
} from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 75;

export async function POST(request: Request) {
  try {
    return NextResponse.json(
      await generateLessonResponse(parseLessonRequest(await readJsonBody(request))),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
