import { accountCookie, accountError, accountJson } from "@/lib/account-http";
import { findAccountSession } from "@/lib/account-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try { return accountJson({ user: findAccountSession(accountCookie(request)) }); }
  catch (error) { return accountError(error); }
}
