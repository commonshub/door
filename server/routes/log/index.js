/**
 * Log routes
 * - GET /log      : human-readable HTML log of door accesses & denied attempts
 * - GET /log.json : raw JSON of both logs (newest last)
 *
 * Reads from the persistent append-only log files in LOG_DIR so the history
 * survives restarts. Denied attempts include the reason access wasn't granted.
 */
import { generateLogPage } from "./log.html.js";

export default function registerLogRoute(app, dependencies) {
  const { getAccessLog, getErrorLog } = dependencies;

  app.get("/log.json", (req, res) => {
    res
      .status(200)
      .header("Content-Type", "application/json")
      .send(
        JSON.stringify(
          { granted: getAccessLog(), denied: getErrorLog() },
          null,
          2,
        ),
      );
  });

  app.get("/log", (req, res) => {
    res
      .status(200)
      .header("content-type", "text/html")
      .send(generateLogPage(getAccessLog(), getErrorLog()));
  });
}
