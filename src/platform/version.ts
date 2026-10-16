import packageJson from "../../package.json" with { type: "json" };

/** Version shown in /api/health and in the UI: APP_VERSION (set by the Docker image), else package.json. */
export function appVersion(): string {
  const fromImage = process.env.APP_VERSION;
  return fromImage && fromImage !== "dev" ? fromImage : packageJson.version;
}
