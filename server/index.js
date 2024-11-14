require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");

// Get bot token and allowed channel ID from the environment variables
const token = process.env.DISCORD_BOT_TOKEN;
const allowedChannelId = process.env.DISCORD_CHANNEL_ID;

// Initialize the bot client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Add this function to register the commands
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("open")
      .setDescription("Opens the door")
      .toJSON(),
  ];

  try {
    console.log("Registering commands...");
    console.log("Bot Client ID:", client.user.id); // Debug log

    const rest = new REST({ version: "10" }).setToken(token);
    console.log("Started refreshing application (/) commands.");

    await rest.put(Routes.applicationCommands(client.user.id), {
      body: commands,
    });

    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error("Error registering commands:", error);
  }
}

// When the bot is ready
client.once("ready", async () => {
  console.log(`${client.user.tag} is now online!`);
  // Wait a moment before registering commands
  await registerCommands();
});

// Handle interactions (like slash commands)
client.on("interactionCreate", async (interaction) => {
  // Check if the interaction is a command and if it comes from the allowed channel
  if (!interaction.isCommand()) return;

  // Only respond if the interaction is in the allowed channel
  if (interaction.channelId !== allowedChannelId) {
    return interaction.reply({
      content: "This bot can only be used in a specific channel!",
      ephemeral: true,
    });
  }

  const { commandName } = interaction;

  if (commandName === "open") {
    openDoor();
    await interaction.reply("Door opening!");
  }
  // Add more commands handling here
});

// Add this event listener after your other client.on events
client.on("messageCreate", async (message) => {
  // Ignore messages from bots
  if (message.author.bot) return;

  // Check if message is in the allowed channel
  if (message.channelId !== allowedChannelId) return;

  // Now you can handle the message
  console.log(`Received message: ${message.content}`);

  // Example: respond to specific messages
  if (message.content.toLowerCase() === "open") {
    openDoor();
    message.reply("Door opening!");
  }
});

// Log in to Discord
client.login(token);
const express = require("express");
const app = express();

let isDoorOpen = false;
const SECRET = process.env.SECRET || "";
const log = {};

function openDoor() {
  isDoorOpen = true;

  // Set a timer to reset `isDoorOpen` after 3 seconds
  setTimeout(() => {
    isDoorOpen = false;
  }, 3000);
}

setInterval(() => {
  Object.keys(log).forEach((ip) => {
    log[ip].length = 0;
  });
}, 1000 * 60 * 60 * 24); // reset log every 24h

// Route to open the door if the correct secret is provided
app.get("/open", (req, res) => {
  const { secret } = req.query;

  if (secret === SECRET) {
    openDoor();
    res.send("Door is now open for 3 seconds");
  } else {
    res.status(403).send("Forbidden: Invalid secret");
  }
});

// Route to check if the door is open
app.get("/check", (req, res) => {
  // console.log(JSON.stringify(req.connection, null, 2));
  // console.log(req);
  const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
  log[ip] = log[ip] || [];
  log[ip].push({
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
  const ip = req.query.ip;
  if (ip) {
    res
      .status(200)
      .header("Content-Type", "application/json")
      .send(JSON.stringify(log[ip], null, 2));
  } else {
    res
      .status(200)
      .header("Content-Type", "application/json")
      .send(JSON.stringify(log, null, 2));
  }
  return;
});
app.get("/status", (req, res) => {
  const ip = req.query.ip;

  if (!ip) {
    res
      .status(200)
      .header("Content-Type", "application/json")
      .send(JSON.stringify(log, null, 2));
    return;
  }
  if (!log[ip]) {
    res.status(200).send("No log for that ip: " + ip);
    return;
  }

  if (log[ip].length === 0) {
    res.status(200).send("Online");
    return;
  }
  const lastLog = log[ip][log[ip].length - 1];
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
