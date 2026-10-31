import { NextResponse } from "next/server";
import { generatePlan } from "@/lib/ai";
import {
  errorResponse,
  parsePlanRequest,
  readJsonBody,
} from "@/lib/validation";

export async function POST(request: Request) {
  try {
    return NextResponse.json(
      await generatePlan(parsePlanRequest(await readJsonBody(request))),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
