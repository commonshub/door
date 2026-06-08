/**
 * Access page HTML template
 * Lists the roles that can open the door today, and for each role the
 * members who hold it. Member details show on hover (laptop) or tap (mobile).
 */

const DEFAULT_AVATAR =
  "https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp";

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function memberAvatar(member) {
  const displayName = escapeHtml(
    member.displayName || member.username || "Unknown",
  );
  const username = member.username ? `@${escapeHtml(member.username)}` : "";

  return `
    <div class="member" tabindex="0" onclick="this.classList.toggle('show')">
      <img class="today-avatar" src="${escapeHtml(
        member.avatar || DEFAULT_AVATAR,
      )}" alt="${displayName}" loading="lazy">
      <div class="member-tooltip">
        <div class="member-name">${displayName}</div>
        ${username ? `<div class="member-username">${username}</div>` : ""}
      </div>
    </div>
  `;
}

function roleSection(role) {
  const members =
    role.members.length > 0
      ? `<div class="avatar-grid">${role.members
          .map(memberAvatar)
          .join("")}</div>`
      : `<p class="no-members">No members</p>`;

  return `
    <div class="access-role">
      <h2>${escapeHtml(role.name)}</h2>
      <p class="role-description">${escapeHtml(role.description || "")}</p>
      <p class="role-hours">🕒 Can open the door ${escapeHtml(
        role.openingHours,
      )}</p>
      <p class="member-count">${role.members.length} ${
        role.members.length === 1 ? "person" : "people"
      }</p>
      ${members}
    </div>
  `;
}

export function generateAccessPage(roles, options = {}) {
  const { dateLabel = "", isToday = true, lastReloadLabel = null } = options;

  const heading = isToday
    ? "Who can open the door today?"
    : "Who can open the door on this day?";

  const reloadInfo = `
  <p class="reload-info">
    Roles last reloaded: ${
      lastReloadLabel ? escapeHtml(lastReloadLabel) : "never"
    } · <a href="/refresh">refresh now</a>
  </p>`;

  const body = `
  <a href="/"><img src="/commonshub-icon.svg" class="logo" /></a>
  <h1>${escapeHtml(heading)}</h1>
  <p class="access-date">${escapeHtml(dateLabel)}</p>
  <form class="date-picker" method="get" action="/access">
    <label for="date">Check another day:</label>
    <input type="date" id="date" name="date" onchange="this.form.submit()">
  </form>
  ${reloadInfo}
  ${
    roles.length > 0
      ? roles.map(roleSection).join("\n")
      : "<p>No roles have access on this day.</p>"
  }
`;

  const html = `
  <html>
    <head>
      <title>Door Access · Commons Hub</title>
      <link rel="stylesheet" href="/styles.css">
      <meta name="viewport" content="width=device-width, initial-scale=1">
    </head>
    <body>${body}</body>
  </html>
`;

  return html;
}
