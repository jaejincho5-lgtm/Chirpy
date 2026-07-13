"use client";

// /backend/login — the only /backend path proxy.ts leaves open. Posts the
// password to /api/backend-login; on success the HttpOnly ops cookie is set
// and we bounce to the originally requested module (validated to stay inside
// /backend so the ?next param can't be turned into an open redirect).

import { useState, type FormEvent } from "react";
import { KfcMark } from "../../demo-shared";

export default function BackendLoginPage() {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "wrong">("idle");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (status === "checking" || !password) return;
    setStatus("checking");
    try {
      const res = await fetch("/api/backend-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setStatus("wrong");
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.assign(next && next.startsWith("/backend") ? next : "/backend");
    } catch {
      setStatus("wrong");
    }
  }

  return (
    <main className="ops-login">
      <form className="ops-login__card" onSubmit={submit}>
        <div className="ops-login__brand">
          <KfcMark />
          <div>
            <h1>Operations area</h1>
            <p>Enter the password to open the console</p>
            <p className="ops-login__hint">
              Password: <code>letmein</code>
            </p>
          </div>
        </div>
        <input
          type="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            if (status === "wrong") setStatus("idle");
          }}
          placeholder="Password"
          autoFocus
          autoComplete="current-password"
          aria-label="Console password"
          aria-invalid={status === "wrong"}
        />
        {status === "wrong" && (
          <p className="ops-login__error" role="alert">
            Wrong password. Try again.
          </p>
        )}
        <button type="submit" disabled={status === "checking" || !password}>
          {status === "checking" ? "Checking..." : "Open console"}
        </button>
      </form>
    </main>
  );
}
