import React from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider, useAuth } from "../../../src/contexts/AuthContext";
import { SnowPage } from "../../../src/modules/snow/SnowPage";
import "../../../src/index.css";
function QA() {
  const { user, loading } = useAuth();
  if (!import.meta.env.DEV) throw Error("Only isolated development QA");
  if (loading) return <p>Hämtar lokal testprofil…</p>;
  if (!user) return <p>Testprofil saknas.</p>;
  return (
    <>
      <p className="px-6 pt-3 text-sm text-slate-500">
        Isolerad testdatabas · inga produktionsanrop
      </p>
      <SnowPage />
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <AuthProvider>
    <QA />
  </AuthProvider>,
);
