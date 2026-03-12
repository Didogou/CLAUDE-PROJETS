# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Environment

- Platform: Windows 11, running commands via bash (Git Bash / MSYS2)
- Use Unix-style paths and shell syntax (forward slashes, `/dev/null`, etc.)
- VS Code is configured with `claudeCode.useTerminal: true`

## Toolchain (Python projects)

When working on Python projects in this workspace:

- Run tests: `pytest` or `python -m pytest`
- Lint/format: `ruff check .` and `ruff format .`
- Run a single test: `pytest path/to/test_file.py::test_name`

## Pre-approved Bash commands

The following commands run without prompting the user (defined in `.vscode/.claude/settings.local.json`):

`grep`, `ls`, `find`, `mv`, `mkdir`, `tree`, `touch`, `chmod`, `cat`, `source`, `ruff`, `pytest`, `python`, `git init/add/commit/remote add/branch/push/status/diff/log`, `gh issue view`, `WebFetch`
# Rule
`Utilise toujours context7 lorsque j'ai besoin de génération de code, d'étapes de configuration ou d'installation, ou de documentation de bibliothèque/API. Cela signifie que tu dois automatiquement utiliser les outils MCP Context7 pour résoudre l'identifiant de bibliothèque et obtenir la documentation de bibliothèque sans que j'aie à le demander explicitement.`