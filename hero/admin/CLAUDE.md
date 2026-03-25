# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server (Next.js)
npm run build    # Production build
npm run lint     # ESLint
```

No test runner is configured — this project has no automated tests.

## Architecture Overview

This is a **Next.js 15 admin dashboard** for generating and managing interactive gamebooks ("Livres Dont Vous Êtes le Héros"). It uses the App Router with TypeScript.

**Stack:**
- Frontend: React 19, Next.js App Router, Tailwind CSS 4
- Database: Supabase (PostgreSQL), with two clients:
  - `src/lib/supabase.ts` — public client (anon key, for browser)
  - `src/lib/supabase-admin.ts` — service role client (for API routes, bypasses RLS)
- AI: Claude (Anthropic) primary, Mistral as fallback, ElevenLabs (TTS), Replicate (images)
- Path alias: `@/*` → `./src/*`

**Required env vars:** `ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ELEVENLABS_API_KEY`, `REPLICATE_API_TOKEN`

## Code Structure

### `src/types/index.ts`
Central type definitions for the entire domain. Key types:
- `Book` — the main entity, ~355 fields
- `Section` — story node with text, trials, images, dialogues
- `Choice` — decision point linking sections (with conditions)
- `Npc`, `Location`, `Item`, `Trial`, `Job`
- Enums: `BookPhase` (draft→done), `ProjectStatus`, `AgeRange`, `Language`, `Difficulty`, `TrialType`

### `src/lib/prompts.ts` (~44KB)
All AI prompts for book generation. Key functions:
- `buildBookStructurePrompt()` — generates section outlines
- `buildSectionContentPrompt()` — writes individual sections
Contains difficulty guides, weapon/magic guides per universe theme, content mix percentages.

### `src/lib/ai-utils.ts`
Shared AI utilities:
- `streamMessageWithRetry()` — Claude call with auto-retry on 529 (overload)
- `callMistral()` — direct HTTPS call (avoids Next.js fetch patching)
- `translateToEnglish()` — French→English via Claude Haiku
- `fixJsonControlChars()` / `extractJson()` — LLM JSON parsing helpers

### `src/app/api/`
30+ API routes, all server-side. Key groups:
- `/api/generate` — core book generation dispatcher (Claude/Mistral, ~500 lines)
- `/api/books/[id]/generate-sections` — story structure generation
- `/api/books/[id]/write-all` — write all sections in batch
- `/api/books/[id]/illustrate-all`, `illustrate-npcs` — image generation via Replicate
- `/api/books/[id]/fix-*` — auto-correction endpoints (language, inconsistencies, self-loops)
- `/api/books/[id]/generate-map` — SVG map via Claude
- `/api/sections/[id]` — section CRUD + sub-routes for dialogues, image prompts
- `/api/elevenlabs`, `/api/generate-image`, `/api/generate-music`, `/api/generate-video`

### `src/app/books/[id]/page.tsx`
Main book editor page — a large tabbed interface covering structure, writing, illustrations, map, NPCs, items, audio, etc.

## UI Conventions

- Dark theme throughout; accent color `#d4a84c` (gold)
- No component library — all UI is custom-built with Tailwind
- Icon rail navigation on the left
- French-language UI (the content domain is French gamebooks)

## Database Migrations

Migration SQL files are in `../supabase/migrations/` (relative to this directory). Run them manually in Supabase dashboard or via Supabase CLI when needed.
