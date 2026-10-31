import { NextResponse } from "next/server";
import { answerQuestion } from "@/lib/ai";
import {
  errorResponse,
  parseChatRequest,
  readJsonBody,
} from "@/lib/validation";

export async function POST(request: Request) {
  try {
    return NextResponse.json(
      await answerQuestion(parseChatRequest(await readJsonBody(request))),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
