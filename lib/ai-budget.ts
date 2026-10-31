/** A cold structured-output schema needs time to compile before generation. */
export const AI_REQUEST_TIMEOUT_MS = 60_000;
export const AI_DETAIL_TIMEOUT_MS = 75_000;
// Include development route compilation and response validation in the browser.
export const AI_CLIENT_TIMEOUT_MS = AI_REQUEST_TIMEOUT_MS + 15_000;
export const AI_DETAIL_CLIENT_TIMEOUT_MS = AI_DETAIL_TIMEOUT_MS + 15_000;
