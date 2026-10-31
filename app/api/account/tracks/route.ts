import { accountError, accountImportKey, accountJson, readAccountJson, requireAccount, requireAccountFields } from "@/lib/account-http";
import { createAccountTrack, listAccountTracks } from "@/lib/account-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try { return accountJson({ tracks: listAccountTracks(requireAccount(request).id) }); }
  catch (error) { return accountError(error); }
}

export async function POST(request: Request) {
  try {
    const user = requireAccount(request), body = await readAccountJson(request, true);
    requireAccountFields(body, ["state"]);
    return accountJson({ track: createAccountTrack(user.id, body.state, accountImportKey(request)) }, 201);
  } catch (error) { return accountError(error); }
}
