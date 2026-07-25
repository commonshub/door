/**
 * Status routes
 * - GET /status.json : machine-readable status of connected door hardware
 * - GET /status      : human-readable HTML status incl. git version
 */
import { generateStatusPage } from "./status.html.js";

export default function registerStatusRoute(app, dependencies) {
  const { status_log, gitInfo } = dependencies;

  function getStatus() {
    const clients = Object.keys(status_log);
    const result = [];

    clients.forEach((ip) => {
      const entries = status_log[ip];
      if (!entries || entries.length === 0) return;

      const lastLog = entries[entries.length - 1];
      const lastTime = new Date(lastLog.timestamp);
      const lastTimestamp = lastTime.toLocaleString("en-GB", {
        timeZone: "Europe/Brussels",
      });
      const elapsed = Date.now() - lastTime.getTime();
      const ua = lastLog.userAgent || "unknown";
      const isEsp = /micropython|esp/i.test(ua);
      const label = isEsp ? `ESP32 (${ip})` : `Unknown client (${ip})`;
      const online = elapsed < 10000;

      result.push({
        label,
        ip,
        userAgent: ua,
        isEsp,
        online,
        lastSeen: lastTimestamp,
        checksToday: entries.length,
      });
    });

    result.sort((a, b) => (a.isEsp === b.isEsp ? 0 : a.isEsp ? -1 : 1));
    return result;
  }

  app.get("/status.json", (req, res) => {
    res.json(getStatus());
  });

  app.get("/status", (req, res) => {
    res
      .status(200)
      .header("content-type", "text/html")
      .send(generateStatusPage(getStatus(), gitInfo));
  });
}
