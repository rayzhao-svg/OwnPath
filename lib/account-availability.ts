import "server-only";

/** Local SQLite accounts require a durable disk, which Vercel functions lack. */
export function accountsAvailable(): boolean {
  return process.env.VERCEL !== "1";
}
