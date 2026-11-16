import { errorResponse, internalErrorResponse } from "@/lib/api/errors";
import { registerCustomer } from "@/lib/auth/accounts";
import { rateLimitedResponse, readJsonBody, signedInResponse } from "@/lib/auth/http";
import { clientIp } from "@/lib/auth/rateLimit";
import { authRateLimit } from "@/lib/auth/sharedRateLimit";
import { createSession } from "@/lib/auth/session";
import { parseRegistration } from "@/lib/auth/validation";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/auth/register { email, password }
// Creates a CUSTOMER account and signs it in. Any role in the body is ignored:
// only customers self-register. Public, rate-limited per IP.
export async function POST(request: Request) {
  try {
    const db = createAdminClient();
    const limit = await authRateLimit(db, "register-ip", clientIp(request));
    if (!limit.ok) return rateLimitedResponse(limit.retryAfterSeconds);

    const json = await readJsonBody(request);
    if (!json.ok) return json.response;
    const input = parseRegistration(json.body);
    if (!input.ok) return errorResponse(400, "VALIDATION_ERROR", input.message);

    const result = await registerCustomer(db, input.value);
    if (!result.ok) {
      return errorResponse(409, "EMAIL_TAKEN", "An account with this email already exists. Log in instead.");
    }
    return signedInResponse(result.user, await createSession(db, result.user.id), 201);
  } catch (err) {
    return internalErrorResponse(err);
  }
}
