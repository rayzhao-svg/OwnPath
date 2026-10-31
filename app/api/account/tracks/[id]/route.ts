import { accountError, accountJson, accountTrackId, readAccountJson, requireAccount, requireAccountFields } from "@/lib/account-http";
import { deleteAccountTrack, readAccountTrack, updateAccountTrack } from "@/lib/account-store";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const user = requireAccount(request), id = accountTrackId((await context.params).id);
    return accountJson({ track: readAccountTrack(user.id, id) });
  } catch (error) { return accountError(error); }
}

export async function PUT(request: Request, context: Context) {
  try {
    const user = requireAccount(request), id = accountTrackId((await context.params).id), body = await readAccountJson(request, true);
    requireAccountFields(body, ["state", "revision"]);
    return accountJson({ track: updateAccountTrack(user.id, id, body.state, body.revision) });
  } catch (error) { return accountError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const user = requireAccount(request), id = accountTrackId((await context.params).id), body = await readAccountJson(request);
    requireAccountFields(body, ["revision"]);
    deleteAccountTrack(user.id, id, body.revision);
    return accountJson({ deleted: true });
  } catch (error) { return accountError(error); }
}
