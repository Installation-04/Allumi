/**
 * The call frames of an error, without its message. `error.stack` starts with `Name: message`, and database
 * and validation errors echo input values in that message (an e-mail address, for instance): logging the
 * stack as is would defeat Law 25. The header is cut off by its exact text, and any line that is not a
 * frame ("    at ...") is dropped as a second guard.
 */
export function errorFrames(error: unknown): string {
  if (!(error instanceof Error) || typeof error.stack !== "string") return "";
  const header = `${error.name}: ${error.message}`;
  const body = error.stack.startsWith(header) ? error.stack.slice(header.length) : error.stack;
  return body
    .split("\n")
    .filter((line) => /^\s+at /.test(line))
    .join("\n");
}
