# Documentation Index

## Canonical Audit and Architecture Docs

The following documents are the current canonical sources for this repository:

| Document | Status | Purpose |
|----------|--------|---------|
| `CLAUDE.md` | ✓ Current | Primary working guide for the codebase |
| `ARCHITECTURE_AUDIT.md` | ✓ Current | High-level architecture overview |
| `BACKEND_MAP.md` | ✓ Current | Backend module ownership and responsibilities |
| `FRONTEND_MAP.md` | ✓ Current | Frontend structure and conventions |
| `DATABASE_MAP.md` | ✓ Current | Database schema and persistence layer |
| `FEATURE_MATRIX.md` | ✓ Current | Implemented vs planned features |
| `CURRENT_IMPLEMENTED_STATE.md` | ✓ Current | Current reality of the codebase |
| `TECHNICAL_DEBT_AND_RISKS.md` | ✓ Current | Known issues and risks |
| `IMPLEMENTATION_RECOMMENDATIONS.md` | ✓ Current | Recommendations for improvement |
| `REPOSITORY_FULL_AUDIT_REPORT.md` | ✓ Current | Comprehensive audit report |

## De-Scoped / Not Implemented

The following features are partially present or de-scoped:

- **Remote live runtime orchestration**: Server selection, heartbeat, and placement exist, but remote FFmpeg start/stop control is not implemented
- **Cloud backup uploads**: Provider settings UI exists, but upload functionality is de-scoped
- **RBAC enforcement**: UI surfaces exist, but backend enforcement is weak
- **EPG mass assignment and auto-match**: These features return `410 Gone` and are not implemented

## Missing Historical Docs

The following docs were referenced in older planning but are not present in this repository copy:

- `docs/UI_AUDIT_REPORT.md` (UI audit information is now integrated into other docs)
- `docs/UI_BUG_LIST.md` (UI issues are tracked separately)
- `docs/UI_ROOT_CAUSE_CONFIRMATION.md` (resolved and archived)
- `docs/UI_SCREENSHOT_INDEX.md` (visual audit artifacts)
- `docs/LB_SOURCE_ARCHITECTURE_ANALYSIS.md` (superseded by `ARCHITECTURE_AUDIT.md`)
- `docs/LB_TARGET_RUNTIME_AND_SCHEMA.md` (superseded by `CURRENT_IMPLEMENTED_STATE.md`)
- `docs/LB_TARGET_GAP_ANALYSIS.md` (superseded by `TECHNICAL_DEBT_AND_RISKS.md`)
- `docs/LB_MIGRATION_NOTES.md` (migration notes are in `IMPLEMENTATION_RECOMMENDATIONS.md`)
- `docs/LB_LIVE_REDIRECT_CONTRACT_SPEC.md` (contract is documented in `BACKEND_MAP.md`)
- `docs/LB_RISKS_AND_SECURITY.md` (integrated into `TECHNICAL_DEBT_AND_RISKS.md`)
- `docs/LB_FILE_OWNERSHIP_MAP.md` (ownership is in `BACKEND_MAP.md`)
- `docs/XC_RUNTIME_PARITY_PHASES.md` (deprecated, not applicable to current codebase)

## Document Usage Priority

1. **Start here**: `CLAUDE.md` - The primary guide for all work in this repository
2. **For new features**: `FEATURE_MATRIX.md` + `IMPLEMENTATION_RECOMMENDATIONS.md`
3. **For changes to routes/services**: `BACKEND_MAP.md` + `ARCHITECTURE_AUDIT.md`
4. **For frontend work**: `FRONTEND_MAP.md`
5. **For database changes**: `DATABASE_MAP.md`
6. **Before major refactors**: `CURRENT_IMPLEMENTED_STATE.md` + `TECHNICAL_DEBT_AND_RISKS.md`

## Last Updated

2026-04-01
