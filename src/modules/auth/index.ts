export { attemptLogin, type LoginResult } from "./service/login";
export {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  disableTotp,
  pendingTotpEnrollment,
  totpStatus,
  verifySecondFactor,
  completeMfaSignIn,
  type EnrollmentResult,
  type MfaResult,
} from "./service/mfa";
export {
  changePassword,
  listSessions,
  revokeOtherSessions,
  revokeSession,
  type PasswordChangeResult,
  type SessionSummary,
} from "./service/account";
export { createSession, destroySession, resolveSession, type SessionInfo } from "./service/session";
export { isSetUp, currentSetupGate, setupInstance, type SetupResult } from "./service/setup";
export { clientIpFromForwardedFor } from "./domain/client-ip";
export type { SetupGate } from "./domain/setup-gate";
export { codeSchema, loginSchema, setupSchema } from "./domain/schemas";
export { PASSWORD_MIN_LENGTH, type PasswordProblem } from "./domain/password";
export { SESSION_ABSOLUTE_MS } from "./domain/policy";
export { getProfile, type Profile } from "./service/profile";

export { newToken, sha256Hex } from "./service/crypto";
export { acceptInvitation } from "./service/invitation";
