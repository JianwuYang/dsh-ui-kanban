# dsh-kanban — browser-half UI surfaces

The client half (`src/client/`) registers four UI surfaces via `ctx.slots`.
All but the config card's *data path* are pure declarative slot registrations
that work on any harness **without** editing the harness source; only the
config card's data path is gated by the web settings allowlist (see below).

| Surface | Module | Id / Key | Behavior |
|--------|--------|----------|----------|
| `settings.plugin.item` | `src/client/config-card.ts` | key = `dsh-kanban` | A card under Settings → Plugins → Configurable. Edits the **global Jira/GitLab host + token** (token is a password field; leaving it blank keeps the host-side secret, so a redacted token is never clobbered), plus the scalar settings (`dataDir`, `allowSelfSigned`, `verbose`). Global host/token are written through a merge-only `PUT /kanban-api/settings/global` endpoint; the per-workspace project/connection overrides are managed with the `kanban-configure` tool. |
| `conversation.session.header.utilities` | `src/client/kanban-activity.tsx` | id = `dsh-kanban` | A **"看板" button (icon + label)** in the session-header utility row (right of the session title). Session-scoped: clicking opens the floating panel for **that session's workspace**. This is the only entry to the interactive board. |
| `shell.overlay` | `src/client/kanban-activity.tsx` | id = `dsh-kanban-panel` | The **session-scoped floater panel**, opened by the header button above (no persistent badge). It follows the **currently-selected session's** workspace live (falls back to the opening session's `cwd` when none is selected): switching sessions/workspaces in DSH reloads the panel for the new workspace's project, via `?cwd=`. Closes via the panel's close button. |
| `tool.call.toolview` | `src/client/kanban-toolview.ts` | keys = `kanban-issues`, `kanban-sync`, `kanban-issue`, `kanban-move`, `kanban-projects` | Renders the result of a kanban tool call as a visual board / detail / project list. |

## Host-side `/kanban-api` bridge

The host half (`src/http.ts`) registers a `webServer` prefix route at
`/kanban-api` that exposes the ported `KanbanBackend` (projects / settings /
issues / sync / gitlab) as same-origin REST. The embedded browser app fetches
these directly — the only place Jira/GitLab credentials live. The route is
registered via `ctx.webServer.register()`, a plugin-visible route registry, so
no harness edit is needed. It only mounts when a web server is composed (the
`web` profile); headless profiles simply don't get it.

Board/list endpoints accept an optional `?workspace=<id|title|path>` query to
address a specific workspace, or `?cwd=<path>` for the session's workspace —
the session-scoped floater uses one of these to show a per-session project on
`GET /issues` and `POST /sync`. Absent, they fall back to the first workspace.
With the workspace model the board derives one project per DSH workspace and
the global Jira/GitLab host+token live at the top level of the namespace.

## How the board renders

When the host half runs `kanban-issues` (or `kanban-sync`) it emits a structured
`output.presentationMeta` payload of the shape `{ kind: 'kanban-board', board }`
(and `kanban-detail` for `kanban-issue`/`kanban-move`, `kanban-projects` for
`kanban-projects`). The client `tool.call.toolview` rows read that `meta` off the
tool-result block (`block.meta`) and render:

- **board** — columns grouped by status, each an issue card (key, summary, type /
  priority tags, assignee).
- **detail** — key · summary, status/type/priority/assignee, description,
  available transitions, comment count.
- **projects** — the project (workspace) list with the active one marked.
- **sync** — the sync result summary.

If `meta` is absent (e.g. an older log), the row falls back to rendering the
tool's text `content`.

## Client UI architecture & design system

The client half is organized into small modules under `src/client/`:

| Module | Purpose |
|--------|---------|
| `styles.ts` | Single injected `<style>` tag. Design tokens at `:root, body` (`--kb-*`: radii, spacing, type scale ≥12px, motion 150–300ms, semantic colors mapped to `--dsw-alias-*`, status-category accents — note the harness defines `--dsw-alias-*` on `body`, so theme-mapped tokens must not live on `:root` alone). Shared component classes are unscoped `.kb-*` (used by both the app and the chat toolviews); `.kkb-app` keeps only app-layout rules; `.kkb-config-*` / `.kkb-header-*` style the remaining surfaces. |
| `icons.tsx` | Inline SVG icon set (`Ic*`), no icon library — the client bundle only allows the `react` runtime dep. |
| `modal.tsx` | In-app `Modal` (Esc closes only the topmost of nested modals via a module-level depth stack, focus trap + restore, body scroll lock, enter/exit animation; `footer={null}` removes the bottom bar), `ConfirmDialog`/`PromptDialog`/`ChoiceDialog` + `DialogsProvider` — replace all native `alert`/`confirm`/`prompt`. |
| `toast.tsx` | `ToastProvider` + `useToast()` — aria-live toasts with enter/exit animation. |
| `primitives.tsx` | Shared widgets: `IconButton`, `Avatar` (initials), `StatusDot`, `SearchInput`, `SegToggle`, `EmptyState`, skeletons, `CopyButton`, `formatDateTime` (browser-local timestamps). |
| `kanban-app.tsx` | App shell: providers, state, load/sync handlers, panel header (two rows — brand/meta/close, labeled actions). |
| `kanban-board.tsx` | The single board view: a status-grouped vertical list for narrow panels — collapsible sections (status dot + count + chevron), full-width cards, client-side search. No drag & drop and no status filter chips: moving an issue goes through click → detail → transition buttons (keyboard-friendly), and the grouping itself is the status overview. |
| `kanban-modals.tsx` | Settings / Create issue (createmeta-driven, chip-style multi-value fields) / GitLab workspace (nested sub-modals) / issue detail (attachments, comment composer, send-to-session) / image lightbox. |
| `session-send.ts` | Send-to-session analysis via the official `ISession.prompt` (current session) and `workspaces.startSession()` (new session in the current workspace); image attachments ride along as image content parts (base64). |
| `locales.ts` | Lightweight i18n: zh/en dictionaries + `useT()` subscribed to the harness `ctx.locale` service (`bindLocale` at apply time; falls back to zh when absent). All UI copy goes through `t(key)`; the analysis prompt follows the active UI language. |

Interactions: Esc closes the topmost modal (lightbox first), focus is trapped
and restored, `prefers-reduced-motion` disables animations, status groups are
color-coded per category (`to do` neutral / `in progress` warning / `done`
success), priorities get colored tags, sync/detail loads show skeletons, and
the grouped list has a client-side search. The toolview classes were migrated
from the old `kkb-*` set to the shared `kb-*` set.

**Send-to-session analysis**: the issue detail modal has a 「丢进会话分析」
button — after a confirm dialog (current session / new session in the current
workspace), the panel sends a prompt through the official `ISession.prompt`
(`session-send.ts`; new sessions go through `workspaces.startSession()`). The
message carries only the issue key plus an instruction to call `kanban-issue`
and to analyze without modifying — the agent pulls live data through the tool,
and the chat renders it via the existing toolview. Image attachments are
fetched through the host proxy and attached as image content parts (base64),
so vision-capable models can see them; text-only models degrade gracefully.
The issue detail tool text also lists attachments with their real Jira
download URLs.

## The config card on a stock harness

The config card always renders. On a stock harness the `dsh-kanban` settings
namespace is not in the web gateway's allowlist
(`WEB_SETTINGS_NAMESPACES`), so `settings.describe` answers
`settings-not-exposed` and the card shows a read-only "not exposed" status
card instead of fields. This only affects the card's **editability** — the host
half still reads the resolved namespace on every tool call, and the tools work
regardless.

To make the card editable, add the namespace to the allowlist:

```ts
const WEB_SETTINGS_NAMESPACES = [
  'agent-loop', 'shell', 'locale', 'permission', 'ui-conversation', 'ui-theme', 'web-search-deepseek',
  'dsh-kanban',   // ← add this line
] as const
```

(The path in the harness is `packages/host/apiproxy/src/api-proxy.ts`; rebuild /
restart the harness, then refresh the page.)

## Editing discipline

The client bundle depends only on `react` at runtime (the browser module table
provides it); everything else is inlined. No `@deepseek-ai` client package is
imported — the client half uses minimal structural types in
`src/client/types.ts` and obtains services via `ctx` / `ctx.slots`.
