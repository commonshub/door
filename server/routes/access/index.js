/**
 * Access route - GET /access[?date=YYYYMMDD]
 * Shows the roles (and their members) that can open the door on a given day.
 * Defaults to today; pass ?date=YYYYMMDD to check any other day.
 */
import { generateAccessPage } from "./access.html.js";

/**
 * Parse a YYYYMMDD string into a Date at local noon (avoids timezone edge
 * cases around midnight). Returns null if the input is missing or invalid.
 */
function parseDateParam(value) {
  if (!value) {
    return null;
  }
  // Accept both YYYYMMDD and YYYY-MM-DD (the native date input emits dashes).
  const digits = String(value).replace(/-/g, "");
  if (!/^\d{8}$/.test(digits)) {
    return null;
  }
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const date = new Date(year, month - 1, day, 12, 0, 0);
  // Reject impossible dates (e.g. 20260230 rolling over into March)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export default function registerAccessRoute(app, dependencies) {
  const { accessRoles, getOpeningHours, isRoleActiveToday, users, getLastReloadAt } =
    dependencies;

  app.get("/access", (req, res) => {
    const date = parseDateParam(req.query.date) || new Date();
    const dateLabel = date.toLocaleDateString("en-GB", {
      timeZone: "Europe/Brussels",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const isToday =
      date.toDateString() === new Date().toDateString();

    const roles = accessRoles
      .filter((role) => isRoleActiveToday(role, date))
      .map((role) => ({
        name: role.name,
        description: role.description,
        openingHours: getOpeningHours(role.roleId),
        members: (role.memberIds || []).map((userid) => ({
          userid,
          displayName: users[userid]?.displayName,
          username: users[userid]?.username,
          avatar: users[userid]?.avatar,
        })),
      }));

    const lastReloadAt = getLastReloadAt ? getLastReloadAt() : null;
    const lastReloadLabel = lastReloadAt
      ? new Date(lastReloadAt).toLocaleString("en-GB", {
          timeZone: "Europe/Brussels",
        })
      : null;

    res
      .status(200)
      .header("content-type", "text/html")
      .send(generateAccessPage(roles, { dateLabel, isToday, lastReloadLabel }));
  });
}
