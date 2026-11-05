export type UpdateStatusDetails = {
  state: "disabled" | "ready" | "pending" | "running" | "success" | "failed";
  stage?: "validating" | "backup" | "installing" | "complete";
  target?: string;
  fromVersion?: string;
  requestedAt?: string;
  updatedAt?: string;
  requestId?: string;
  failureCode?: "validation" | "backup" | "installation" | "unknown";
};
