"use client";

// Public React/ICU runtime only; no extraction plugin or filesystem watcher in the dependency tree.
export { IntlProvider as TranslationProvider, useLocale, useTranslations } from "use-intl";
