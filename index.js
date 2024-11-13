const express = require('express');
const app = express();

let isDoorOpen = false;
const SECRET = process.env.SECRET || "";  

// Route to open the door if the correct secret is provided
app.get('/open', (req, res) => {
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
app.get('/check', (req, res) => {
  if (isDoorOpen) {
    res.sendStatus(200);
  } else {
    res.sendStatus(403); // Forbidden if door is closed
  }
});

module.exports = app;
