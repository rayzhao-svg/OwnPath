import { accountCookie, accountError, accountJson, authRequestLimit, readAccountJson, requireAccountFields, setAccountCookie } from "@/lib/account-http";
import { authenticateAccount, createAccountSession, deleteAccountSession } from "@/lib/account-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readAccountJson(request);
    requireAccountFields(body, ["email", "password"]);
    authRequestLimit(request, "login");
    const user = await authenticateAccount({ email: body.email, password: body.password });
    const token = createAccountSession(user.id);
    deleteAccountSession(accountCookie(request));
    const response = accountJson({ user });
    setAccountCookie(response, token);
    return response;
  } catch (error) { return accountError(error); }
}
