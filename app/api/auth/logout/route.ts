import { accountCookie, accountError, accountJson, assertAccountOrigin, requireAccount, setAccountCookie } from "@/lib/account-http";
import { deleteAccountSession } from "@/lib/account-store";
import { accountsAvailable } from "@/lib/account-availability";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertAccountOrigin(request);
    if (accountsAvailable() && request.headers.has("x-ownpath-account")) requireAccount(request);
    deleteAccountSession(accountCookie(request));
    const response = accountJson({ user: null });
    setAccountCookie(response, null);
    return response;
  } catch (error) { return accountError(error); }
}
