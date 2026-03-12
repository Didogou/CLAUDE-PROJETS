"use client";
import { useState } from "react";

interface Props {
  prompt: string;
}

export default function PromptBox({ prompt }: Props) {
  const [copied, setCopied] = useState(false);

  const copier = () => {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "#C8D4F0" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3" style={{ background: "#5B6EA8" }}>
        <div className="flex items-center gap-2">
          <span className="text-white text-sm font-medium">📋 Prompt à copier dans Claude.ai</span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="https://claude.ai/new"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs px-3 py-1.5 rounded-lg font-medium transition"
            style={{ background: "rgba(255,255,255,0.2)", color: "white" }}
          >
            Ouvrir Claude.ai →
          </a>
          <button
            onClick={copier}
            className="text-xs px-3 py-1.5 rounded-lg font-medium transition"
            style={{ background: copied ? "#4A9A7A" : "white", color: copied ? "white" : "#5B6EA8" }}
          >
            {copied ? "✓ Copié !" : "Copier le prompt"}
          </button>
        </div>
      </div>

      {/* Instructions */}
      <div className="px-5 py-3 text-xs" style={{ background: "#F0F4FF", color: "#3D4F8A", borderBottom: "1px solid #C8D4F0" }}>
        <strong>Mode gratuit :</strong> Copie ce prompt → ouvre Claude.ai → colle → copie le résultat dans Instagram / Facebook
      </div>

      {/* Contenu du prompt */}
      <div className="p-5 text-sm font-mono whitespace-pre-wrap" style={{ background: "white", color: "#1C3A2E", maxHeight: "400px", overflowY: "auto", fontSize: "12px", lineHeight: "1.6" }}>
        {prompt}
      </div>
    </div>
  );
}
