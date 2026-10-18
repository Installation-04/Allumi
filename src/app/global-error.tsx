"use client";

/**
 * Last resort, when the root layout itself failed: no translation provider exists here, so the message
 * is given in both languages.
 */
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="fr-CA">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
        <h1>Une erreur est survenue / Something went wrong</h1>
        <button type="button" onClick={() => retry()}>
          Réessayer / Try again
        </button>
      </body>
    </html>
  );
}
