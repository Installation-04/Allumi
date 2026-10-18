"use server";

import { revalidatePath } from "next/cache";
import { setLocaleCookie } from "@/app/_lib/locale-cookie";
import { isLocale } from "@/platform/i18n/locales";

export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  await setLocaleCookie(locale);
  revalidatePath("/", "layout");
}
