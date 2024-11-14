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

  try {
    // Only respond if the interaction is in the allowed channel
    if (interaction.channelId !== allowedChannelId) {
      return interaction.reply({
        content: "This bot can only be used in a specific channel!",
        ephemeral: true,
      });
    }

    const { commandName } = interaction;

    if (commandName === "open") {
      await interaction.reply("Door opening!");
      openDoor(interaction.user.displayName, client.user.tag);
    }
  } catch (error) {
    console.error("Error handling interaction:", error);
    // Try to respond to the user if we haven't already
    if (!interaction.replied && !interaction.deferred) {
      await interaction
        .reply({
          content: "There was an error processing your command!",
          ephemeral: true,
        })
        .catch(console.error);
    }
  }
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
    openDoor(message.author.displayName, client.user.tag);
    message.reply("Door opening!");
  }
});

// Log in to Discord
client.login(token);
const express = require("express");
const app = express();

let isDoorOpen = false;
const SECRET = process.env.SECRET || "";
const status_log = {};
const doorlog = [];

function openDoor(user, agent) {
  console.log("Opening door for user", user, "with agent", agent);
  isDoorOpen = true;
  doorlog.push({
    timestamp: new Date().toISOString(),
    user,
    agent,
  });

  // Set a timer to reset `isDoorOpen` after 3 seconds
  setTimeout(() => {
    isDoorOpen = false;
    console.log("Closing door");
  }, 3000);
}

setInterval(() => {
  status_log = {};
  console.log("Resetting status log");
}, 1000 * 60 * 60 * 24); // reset log every 24h

// Route to open the door if the correct secret is provided
app.get("/open", (req, res) => {
  const { secret } = req.query;
  const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
  if (secret === SECRET) {
    openDoor(ip, req.headers["user-agent"]);
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
  status_log[ip] = status_log[ip] || [];
  status_log[ip].push({
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
  res
    .status(200)
    .header("Content-Type", "application/json")
    .send(JSON.stringify(doorlog, null, 2));
  return;
});

app.get("/status", (req, res) => {
  const clients = Object.keys(status_log);
  const status = {};
  clients.forEach((ip) => {
    if (status_log[ip].length === 0) {
      status[ip] = "Online";
    } else {
      const lastLog = status_log[ip][status_log[ip].length - 1];
      const lastTimestamp = lastLog.timestamp;
      const elapsed = new Date() - new Date(lastTimestamp);
      if (elapsed > 3000) {
        status[ip] = `Offline since ${lastTimestamp} (${Math.round(
          elapsed / 1000
        )}s ago)`;
      }
    }
  });
  res
    .status(200)
    .header("Content-Type", "application/json")
    .send(JSON.stringify(status, null, 2));
});

// Start the server (useful for local development)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
