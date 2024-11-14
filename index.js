const express = require("express");
const app = express();

let isDoorOpen = false;
const SECRET = process.env.SECRET || "";
const log = [];

setInterval(() => {
  log.length = 0;
}, 1000 * 60 * 60 * 24); // reset log every 24h

// Route to open the door if the correct secret is provided
app.get("/open", (req, res) => {
  const { secret } = req.query;

  if (secret === SECRET) {
    isDoorOpen = true;
    res.send("Door is now open for 3 seconds");

    // Set a timer to reset `isDoorOpen` after 3 seconds
    setTimeout(() => {
      isDoorOpen = false;
    }, 3000);
  } else {
    res.status(403).send("Forbidden: Invalid secret");
  }
});

// Route to check if the door is open
app.get("/check", (req, res) => {
  // console.log(JSON.stringify(req.connection, null, 2));
  // console.log(req);
  const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
  log.push({
    timestamp: new Date().toISOString(),
    ip,
    userAgent: req.headers["user-agent"],
    isDoorOpen,
  });
  if (isDoorOpen) {
    res.sendStatus(200);
  } else {
    res.sendStatus(403); // Forbidden if door is closed
  }
});

app.get("/log", (req, res) => {
  res.status(200).send(JSON.stringify(log, null, 2));
});
app.get("/status", (req, res) => {
  if (log.length === 0) {
    res.status(200).send("Online");
    return;
  }
  const lastLog = log[log.length - 1];
  const lastTimestamp = lastLog.timestamp;
  const elapsed = new Date() - new Date(lastTimestamp);
  if (elapsed > 3000) {
    res
      .status(403)
      .send(
        "Offline since " +
          lastTimestamp +
          " (" +
          Math.round(elapsed / 1000) +
          "s ago)"
      );
  } else {
    res.status(200).send("Online");
  }
});

// Start the server (useful for local development)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
