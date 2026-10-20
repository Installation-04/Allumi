"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { isTheme } from "@/app/_lib/theme";

export async function setTheme(form: FormData): Promise<void> {
  const theme = form.get("theme");
  if (!isTheme(theme)) return;
  (await cookies()).set("allumi_theme", theme, { path: "/", maxAge: 365 * 24 * 60 * 60, sameSite: "lax", httpOnly: true });
  revalidatePath("/", "layout");
}
