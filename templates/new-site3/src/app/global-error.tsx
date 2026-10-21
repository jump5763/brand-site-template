"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#ffffff",
          color: "#111827",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <main
          style={{
            boxSizing: "border-box",
            display: "grid",
            minHeight: "100vh",
            placeContent: "center",
            padding: "24px",
            textAlign: "center",
          }}
        >
          <div style={{ maxWidth: "28rem" }}>
            <h1 style={{ margin: 0, fontSize: "1.5rem", lineHeight: 1.3 }}>
              Something went wrong
            </h1>
            <p style={{ margin: "12px 0 0", color: "#4b5563", lineHeight: 1.6 }}>
              The site could not be loaded. Try again.
            </p>
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: "24px",
                border: 0,
                borderRadius: "6px",
                padding: "10px 16px",
                background: "#111827",
                color: "#ffffff",
                font: "inherit",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
