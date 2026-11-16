import { errorResponse, internalErrorResponse } from "@/lib/api/errors";
import { authenticate } from "@/lib/auth/accounts";
import { rateLimitedResponse, readJsonBody, signedInResponse } from "@/lib/auth/http";
import { clientIp, loginAttemptKey } from "@/lib/auth/rateLimit";
import { authRateLimit, refundAuthRateLimit } from "@/lib/auth/sharedRateLimit";
import { createSession } from "@/lib/auth/session";
import { parseLogin } from "@/lib/auth/validation";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/auth/login { email, password }
// Signs in any role. Unknown emails, wrong passwords, and disabled accounts
// all return the same 401. Public, rate-limited per IP and per email.
export async function POST(request: Request) {
  try {
    const db = createAdminClient();
    const ip = clientIp(request);
    const ipLimit = await authRateLimit(db, "login-ip", ip);
    if (!ipLimit.ok) return rateLimitedResponse(ipLimit.retryAfterSeconds);

    const json = await readJsonBody(request);
    if (!json.ok) return json.response;
    const input = parseLogin(json.body);
    if (!input.ok) return errorResponse(400, "VALIDATION_ERROR", input.message);

    const attemptKey = loginAttemptKey(input.value.email, ip);
    const emailLimit = await authRateLimit(db, "login-pair", attemptKey);
    if (!emailLimit.ok) return rateLimitedResponse(emailLimit.retryAfterSeconds);

    const accountLimit = await authRateLimit(db, "login-account", input.value.email);
    if (!accountLimit.ok) return rateLimitedResponse(accountLimit.retryAfterSeconds);

    const user = await authenticate(db, input.value);
    if (!user) return errorResponse(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");

    // Only failures count: a successful login gives its attempts back.
    await Promise.all([
      refundAuthRateLimit(db, "login-pair", attemptKey),
      refundAuthRateLimit(db, "login-ip", ip),
      refundAuthRateLimit(db, "login-account", input.value.email),
    ]);
    return signedInResponse(user, await createSession(db, user.id), 200);
  } catch (err) {
    return internalErrorResponse(err);
  }
}
