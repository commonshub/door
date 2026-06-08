import dotenv from "dotenv";
dotenv.config();

// Set default timezone to Europe/Brussels if not specified
if (!process.env.TZ) {
  process.env.TZ = "Europe/Brussels";
}

import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import { loginWithCitizenWallet } from "./lib/citizenwallet/index.js";
import { sendDiscordMessage, getMembers, removeRole } from "./lib/discord.js";
import { loadJSON } from "./lib/utils.js";
import { createApp } from "./app.js";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import crypto from "crypto";
import { verifyMessage, Wallet } from "ethers";
import fs from "fs";
import { execSync } from "child_process";
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const community = loadJSON("./lib/citizenwallet/community.json");

const DEFAULT_AVATAR =
  "https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp";

/**
 * Read the current git version (short hash + latest commit message).
 * Computed once at startup; falls back gracefully when git is unavailable
 * (e.g. when deployed from a tarball without a .git directory).
 */
function getGitInfo() {
  const run = (cmd) => execSync(cmd, { cwd: __dirname }).toString().trim();
  try {
    return {
      hash: run("git rev-parse --short HEAD"),
      message: run("git log -1 --pretty=%s"),
      date: run("git log -1 --pretty=%cI"),
    };
  } catch (error) {
    console.warn(">>> Could not read git info:", error.message);
    return { hash: "unknown", message: "", date: "" };
  }
}

const gitInfo = getGitInfo();
console.log(">>> Git version:", gitInfo.hash, "-", gitInfo.message);

/**
 * Build a CDN avatar URL for a Discord guild member returned by the REST API.
 * Prefers the guild-specific avatar, then the global user avatar, then a
 * default placeholder.
 */
function getDiscordAvatarUrl(member) {
  const userId = member.user.id;
  if (member.avatar) {
    return `https://cdn.discordapp.com/guilds/${process.env.DISCORD_GUILD_ID}/users/${userId}/avatars/${member.avatar}.png?size=128`;
  }
  if (member.user.avatar) {
    return `https://cdn.discordapp.com/avatars/${userId}/${member.user.avatar}.png?size=128`;
  }
  return DEFAULT_AVATAR;
}

// Get bot token and allowed channel ID from the environment variables
const token = process.env.DISCORD_BOT_TOKEN;
const allowedChannelId = process.env.DISCORD_CHANNEL_ID;
const users = {};

const SECRET = process.env.SECRET || "";
const DRY_RUN = process.env.DRY_RUN === "true";

const presentToday = {};
const funFacts = [];

const d = new Date();
console.log(">>> door started", d.toISOString());
console.log(
  ">>> Timezone:",
  process.env.TZ,
  "| Local time:",
  d.toLocaleString("en-GB", { timeZone: process.env.TZ }),
);

const rest = new REST({ version: "10" }).setToken(token);

const accessRoles = loadJSON("./access_roles.json");
const authorizedKeys = loadJSON("./authorized_keys.json");

const userIdToRoles = {};

// Private key management
const DATA_DIR = process.env.DATA_DIR || __dirname;
const PRIVATE_KEY_PATH = path.join(DATA_DIR, ".privateKey");

/**
 * Get or generate private key for event email signing
 */
function getOrCreatePrivateKey() {
  // Check environment variable first
  if (process.env.PRIVATE_KEY) {
    const wallet = new Wallet(process.env.PRIVATE_KEY);
    console.log(">>> 🔐 Using PRIVATE_KEY from environment");
    console.log(">>> 📬 Public address:", wallet.address);
    return process.env.PRIVATE_KEY;
  }

  // Check if key file exists
  if (fs.existsSync(PRIVATE_KEY_PATH)) {
    const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, "utf8").trim();
    const wallet = new Wallet(privateKey);
    console.log(">>> 📂 Loaded private key from:", PRIVATE_KEY_PATH);
    console.log(">>> 📬 Public address:", wallet.address);
    return privateKey;
  }

  // Generate new private key
  console.log(">>> 🔑 Generating new private key...");
  const wallet = Wallet.createRandom();
  const privateKey = wallet.privateKey;

  // Save to file
  try {
    fs.writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
    console.log(">>> ✅ Private key saved to:", PRIVATE_KEY_PATH);
    console.log(">>> 📬 Public address:", wallet.address);
    console.log(">>> ✅ Server public key automatically authorized");
  } catch (error) {
    console.error(">>> ❌ Failed to save private key:", error.message);
  }

  return privateKey;
}

// Initialize private key and log public address
const PRIVATE_KEY = getOrCreatePrivateKey();

// Add server's public key to authorized keys
const serverWallet = new Wallet(PRIVATE_KEY);
const serverPublicKey = serverWallet.address;

// Check if server key is already in authorized keys
const serverKeyExists = authorizedKeys.some(
  (key) => key.publicKey.toLowerCase() === serverPublicKey.toLowerCase(),
);

if (!serverKeyExists) {
  authorizedKeys.push({
    name: "Door Server",
    publicKey: serverPublicKey,
    description: "Auto-generated server key for event access emails",
  });
  console.log(">>> ✅ Server public key added to authorized keys");
}

// Resolve a writable log directory. Defaults to /data (typical mounted
// volume in production); falls back to the app directory in local dev or
// whenever /data isn't writable.
function resolveLogDir() {
  const dir = process.env.LOG_DIR || "/data";
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return dir;
  } catch (error) {
    console.warn(
      `>>> LOG_DIR ${dir} not usable (${error.message}); falling back to ${__dirname}`,
    );
    return __dirname;
  }
}

// Append-only log files: successful accesses and denied attempts.
const LOG_DIR = resolveLogDir();
const ACCESS_LOG_FILE = path.join(LOG_DIR, "door_access.log");
const ERROR_LOG_FILE = path.join(LOG_DIR, "door_errors.log");
console.log(">>> Logging to", LOG_DIR);

function appendLogLine(file, entry) {
  try {
    fs.appendFileSync(file, JSON.stringify(entry) + "\n", "utf8");
  } catch (error) {
    console.error("Failed to write to log file:", file, error.message);
  }
}

/**
 * Read the last `limit` JSON-line entries from a log file (newest last).
 * Returns [] if the file doesn't exist yet.
 */
function readLogEntries(file, limit = 200) {
  try {
    const data = fs.readFileSync(file, "utf8");
    return data
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Failed to read log file:", file, error.message);
    }
    return [];
  }
}

/**
 * Append a successful door access to the access log.
 * @param {string} name - Name of person accessing
 * @param {string} method - Access method (discord, citizenwallet, token, signature, shortcut)
 * @param {Object} metadata - Additional metadata
 */
function logDoorAccess(name, method, metadata = {}) {
  appendLogLine(ACCESS_LOG_FILE, {
    timestamp: new Date().toISOString(),
    status: "granted",
    name,
    method,
    ...metadata,
  });
}

/**
 * Append a denied/failed door attempt to the error log, including the reason
 * access was not granted, so it can be debugged from the /log page.
 * @param {string} name - Name of person attempting access
 * @param {string} reason - Human-readable reason access was denied
 * @param {Object} metadata - Additional metadata (userId, username, roles, ...)
 */
function logDoorError(name, reason, metadata = {}) {
  console.log(">>> Door access denied:", name, "-", reason);
  appendLogLine(ERROR_LOG_FILE, {
    timestamp: new Date().toISOString(),
    status: "denied",
    name,
    reason,
    ...metadata,
  });
}

// Timestamp of the last successful role reload (for the /access page).
let lastReloadAt = null;

const reloadAccessRoles = async () => {
  for (const role of accessRoles) {
    DRY_RUN &&
      console.log(">>> Loading members for role", role.name, role.roleId);
    const members = await getMembers(process.env.DISCORD_GUILD_ID, role.roleId);
    DRY_RUN && console.log(">>> ", members.length, "members found");
    role.memberIds = [];
    for (const member of members) {
      userIdToRoles[member.user.id] = userIdToRoles[member.user.id] || [];
      if (!userIdToRoles[member.user.id].includes(role.roleId)) {
        userIdToRoles[member.user.id].push(role.roleId);
      }
      role.memberIds.push(member.user.id);

      // Cache member display info for pages like /access. Don't clobber
      // richer data set by addUser() when someone actually opens the door.
      if (!users[member.user.id]) {
        users[member.user.id] = {
          displayName:
            member.nick || member.user.global_name || member.user.username,
          username: member.user.username,
          tag: member.user.username,
          avatar: getDiscordAvatarUrl(member),
        };
      }
    }
    if (role.timeRange !== "anytime") {
      const hourRange = role.timeRange.split("-");
      role.hourRange = [parseInt(hourRange[0]), parseInt(hourRange[1])];
    }
  }

  if (DRY_RUN) {
    setTimeout(() => {
      console.log(">>> Testing message");
      handleMessage({
        author: {
          id: "337769522100568076",
          displayName: "Kris",
        },
        channelId: allowedChannelId,
        content: "open",
        reply: (message) => {
          console.log(">>> Reply: ", message);
        },
      });
    }, 1000 * 1);
  }

  lastReloadAt = new Date();
  console.log(">>> Access roles loaded");
};

const daysOfWeek = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function getLocalDateString(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: process.env.TZ || "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function roleDateRangeAllows(role, date = new Date()) {
  if (!role.dateRange) {
    return true;
  }

  const today = getLocalDateString(date);
  return today >= role.dateRange.start && today <= role.dateRange.end;
}

function getOpeningHours(roleId) {
  const role = accessRoles.find((r) => r.roleId === roleId);
  if (!role) {
    return "never";
  }
  let days = "";
  if (!role.dateRange && role.daysOfWeek === "anytime" && role.timeRange === "anytime") {
    return "anytime";
  }
  if (role.daysOfWeek === "anytime") {
    days = "any day";
  } else {
    days = `on ${role.daysOfWeek.join(", ")}`;
  }
  let hours = "";
  if (role.timeRange === "anytime") {
    hours = "anytime";
  } else {
    hours = `between ${role.hourRange[0]} and ${role.hourRange[1]}`;
  }
  const dates = role.dateRange
    ? `from ${role.dateRange.start} to ${role.dateRange.end} `
    : "";
  return `${dates}${days} ${hours}`;
}

/**
 * Whether a role grants access on the given day (date window + day of week),
 * ignoring the hour-of-day restriction. Used by the /access page to list the
 * roles that can open the door today.
 */
function isRoleActiveToday(role, date = new Date()) {
  if (!roleDateRangeAllows(role, date)) {
    return false;
  }
  const currentDay = daysOfWeek[date.getDay()];
  if (role.daysOfWeek !== "anytime" && !role.daysOfWeek.includes(currentDay)) {
    return false;
  }
  return true;
}

/**
 * Explain why a user was denied access, for logging/debugging. Mirrors the
 * logic in hasAccess() but returns a human-readable reason instead of a bool.
 */
function getNoAccessReason(userid, date = new Date()) {
  const userRoles = userIdToRoles[userid];
  if (!userRoles || userRoles.length === 0) {
    return "User has no cached access roles. Either they hold no configured role, or the role was assigned after the last hourly reload (try again after the next reload).";
  }

  const currentDay = daysOfWeek[date.getDay()];
  const currentHour = date.getHours();
  const reasons = [];

  for (const roleId of userRoles) {
    const role = accessRoles.find((r) => r.roleId === roleId);
    if (!role) {
      reasons.push(`Role ${roleId} is not in access_roles.json`);
      continue;
    }
    if (!roleDateRangeAllows(role, date)) {
      reasons.push(
        `${role.name}: outside date window ${role.dateRange.start}–${role.dateRange.end} (today is ${getLocalDateString(date)})`,
      );
    } else if (
      role.daysOfWeek !== "anytime" &&
      !role.daysOfWeek.includes(currentDay)
    ) {
      reasons.push(
        `${role.name}: not allowed on ${currentDay} (allowed: ${role.daysOfWeek.join(", ")})`,
      );
    } else if (
      role.timeRange !== "anytime" &&
      role.hourRange &&
      !(currentHour >= role.hourRange[0] && currentHour <= role.hourRange[1])
    ) {
      reasons.push(
        `${role.name}: current hour ${currentHour}h is outside ${role.hourRange[0]}–${role.hourRange[1]}h`,
      );
    } else {
      reasons.push(`${role.name}: role grants access (unexpected denial)`);
    }
  }

  return reasons.join("; ") || "No matching open role";
}

function hasAccess(userid) {
  const userRoles = userIdToRoles[userid];
  const currentDay = daysOfWeek[new Date().getDay()];
  const currentHour = new Date().getHours();

  const openRoles = accessRoles.filter((r) => {
    // Can this role open the door during its configured date window?
    if (!roleDateRangeAllows(r)) {
      return false;
    }

    // Can this role open the door today?
    if (r.daysOfWeek !== "anytime" && !r.daysOfWeek.includes(currentDay)) {
      return false;
    }

    // Can this role open the door at this hour of the day?
    if (r.timeRange === "anytime") {
      return true;
    }

    if (
      r.hourRange &&
      currentHour >= r.hourRange[0] &&
      currentHour <= r.hourRange[1]
    ) {
      return true;
    }
    return false;
  });

  console.log(
    ">>> openRoles",
    openRoles.map((r) => r.name),
  );
  if (!userRoles || userRoles.length === 0) {
    console.log(">>> User", userid, "has no roles");
    return false;
  }
  if (openRoles.some((r) => r.memberIds.includes(userid))) {
    return true;
  }
  console.log(
    ">>> User",
    userid,
    "has no access",
    "userRoles",
    userRoles,
    "openRoles",
    openRoles,
  );
  return false;
}

reloadAccessRoles();

async function resetPresentToday() {
  const d = new Date();

  if (d.getHours() !== 0) {
    return;
  }

  const today = d.toISOString().split("T")[0].replace(/-/g, "");
  const presentTodayRoleId = process.env.DISCORD_PRESENT_TODAY_ROLE_ID;
  // get list of members of the role
  const members = await getMembers(
    process.env.DISCORD_GUILD_ID,
    presentTodayRoleId,
  );

  console.log(">>> Resetting present today for", members.length, "members");
  for (const member of members) {
    try {
      console.log(
        ">>> Removing role",
        presentTodayRoleId,
        "from",
        member.user.username,
      );
      await removeRole(
        process.env.DISCORD_GUILD_ID,
        presentTodayRoleId,
        member.user.id,
      );
    } catch (error) {
      console.error("Failed to remove role:", error);
    }
  }

  if (presentToday[today]?.length > 0) {
    presentToday[today].length = 0;
  }
}

setInterval(
  () => {
    resetPresentToday();
    reloadAccessRoles();
  },
  1000 * 60 * 60 * 1,
); // reset present today every hour

function pickRandom(array) {
  return array[Math.floor(Math.random() * array.length)];
}

// Pick a random fact from the array based on the score
function pickRandomFact() {
  // The higher the score, the more likely the fact is to be picked
  const totalScore = funFacts.reduce((a, b) => a + b.score, 0);
  const random = Math.random() * totalScore;
  let cumulativeScore = 0;
  for (const fact of funFacts) {
    cumulativeScore += fact.score;
    if (random <= cumulativeScore) {
      return fact.content;
    }
  }
  return funFacts[funFacts.length - 1].content;
}

async function loadFunFacts() {
  console.log(
    ">>> Loading fun facts from channel",
    process.env.DISCORD_FUNFACTS_CHANNEL_ID,
  );
  try {
    const channel = await client.channels.fetch(
      process.env.DISCORD_FUNFACTS_CHANNEL_ID,
    );
    if (!channel?.isTextBased()) return;

    funFacts.length = 0;

    const messages = await channel.messages.fetch({ limit: 100 });
    funFacts.push(
      ...messages
        .filter((m) => m.type === 0)
        .map((m) => {
          const reactionsCount =
            1 +
            m.reactions.cache.map((r) => r.count).reduce((a, b) => a + b, 0);
          // Define a score based on the reactions count and the date of the message
          const daysSinceCreation = Math.ceil(
            (new Date().getTime() - new Date(m.createdTimestamp).getTime()) /
              (1000 * 60 * 60 * 24),
          );
          const score = reactionsCount / daysSinceCreation;

          return {
            content: m.content,
            date: m.createdTimestamp,
            daysSinceCreation,
            score,
          };
        }),
    );
    console.log(">>> ", funFacts.length, "fun facts loaded");
  } catch (error) {
    console.error("Failed to load fun facts:", error.rawError.message);
  }
}

setInterval(
  () => {
    loadFunFacts();
  },
  1000 * 60 * 60 * 24,
); // refresh fun facts every 24 hours

function pickRandomReply(user) {
  const randomFact = pickRandomFact();

  console.log(">>> Random fact", randomFact);

  return `**Fun fact**: ${randomFact}`;
}

// Initialize the bot client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
  ],
});

async function loginToDiscord() {
  const data = await rest.get(Routes.gatewayBot());
  if (data.session_start_limit.remaining > 100) {
    // Log in to Discord
    console.log(">>> Logging in to Discord");
    console.log(
      ">>> Remaining connections:",
      data.session_start_limit.remaining,
    );
    client.login(token);
  } else {
    console.log(
      ">>> Remaining connections:",
      data.session_start_limit.remaining,
    );
    console.log(
      ">>> Reset in",
      Math.ceil(Number(data.session_start_limit.reset_after) / 1000 / 60),
      "minutes",
    );
    setTimeout(
      () => {
        loginToDiscord();
      },
      Math.max(1000 * 60, Number(data.session_start_limit.reset_after)),
    ); // retry in 5 minutes
  }
}

loginToDiscord();

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
  await loadGuild();
  await loadFunFacts();
});

async function handleMessage(message) {
  // Ignore messages from bots
  if (message.author.bot) return;

  // Check if message is in the allowed channel
  if (message.channelId !== allowedChannelId) return;

  // Now you can handle the message
  console.log(`Received message: ${message.content}`);

  // Example: respond to specific messages
  if (message.content.toLowerCase().trim() === "open") {
    // console.log(JSON.stringify(message.author, null, 2));
    try {
      const roles = userIdToRoles[message.author.id];
      if (!roles) {
        logDoorError(
          message.author.displayName || message.author.username,
          getNoAccessReason(message.author.id),
          {
            userId: message.author.id,
            username: message.author.username,
            method: "discord",
          },
        );
        if (DRY_RUN) {
          console.log(
            ">>> DRY RUN: ",
            "No roles found for user",
            message.author.id,
          );
          console.log(">>> DEBUG userIdToRoles", userIdToRoles);
          return;
        }
        message.reply(
          "You don't have access to the Commons Hub Brussels. Become a member to access the door.",
        );
        return;
      }
      const firstRole = accessRoles.find((r) => r.roleId === roles[0]);
      if (hasAccess(message.author.id)) {
        await addUser(message.author, message.guildId);

        logDoorAccess(message.author.displayName, "discord", {
          userId: message.author.id,
          username: message.author.username,
          role: firstRole.name,
        });

        openDoor(message.author.id, client.user.tag);

        const currentHour = new Date().getHours() + 2;
        const isEarlyBird = currentHour < 9;
        const isMorning = currentHour >= 9 && currentHour < 12;
        const isAfternoon = currentHour >= 12 && currentHour < 18;
        const isEvening = currentHour >= 18;

        let greeting = "";

        if (isEarlyBird) {
          greeting = `Good morning early bird! 🐣`;
        } else if (isMorning) {
          greeting = `Good morning ${message.author.displayName}! ☀️`;
        } else if (isAfternoon) {
          greeting = `Good afternoon ${message.author.displayName}! 🌞`;
        } else if (isEvening) {
          greeting = `Good evening ${message.author.displayName}! 🌙`;
        }

        const reply = `${greeting} (${firstRole.description})`;

        if (DRY_RUN) {
          console.log(">>> DRY RUN: ", reply);
          return;
        }
        message.reply(`${reply} \n${pickRandomReply(message.author)}`);
      } else {
        const role = accessRoles.find((r) => r.roleId === roles[0]);
        logDoorError(
          message.author.displayName || message.author.username,
          getNoAccessReason(message.author.id),
          {
            userId: message.author.id,
            username: message.author.username,
            roles,
            method: "discord",
          },
        );
        if (!role) {
          message.reply(
            "You don't have access to the Commons Hub Brussels. Become a member to access the door.",
          );
        } else {
          message.reply(`No access at this time. ${role.description}.`);
        }
        return;
      }
    } catch (error) {
      logDoorError(
        message.author.displayName || message.author.username,
        `Unexpected error: ${error.message}`,
        {
          userId: message.author.id,
          username: message.author.username,
          method: "discord",
        },
      );
      if (DRY_RUN) {
        console.log(">>> DRY RUN: ", error);
        return;
      }
      message.reply(error.message);
    }
  }
}

client.on("messageCreate", handleMessage);

let isDoorOpen = false;

let status_log = {};
const doorlog = [];

async function addUser(user, guildId) {
  users[user.id] = {
    displayName: user?.globalName || user?.displayName || user?.tag,
    username: user.username,
    tag: user.tag,
    avatar:
      typeof user.avatarURL === "function" ? user.avatarURL() : user.avatarURL,
  };

  const presentTodayRoleId = process.env.DISCORD_PRESENT_TODAY_ROLE_ID;
  const today = new Date().toISOString().split("T")[0].replace(/-/g, "");
  presentToday[today] = presentToday[today] || [];
  if (presentTodayRoleId && guildId) {
    if (guild) {
      const member = guild.members.cache.get(user.id);
      if (member) {
        try {
          console.log(
            ">>> Adding ",
            member.displayName,
            "to",
            presentTodayRoleId,
          );
          await member.roles.add(presentTodayRoleId);
          presentToday[today].push(member);
        } catch (error) {
          console.error("Failed to add role:", error);
        }
      } else {
        throw new Error(
          `User ${user.username} (id: ${user.id}) not found in guild`,
        );
      }
    }
  }
}

function openDoor(userid, agent) {
  console.log("Opening door for userid", userid, "with agent", agent);
  isDoorOpen = true;
  doorlog.push({
    timestamp: new Date().toLocaleString("en-GB", {
      timeZone: "Europe/Brussels",
    }),
    userid,
    agent,
  });

  // Set a timer to reset `isDoorOpen` after 4 seconds
  setTimeout(() => {
    isDoorOpen = false;
    console.log("Closing door");
  }, 4000);
}

setInterval(
  () => {
    if (new Date().getHours() === 0) {
      status_log = {};
      console.log(">>> Resetting status log");
    }
  },
  1000 * 60 * 60,
); // reset log every 24h

function getTokenOfTheDay() {
  const today = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const hash = crypto
    .createHash("md5")
    .update([process.env.DISCORD_GUILD_ID, today, SECRET].join(":"))
    .digest("hex");
  return hash;
}

/**
 * Verify signature for event organiser access
 * @param {Object} params - Query parameters from URL
 * @returns {Object} { valid: boolean, error: string, publicKey: string }
 */
function verifyEventOrganizerSignature(params) {
  const {
    name,
    host,
    reason,
    timestamp,
    startTime,
    duration,
    sig,
    secret,
    eventUrl,
  } = params;

  // Check all required parameters are present
  if (
    !name ||
    !host ||
    !reason ||
    !timestamp ||
    !startTime ||
    !duration ||
    !sig
  ) {
    return { valid: false, error: "Missing required parameters" };
  }

  // If SECRET is set and matches, bypass time checks but still verify signature
  const secretBypass = SECRET && secret === SECRET;

  if (!secretBypass) {
    // Verify current time is within validity window
    const eventStartTime = parseInt(startTime); // in seconds
    const eventDuration = parseInt(duration); // in minutes
    const eventEndTime = eventStartTime + eventDuration * 60;

    const now = new Date().getTime() / 1000;
    if (now < eventStartTime - 30 * 60) {
      // 30 minutes before start
      return { valid: false, error: "Event has not started yet" };
    }

    if (now > eventEndTime + 30 * 60) {
      // 30 minutes after end
      return { valid: false, error: "Event access period has expired" };
    }
  }

  // Construct the message that was signed (include eventUrl if present)
  const message = eventUrl
    ? `name=${name}&host=${host}&reason=${reason}&timestamp=${timestamp}&startTime=${startTime}&duration=${duration}&eventUrl=${eventUrl}`
    : `name=${name}&host=${host}&reason=${reason}&timestamp=${timestamp}&startTime=${startTime}&duration=${duration}`;

  try {
    // Recover the public key from the signature
    const recoveredAddress = verifyMessage(message, sig);

    // Check if recovered address is in authorized keys whitelist
    const authorizedKey = authorizedKeys.find(
      (key) => key.publicKey.toLowerCase() === recoveredAddress.toLowerCase(),
    );

    if (!authorizedKey) {
      return { valid: false, error: "Unauthorized public key" };
    }

    return {
      valid: true,
      publicKey: recoveredAddress,
      authorizedName: authorizedKey.name,
      secretBypass,
      eventUrl,
    };
  } catch (error) {
    return { valid: false, error: `Invalid signature: ${error.message}` };
  }
}

function getTodayUsers() {
  const today = new Date().toLocaleDateString("en-GB", {
    timeZone: "Europe/Brussels",
  });
  const todayUsers = new Set(); // Use Set to avoid duplicates

  doorlog.forEach((log) => {
    const logDate = log.timestamp.split(",")[0]; // Get date part only
    if (logDate === today) {
      todayUsers.add(log.userid);
    }
  });

  return Array.from(todayUsers);
}

let guild;
async function loadGuild() {
  if (process.env.DISCORD_GUILD_ID) {
    console.log(">>> Loading guild", process.env.DISCORD_GUILD_ID);
    guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    if (!guild) {
      throw new Error(`Guild ${process.env.DISCORD_GUILD_ID} not found`);
    }
    await guild.members.fetch();
  }
}

// Create dependencies object for routes
const dependencies = {
  verifyEventOrganizerSignature,
  loginWithCitizenWallet,
  openDoor,
  logDoorAccess,
  addUser,
  getTokenOfTheDay,
  sendDiscordMessage,
  community,
  users,
  getTodayUsers,
  isDoorOpen: () => isDoorOpen,
  get guild() {
    return guild;
  },
  SECRET,
  doorlog,
  status_log,
  accessRoles,
  getOpeningHours,
  isRoleActiveToday,
  gitInfo,
  logDoorError,
  getAccessLog: () => readLogEntries(ACCESS_LOG_FILE),
  getErrorLog: () => readLogEntries(ERROR_LOG_FILE),
  LOG_DIR,
  reloadAccessRoles,
  getLastReloadAt: () => lastReloadAt,
};

// Create Express app with all routes
const app = createApp(dependencies);

// Start the server (useful for local development)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app;
