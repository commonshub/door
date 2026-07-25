/**
 * Status page HTML template
 * Shows connected door hardware status plus the running git version
 * (short hash + latest commit message).
 */

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function generateStatusPage(status, gitInfo = {}) {
  const clientsHtml =
    status.length > 0
      ? status
          .map(
            (client) => `
        <div class="log-entry">
          <div class="log-content">
            <div class="username">${escapeHtml(client.label)} ${client.online ? "🟢" : "🔴"}</div>
            <div class="timestamp">${client.online ? "Online" : `Offline since ${escapeHtml(client.lastSeen)}`}</div>
            <div class="agent">${escapeHtml(client.userAgent)} · ${client.checksToday} checks today</div>
          </div>
        </div>`,
          )
          .join("")
      : "<p>No door hardware has connected yet.</p>";

  const commitDate = gitInfo.date
    ? new Date(gitInfo.date).toLocaleString("en-GB", {
        timeZone: "Europe/Brussels",
      })
    : "";

  const versionHtml = `
    <div class="log-entry">
      <div class="log-content">
        <div class="username">Version ${escapeHtml(
          gitInfo.hash || "unknown",
        )}</div>
        <div class="timestamp">${escapeHtml(gitInfo.message || "")}</div>
        ${commitDate ? `<div class="agent">${escapeHtml(commitDate)}</div>` : ""}
      </div>
    </div>`;

  const body = `
  <a href="/"><img src="/commonshub-icon.svg" class="logo" /></a>
  <h1>Door Status</h1>
  <h2>Hardware</h2>
  ${clientsHtml}
  <h2>Version</h2>
  ${versionHtml}
  <p class="agent"><a href="/status.json">View raw status JSON</a></p>
`;

  return `
  <html>
    <head>
      <title>Door Status · Commons Hub</title>
      <link rel="stylesheet" href="/styles.css">
      <meta name="viewport" content="width=device-width, initial-scale=1">
    </head>
    <body>${body}</body>
  </html>
`;
}
