"use client";
import { useState } from "react";
import PromptBox from "@/components/PromptBox";
import { buildMenuPrompt } from "@/lib/buildPrompt";

export default function MenuPage() {
  const [theme, setTheme] = useState("");
  const [prompt, setPrompt] = useState("");

  const generer = () => {
    setPrompt(buildMenuPrompt(theme));
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--green-dark)" }}>
        📅 Menu de la semaine
      </h1>
      <p className="text-sm mb-6" style={{ color: "#7A9A8A" }}>
        7 dîners diététiques · de saison · avec ingrédients et mesures
      </p>

      {/* Formulaire */}
      <div className="rounded-2xl border p-6 mb-6" style={{ background: "white", borderColor: "#E0E8E4" }}>
        <label className="block text-sm font-medium mb-2" style={{ color: "var(--green-dark)" }}>
          Thème ou contrainte de la semaine{" "}
          <span style={{ color: "#7A9A8A" }}>(optionnel)</span>
        </label>
        <input
          type="text"
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && generer()}
          placeholder="Ex : légumes d'hiver, repas légers, sans gluten..."
          className="w-full border rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 mb-4"
          style={{ borderColor: "#C8DDD6", background: "var(--green-light)" }}
        />
        <button
          onClick={generer}
          className="px-6 py-3 rounded-xl font-medium text-white text-sm transition hover:opacity-90"
          style={{ background: "var(--green)" }}
        >
          ✨ Générer le prompt
        </button>
      </div>

      {/* Prompt généré */}
      {prompt && <PromptBox prompt={prompt} />}

      {/* Lien vers l'image */}
      <div className="mt-6 pt-6 border-t" style={{ borderColor: "#E0E8E4" }}>
        <a
          href="/menu/image"
          className="flex items-center gap-3 rounded-2xl border p-4 transition hover:opacity-80"
          style={{ background: "white", borderColor: "#E0E8E4", textDecoration: "none" }}
        >
          <span className="text-2xl">🖼️</span>
          <div>
            <div className="font-semibold text-sm" style={{ color: "var(--green-dark)" }}>
              Générer l'image Instagram du menu
            </div>
            <div className="text-xs mt-0.5" style={{ color: "#7A9A8A" }}>
              Crée une image carrée prête à poster
            </div>
          </div>
          <span className="ml-auto text-sm" style={{ color: "#7A9A8A" }}>→</span>
        </a>
      </div>
    </div>
  );
}
