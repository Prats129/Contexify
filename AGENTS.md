# Contexify contributor guidance

Static baseline: `0c7cd717c262b4fd5afcd1d785815cb53066c85e`, reviewed 2026-10-12. Recheck changed code before relying on this snapshot.

## Start here

[Overview](docs/project-overview.md) · [Architecture](docs/architecture.md) · [Module map](docs/module-map.md) · [Workflows](docs/business-workflows.md) · [Coverage](docs/review-coverage.md) · [Findings](docs/audit/technical-findings.md) · [Product recommendations](docs/audit/product-recommendations.md) · [Roadmap](docs/audit/prioritized-roadmap.md) · [Verification](docs/audit/verification.md).

## Conventions and boundaries

The FastAPI backend, React/Vite web app and Expo/React Native app are separate packages, not npm workspaces. Root Python scripts assume Windows. Follow existing Python snake_case/services/schemas and TypeScript functional components/hooks. Wire fields use snake_case. No tracked CI or enforced formatter/linter exists at this baseline.

Review backend schemas and both clients when changing API fields, modes, SSE events, IDs or attachments. SQLite/Turso, Chroma/Pinecone and local/R2 semantics differ; validate each supported mode. Keep improvements incremental and preserve useful platform-specific UI.

A cached user profile is currently not an authenticated credential. Never rely on request user_id as proof of identity. Read AUD-001/AUD-002 before security-sensitive changes.

## Safe checks with installed dependencies

Run from repository root:

```powershell
node frontend/node_modules/typescript/bin/tsc --project frontend/tsconfig.json --noEmit --incremental false
node mobile/node_modules/typescript/bin/tsc --project mobile/tsconfig.json --noEmit --incremental false
@'
import ast, pathlib
files = sorted(pathlib.Path("backend").glob("*.py")) + sorted(pathlib.Path("backend/app").rglob("*.py"))
for p in files:
    ast.parse(p.read_text(encoding="utf-8-sig"), filename=str(p))
print("Parsed", len(files), "Python files")
'@ | python -B -
```

These checks passed during the audit; they do not establish runtime correctness.

Application imports create directories and initialize singletons; startup initializes/migrates SQL and purges temporary data. Existing backend test/verify scripts can write configured databases, send mail or call providers. Inspect/isolate their configuration before running. reset_db.py is destructive, never a health check. Builds/install/deployment/EAS commands have side effects and require authorization appropriate to the task.

Never print actual environment values, credentials, user databases, uploaded content or private logs. Prefer template key names. Do not contact configured production URLs merely to check connectivity.

The onboarding audit authorized documentation only. No implementation was made; follow the user's next authorization. Keep finding IDs stable and distinguish source facts from runtime hypotheses. No prior AGENTS.md or CLAUDE.md existed; README is preserved but has factual drift (AUD-032).

