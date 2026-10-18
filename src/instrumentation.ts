export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertStartup } = await import("./platform/startup");
    await assertStartup();
  }
}
