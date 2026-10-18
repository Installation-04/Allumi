import { buildTemplate } from "./config";

export default async function globalSetup(): Promise<void> {
  await buildTemplate();
}
