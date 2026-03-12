"use client";
import { useState } from "react";
import PromptBox from "@/components/PromptBox";
import { buildConseilPrompt } from "@/lib/buildPrompt";

const THEMES_SUGGERES = [
  "Rééquilibrage alimentaire",
  "Vitamines et énergie",
  "Gestion des fringales",
  "Protéines au quotidien",
  "Hydratation",
  "Sucres cachés",
  "Alimentation anti-inflammatoire",
  "Nutrition sportive",
  "Beauté par l'alimentation",
  "Saisonnalité des aliments",
  "Diabète et alimentation",
  "Post-chirurgie bariatrique",
];

export default function ConseilPage() {
  const [theme, setTheme] = useState("");
  const [prompt, setPrompt] = useState("");

  const generer = (themeChoisi?: string) => {
    setPrompt(buildConseilPrompt(themeChoisi ?? theme));
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--green-dark)" }}>
        💡 Conseil diététique
      </h1>
      <p className="text-sm mb-6" style={{ color: "#7A9A8A" }}>
        Post conseil · lundi, mercredi, vendredi
      </p>

      {/* Formulaire */}
      <div className="rounded-2xl border p-6 mb-6" style={{ background: "white", borderColor: "#E0E8E4" }}>
        <label className="block text-sm font-medium mb-2" style={{ color: "var(--green-dark)" }}>
          Thème du conseil{" "}
          <span style={{ color: "#7A9A8A" }}>(optionnel — laissez vide pour un choix automatique)</span>
        </label>
        <input
          type="text"
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && generer()}
          placeholder="Ex : les protéines végétales, gestion des fringales..."
          className="w-full border rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 mb-3"
          style={{ borderColor: "#C8DDD6", background: "var(--green-light)" }}
        />

        {/* Thèmes suggérés */}
        <div className="flex flex-wrap gap-2 mb-4">
          {THEMES_SUGGERES.map((t) => (
            <button
              key={t}
              onClick={() => { setTheme(t); generer(t); }}
              className="text-xs px-3 py-1.5 rounded-full border transition hover:opacity-80"
              style={{
                borderColor: theme === t ? "#5B6EA8" : "#C8D4F0",
                background: theme === t ? "#F0F4FF" : "white",
                color: theme === t ? "#3D4F8A" : "#7A9A8A",
              }}
            >
              {t}
            </button>
          ))}
        </div>

        <button
          onClick={() => generer()}
          className="px-6 py-3 rounded-xl font-medium text-white text-sm transition hover:opacity-90"
          style={{ background: "#5B6EA8" }}
        >
          ✨ Générer le prompt
        </button>
      </div>

      {/* Prompt généré */}
      {prompt && <PromptBox prompt={prompt} />}
    </div>
  );
}
