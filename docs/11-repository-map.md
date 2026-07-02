# 11. Repository Map

*Part of the [Pro-Quote documentation](README.md).*

```mermaid
flowchart TD
    ROOT["app-convertor/"]

    ROOT --> BE["backend/<br/>FastAPI app — routes/, services.py, startup.py,<br/>seed data (catalog_seed.py, vero_*, mezzo_*, iss_catalog.py),<br/>tests/ (HTTP integration tests)"]
    ROOT --> FE["frontend/<br/>React SPA — src/pages, src/components, src/lib"]
    ROOT --> MEM["memory/<br/>PRD.md (full product history, iteration log)<br/>REMINDERS.md (backlog)"]
    ROOT --> RES["Resource_Docs/<br/>ConversationWithHowie.mp3 + transcript"]
    ROOT --> DOCS["docs/<br/>this documentation set"]
    ROOT --> TR["test_reports/<br/>historical test-run reports"]
    ROOT --> FILES["Root files"]

    FILES --> TRMD["test_result.md — agent testing protocol +<br/>task status log (protected format)"]
    FILES --> CQ["CODE_QUALITY.md — lint philosophy: what reviewers<br/>should and should not flag"]
    FILES --> CL["CLAUDE.md — guidance for AI coding agents"]
    FILES --> DG["design_guidelines.json — visual design tokens"]
    FILES --> SRC["source.html — the original self-contained<br/>HTML estimator the app grew from"]
```

| Path | Contents |
|---|---|
| `backend/` | FastAPI app ([Architecture §5.2](05-architecture.md)) — `routes/`, pricing engine (`services.py`), boot seeding (`startup.py`), per-brand seed data, `tests/` |
| `frontend/` | React SPA ([Architecture §5.3](05-architecture.md)) — `src/pages`, `src/components`, domain logic in `src/lib` |
| `memory/` | `PRD.md` (full product history, iteration log) · `REMINDERS.md` (backlog) |
| `Resource_Docs/` | Recorded conversation with the creator + transcript |
| `docs/` | This documentation set |
| `test_reports/` | Historical test-run reports |
| `test_result.md` | Agent testing protocol + task status log (protected format) |
| `CODE_QUALITY.md` | Lint philosophy — what reviewers should and should not flag |
| `CLAUDE.md` | Guidance for AI coding agents working in this repo |
| `design_guidelines.json` | Visual design tokens/guidelines |
| `source.html` | The original self-contained HTML estimator the app grew from |
