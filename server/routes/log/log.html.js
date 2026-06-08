/**
 * Log page HTML template
 * Shows denied door attempts (with reasons) and granted accesses.
 */

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTimestamp(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return escapeHtml(iso);
  return escapeHtml(
    date.toLocaleString("en-GB", { timeZone: "Europe/Brussels" }),
  );
}

function deniedRow(entry) {
  const who = entry.name || entry.username || entry.userId || "Unknown";
  const handle = entry.username ? ` (@${escapeHtml(entry.username)})` : "";
  const id = entry.userId ? ` · id ${escapeHtml(entry.userId)}` : "";
  return `
    <div class="log-entry denied">
      <div class="log-content">
        <div class="username">${escapeHtml(who)}${handle}</div>
        <div class="reason">${escapeHtml(entry.reason || "Access denied")}</div>
        <div class="timestamp">${formatTimestamp(entry.timestamp)}${id}</div>
      </div>
    </div>`;
}

function grantedRow(entry) {
  const who = entry.name || entry.username || entry.userId || "Unknown";
  const handle = entry.username ? ` (@${escapeHtml(entry.username)})` : "";
  const meta = [entry.method, entry.role].filter(Boolean).join(" · ");
  return `
    <div class="log-entry granted">
      <div class="log-content">
        <div class="username">${escapeHtml(who)}${handle}</div>
        ${meta ? `<div class="agent">${escapeHtml(meta)}</div>` : ""}
        <div class="timestamp">${formatTimestamp(entry.timestamp)}</div>
      </div>
    </div>`;
}

export function generateLogPage(accessLog = [], errorLog = []) {
  // newest first
  const denied = [...errorLog].reverse();
  const granted = [...accessLog].reverse();

  const body = `
  <a href="/"><img src="/commonshub-icon.svg" class="logo" /></a>
  <h1>Door Log</h1>

  <h2>Denied attempts (${denied.length})</h2>
  ${
    denied.length > 0
      ? denied.map(deniedRow).join("")
      : "<p>No denied attempts logged.</p>"
  }

  <h2>Granted accesses (${granted.length})</h2>
  ${
    granted.length > 0
      ? granted.map(grantedRow).join("")
      : "<p>No accesses logged yet.</p>"
  }

  <p class="agent"><a href="/log.json">View raw log JSON</a></p>
`;

  return `
  <html>
    <head>
      <title>Door Log · Commons Hub</title>
      <link rel="stylesheet" href="/styles.css">
      <meta name="viewport" content="width=device-width, initial-scale=1">
    </head>
    <body>${body}</body>
  </html>
`;
}
