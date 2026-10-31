import { NextResponse } from "next/server";
import type { ApiError } from "@/lib/types";
import { ApiFailure } from "@/lib/validators";

// Keep route imports stable while pure assertions remain safe in browser code.
export * from "@/lib/validators";
export const MAX_BODY_BYTES = 64 * 1024;

/** Bound actual streamed bytes rather than trusting Content-Length. */
export async function readJsonBody(request: Request): Promise<unknown> {
  const declaredSize = Number(request.headers.get("content-length"));
  if (declaredSize > MAX_BODY_BYTES)
    throw new ApiFailure(
      "PAYLOAD_TOO_LARGE",
      "Request body must be at most 64 KiB.",
      413,
    );
  if (!request.body)
    throw new ApiFailure(
      "INVALID_JSON",
      "Request body must contain valid JSON.",
    );
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new ApiFailure(
          "PAYLOAD_TOO_LARGE",
          "Request body must be at most 64 KiB.",
          413,
        );
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new ApiFailure(
      "INVALID_JSON",
      "Request body must contain valid JSON.",
    );
  }
}

export function errorResponse(error: unknown): NextResponse<ApiError> {
  if (error instanceof ApiFailure)
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  console.error(
    "OwnPath mock API failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong. Please try again.",
      },
    },
    { status: 500 },
  );
}
