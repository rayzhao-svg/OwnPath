import { accountCookie, accountError, accountJson, authRequestLimit, readAccountJson, requireAccountFields, setAccountCookie } from "@/lib/account-http";
import { createAccountSession, deleteAccountSession, registerAccount } from "@/lib/account-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readAccountJson(request);
    requireAccountFields(body, ["name", "email", "password"]);
    authRequestLimit(request, "register");
    const user = await registerAccount({ name: body.name, email: body.email, password: body.password });
    const token = createAccountSession(user.id);
    deleteAccountSession(accountCookie(request));
    const response = accountJson({ user }, 201);
    setAccountCookie(response, token);
    return response;
  } catch (error) { return accountError(error); }
}
