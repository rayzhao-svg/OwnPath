import { NextResponse } from "next/server";
import { generatePlan } from "@/lib/ai";
import {
  errorResponse,
  parsePlanRequest,
  readJsonBody,
} from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 75;

export async function POST(request: Request) {
  try {
    return NextResponse.json(
      await generatePlan(parsePlanRequest(await readJsonBody(request))),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
