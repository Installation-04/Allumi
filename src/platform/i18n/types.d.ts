import type messages from "../../../messages/fr-CA.json";
import type { Locale } from "./locales";

declare module "use-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
