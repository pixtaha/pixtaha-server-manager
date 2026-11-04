# Design reference (Claude Design export, sanitized)

Source markup of the Claude Design concept for the hub, built on the Pixtaha Design System.
All hostnames, client names, IPs and domains were replaced with fictional values (`203.0.113.x`, `*.example`).

| File | Screens |
|---|---|
| `dashboard-app.dc.html` | Fleet, Server detail, Alerts center, Add server (desktop + mobile). Sample data and logic are in the `<script type="text/x-dc">` block at the end. |
| `auth-screen.dc.html`, `login-flow.dc.html` | Login: passkey, password + TOTP, first-time setup, error states. |
| `status-pill.dc.html` | Status pill icons and colors. |
| `dashboard.dc.html` | Canvas that lays out all frames (sizes, states, Telegram preview). |
| `pm-tokens.css` | Status tokens added on top of the design system (already merged into `hub/src/styles/tokens.css`). |

Format notes: `{{ value }}` is a binding, `<sc-for list=... as=...>` is a loop, `<sc-if value=...>` is a condition,
`<x-import component-from-global-scope="PixtahaDesignSystem_9866b6.Button|Icon|Field|Wordmark">` are design-system components
(the hub has its own equivalents: `px-btn` classes, lucide icons, `Wordmark`, `StatusPill`). Use the markup for layout, spacing and copy; take colors only from tokens.
