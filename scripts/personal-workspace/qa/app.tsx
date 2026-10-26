import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider, useAuth } from "../../../src/contexts/AuthContext";
import { Layout } from "../../../src/components/Layout";
import { WorkspacePage } from "../../../src/modules/personal-workspace/WorkspacePage";
import "../../../src/index.css";
export function WorkspaceQA() {
  const { user, loading } = useAuth();
  const [path, setPath] = useState("personal-workspace");
  if (!import.meta.env.DEV)
    throw Error("QA-vyn får bara köras lokalt i utvecklingsläge.");
  if (loading) return <p>Hämtar QA-session…</p>;
  if (!user)
    return <p>QA-session saknas. Kontrollera den isolerade testdatabasen.</p>;
  return (
    <Layout currentPage={path} onNavigate={setPath}>
      {path.startsWith("personal-workspace") ? (
        <WorkspacePage path={path} onNavigate={setPath} />
      ) : (
        <button onClick={() => setPath("personal-workspace")}>
          Återgå till arbetsytan (lokalt navigationsprov)
        </button>
      )}
    </Layout>
  );
}
createRoot(document.getElementById("root")!).render(
  <AuthProvider>
    <WorkspaceQA />
  </AuthProvider>,
);
