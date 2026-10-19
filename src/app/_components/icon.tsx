export type IconName = "overview" | "journal" | "accounts" | "trial" | "fiscal" | "audit" | "plus" | "arrow";

const paths: Record<IconName, string> = {
  overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  journal: "M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h5",
  accounts: "M3 20h18 M5 20V10 M10 20V10 M14 20V10 M19 20V10 M3 7l9-4 9 4v3H3z",
  trial: "M4 20V10 M10 20V4 M16 20v-7 M22 20H2",
  fiscal: "M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h2 M14 14h2",
  audit: "M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6",
  plus: "M12 5v14 M5 12h14",
  arrow: "M5 12h14 M14 7l5 5-5 5",
};

/** Original, decorative line icons; the adjacent text supplies the accessible name. */
export function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><path d={paths[name]} /></svg>;
}
