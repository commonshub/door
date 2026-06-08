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
    const status = {};

    clients.forEach((ip) => {
      if (status_log[ip].length === 0) {
        status[ip] = "Online";
      } else {
        const lastLog = status_log[ip][status_log[ip].length - 1];
        const lastTimestamp = new Date(lastLog.timestamp).toLocaleString(
          "en-GB",
          {
            timeZone: "Europe/Brussels",
          },
        );
        const elapsed = new Date() - new Date(lastLog.timestamp);
        if (elapsed > 4000) {
          status[ip] = `Offline since ${lastTimestamp} (${Math.round(
            elapsed / 1000,
          )}s ago)`;
        } else {
          status[ip] = `${lastLog.userAgent} online`;
        }
      }
    });

    return status;
  }

  app.get("/status.json", (req, res) => {
    res
      .status(200)
      .header("Content-Type", "application/json")
      .send(JSON.stringify(getStatus(), null, 2));
  });

  app.get("/status", (req, res) => {
    res
      .status(200)
      .header("content-type", "text/html")
      .send(generateStatusPage(getStatus(), gitInfo));
  });
}
