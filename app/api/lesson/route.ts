import { NextResponse } from "next/server";
import { generateLesson } from "@/lib/ai";
import {
  errorResponse,
  parseLessonRequest,
  readJsonBody,
} from "@/lib/validation";

export async function POST(request: Request) {
  try {
    return NextResponse.json(
      await generateLesson(parseLessonRequest(await readJsonBody(request))),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
