import "server-only";
import { createFormatter, createTranslator, type NamespaceKeys, type NestedKeyOf } from "use-intl/core";
import type messages from "../../../messages/fr-CA.json";
import getConfig from "./request";

type Namespace = NamespaceKeys<typeof messages, NestedKeyOf<typeof messages>>;

export async function getLocale() {
  return (await getConfig()).locale;
}

export async function getMessages() {
  return (await getConfig()).messages;
}

export async function getTranslations<N extends Namespace = never>(namespace?: N) {
  return createTranslator<typeof messages, N>({ ...await getConfig(), namespace });
}

export async function getFormatter() {
  const { locale, timeZone } = await getConfig();
  return createFormatter({ locale, timeZone });
}
