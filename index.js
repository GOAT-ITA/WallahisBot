require('dotenv').config();
const http = require('http');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  AttachmentBuilder,
} = require('discord.js');
const { generateWallahiImage } = require('./imageGen');
const {
  getWallahi,
  setWallahi,
  ensureWallahiExists,
  getXp,
  setXp,
  getGuildLeaderboard,
  wipeGuildData,
} = require('./storage');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel],
});

// Small HTTP endpoint for Render Web Service keep-alive checks.
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    if (req.url === '/' || req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('WallahisBot is alive');
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  })
  .listen(PORT, () => {
    console.log(`Keep-alive web server listening on port ${PORT}`);
  });

// Wallahi levels and XP are now persisted in Redis (see storage.js).
// Only short-lived chat activity (for spam detection) stays in memory below,
// since it doesn't need to survive a restart.

// ==========================================
// XP / LEVEL PROGRESSION SYSTEM
// ==========================================

// XP required to go from (level) to (level + 1). Grows gradually, harder at higher levels.
function xpRequiredForLevel(level) {
  return Math.round(30 + 4 * Math.pow(level, 1.5));
}

// ==========================================
// CHAT ACTIVITY TRACKING (spam detection, per user per guild)
// Structure: activityData["guildId"]["userId"] = { timestamps, lastContent, spamUntil }
// ==========================================
const activityData = {};

function getActivity(guildId, userId) {
  if (!activityData[guildId]) activityData[guildId] = {};
  if (!activityData[guildId][userId]) {
    activityData[guildId][userId] = { timestamps: [], lastContent: '', spamUntil: 0 };
  }
  return activityData[guildId][userId];
}

const XP_MIN_MESSAGE_LENGTH = 5; // messages shorter than this earn no xp
const XP_BASE_AMOUNT = 5;
const XP_PER_CHARS = 15; // +1 xp every 15 characters
const XP_MAX_PER_MESSAGE = 25;

const SPAM_WINDOW_MS = 5000; // look at the last 5 seconds
const SPAM_MESSAGE_THRESHOLD = 5; // 5+ messages in that window counts as spam
const SPAM_COOLDOWN_MS = 30000; // no xp for 30 seconds after spam is detected

function calculateMessageXp(length) {
  const raw = XP_BASE_AMOUNT + Math.floor(length / XP_PER_CHARS);
  return Math.min(raw, XP_MAX_PER_MESSAGE);
}

// ==========================================
// KEYWORDS
// ==========================================
// - matches even when glued inside other text (no word boundaries required)
// - collapses stretched-out repeated letters (e.g. "wallahiiiiiis")
// - catches scrambled letter order (e.g. "WallHai") via an anagram check on a sliding window
function collapseRepeatedLetters(str) {
  return str.replace(/(.)\1+/g, '$1');
}

function sortLetters(str) {
  return str.split('').sort().join('');
}

const LOSE_KEYWORD_DEFS = ['wallah', 'wallahi', 'wallahis'].map((word) => {
  const collapsed = collapseRepeatedLetters(word);
  return { length: collapsed.length, sorted: sortLetters(collapsed) };
});

function containsLoseKeyword(content) {
  const words = content.toLowerCase().match(/[a-z]+/g);
  if (!words) return false;

  for (const rawWord of words) {
    const letters = collapseRepeatedLetters(rawWord);

    for (const { length, sorted } of LOSE_KEYWORD_DEFS) {
      if (letters.length < length) continue;
      for (let i = 0; i <= letters.length - length; i++) {
        const window = letters.slice(i, i + length);
        if (sortLetters(window) === sorted) return true;
      }
    }
  }

  return false;
}

// Static reference images (sent as-is, no dynamic number overlay)
const IMAGE_ZERO = path.join(__dirname, 'assets', 'wallahi_0_red.jpg');
const IMAGE_SIXTY_SEVEN = path.join(__dirname, 'assets', 'wallahi_67_blue.jpg');
const IMAGE_HUNDRED = path.join(__dirname, 'assets', 'wallahi_100_gold.jpg');

const WALLAHI_ROLE_NAME = 'Wallahi';

/**
 * Builds the right attachment for a given wallahi count:
 * - exactly 0 -> static red image
 * - exactly 67 -> static blue milestone image
 * - exactly 100 -> static gold image
 * - anything else -> dynamically generated template with the number overlaid
 */
async function buildWallahiAttachment(count) {
  if (count === 0) {
    return new AttachmentBuilder(IMAGE_ZERO, { name: 'wallahi.jpg' });
  }
  if (count === 67) {
    return new AttachmentBuilder(IMAGE_SIXTY_SEVEN, { name: 'wallahi.jpg' });
  }
  if (count === 100) {
    return new AttachmentBuilder(IMAGE_HUNDRED, { name: 'wallahi.jpg' });
  }
  const buffer = await generateWallahiImage(count);
  return new AttachmentBuilder(buffer, { name: 'wallahi.jpg' });
}

// ==========================================
// READY
// ==========================================
client.once('clientReady', () => {
  console.log(`✅ Bot online come ${client.user.tag}`);
});

// ==========================================
// NEW MEMBER -> initialize to 0 if not already set
// ==========================================
client.on('guildMemberAdd', async (member) => {
  try {
    await ensureWallahiExists(member.guild.id, member.id);
  } catch (err) {
    console.error('Failed to initialize wallahi for new member:', err);
  }
});

// ==========================================
// BOT REMOVED FROM A SERVER -> wipe that server's data
// ==========================================
client.on('guildDelete', async (guild) => {
  try {
    await wipeGuildData(guild.id);
    console.log(`Wiped wallahi data for guild ${guild.id} (${guild.name || 'unknown'})`);
  } catch (err) {
    console.error('Failed to wipe data after leaving guild:', err);
  }
});

// ==========================================
// MESSAGES -> XP progression + losing wallahis
// ==========================================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return; // ignore DMs

  const content = message.content;
  const guildId = message.guild.id;
  const userId = message.author.id;

  // Saying "wallah/wallahi/wallahis" makes you lose a wallahi and resets that level's xp progress
  if (containsLoseKeyword(content)) {
    const current = await getWallahi(guildId, userId);
    if (current === 0) {
      // already at 0, do nothing
      return;
    }
    const updated = await setWallahi(guildId, userId, current - 1);
    await setXp(guildId, userId, 0);
    const attachment = await buildWallahiAttachment(updated);
    await message.reply({
      content: `${message.author} YOU LOST A WALLAHI xd (${updated})`,
      files: [attachment],
    });
    return;
  }

  // Otherwise, this message might earn xp towards the next wallahi level
  const activity = getActivity(guildId, userId);
  const now = Date.now();

  // Spam detection: too many messages in a short window triggers a temporary xp cooldown
  activity.timestamps = activity.timestamps.filter((t) => now - t < SPAM_WINDOW_MS);
  activity.timestamps.push(now);
  if (activity.timestamps.length >= SPAM_MESSAGE_THRESHOLD) {
    activity.spamUntil = now + SPAM_COOLDOWN_MS;
  }

  const trimmedContent = content.trim();
  const isSpamCoolingDown = now < activity.spamUntil;
  const isTooShort = trimmedContent.length < XP_MIN_MESSAGE_LENGTH;
  const isRepeatedMessage = trimmedContent === activity.lastContent;

  activity.lastContent = trimmedContent;

  if (isSpamCoolingDown || isTooShort || isRepeatedMessage) return;

  const earnedXp = calculateMessageXp(trimmedContent.length);
  if (earnedXp <= 0) return;

  let level = await getWallahi(guildId, userId);
  let xp = (await getXp(guildId, userId)) + earnedXp;
  let requiredForNext = xpRequiredForLevel(level + 1);
  let leveledUp = false;

  while (xp >= requiredForNext) {
    xp -= requiredForNext;
    level += 1;
    leveledUp = true;
    requiredForNext = xpRequiredForLevel(level + 1);
  }

  await setXp(guildId, userId, xp);

  if (leveledUp) {
    await setWallahi(guildId, userId, level);
    const attachment = await buildWallahiAttachment(level);
    await message.reply({
      content: `${message.author} YOU GAINED A WALLAHI (${level})`,
      files: [attachment],
    });
  }
});

// ==========================================
// SLASH COMMANDS
// ==========================================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) return;

  const { commandName } = interaction;

  // Controllo ruolo "Wallahi" per i comandi admin
  const hasWallahiRole = interaction.member.roles.cache.some(
    (role) => role.name === WALLAHI_ROLE_NAME
  );

  if (commandName === 'give') {
    if (!hasWallahiRole) {
      return interaction.reply({
        content: `You need the ${WALLAHI_ROLE_NAME} role to use this command.`,
        ephemeral: true,
      });
    }

    const targetUser = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('quantity');

    const current = await getWallahi(interaction.guild.id, targetUser.id);
    const updated = await setWallahi(interaction.guild.id, targetUser.id, current + amount);

    return interaction.reply({
      content: `${targetUser} has now ${updated} wallahis!`,
    });
  }

  if (commandName === 'remove') {
    if (!hasWallahiRole) {
      return interaction.reply({
        content: `You need the ${WALLAHI_ROLE_NAME} role to use this command.`,
        ephemeral: true,
      });
    }

    const targetUser = interaction.options.getUser('user');
    await setWallahi(interaction.guild.id, targetUser.id, 0);
    await setXp(interaction.guild.id, targetUser.id, 0);

    return interaction.reply({
      content: `${targetUser} has now 0 wallahis!`,
    });
  }

  if (commandName === 'xp') {
    const level = await getWallahi(interaction.guild.id, interaction.user.id);
    const xp = await getXp(interaction.guild.id, interaction.user.id);
    const required = xpRequiredForLevel(level + 1);

    return interaction.reply({
      content: `You're at wallahi level ${level}, with ${xp}/${required} xp until the next one.`,
    });
  }

  if (commandName === 'wallahis') {
    const subcommandName = interaction.options.getSubcommand();

    if (subcommandName === 'left') {
      const current = await getWallahi(interaction.guild.id, interaction.user.id);
      const attachment = await buildWallahiAttachment(current);

      return interaction.reply({
        content: `${interaction.user} YOU HAVE ${current} WALLAHIS LEFT.`,
        files: [attachment],
      });
    }
  }

  if (commandName === 'set') {
    const subcommandName = interaction.options.getSubcommand();

    if (subcommandName === 'xp') {
      if (!hasWallahiRole) {
        return interaction.reply({
          content: `You need the ${WALLAHI_ROLE_NAME} role to use this command.`,
          ephemeral: true,
        });
      }

      const targetUser = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      const currentLevel = await getWallahi(interaction.guild.id, targetUser.id);
      const required = xpRequiredForLevel(currentLevel + 1);

      if (amount > required) {
        return interaction.reply({
          content: `You can't set ${targetUser}'s xp to ${amount}/${required}. The maximum for wallahi level ${currentLevel} is ${required}.`,
          ephemeral: true,
        });
      }

      if (amount === required) {
        const newLevel = await setWallahi(interaction.guild.id, targetUser.id, currentLevel + 1);
        await setXp(interaction.guild.id, targetUser.id, 0);
        const attachment = await buildWallahiAttachment(newLevel);

        await interaction.reply({
          content: `${targetUser}, you're now at ${required}/${required} xp at wallahi ${currentLevel}.`,
        });

        return interaction.followUp({
          content: `${targetUser} YOU GAINED A WALLAHI (${newLevel})`,
          files: [attachment],
        });
      }

      const updatedXp = await setXp(interaction.guild.id, targetUser.id, amount);

      return interaction.reply({
        content: `${targetUser}, you're now at ${updatedXp}/${required} xp at wallahi ${currentLevel}.`,
      });
    }

    if (subcommandName === 'level') {
      if (!hasWallahiRole) {
        return interaction.reply({
          content: `You need the ${WALLAHI_ROLE_NAME} role to use this command.`,
          ephemeral: true,
        });
      }

      const targetUser = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      const updatedLevel = await setWallahi(interaction.guild.id, targetUser.id, amount);
      await setXp(interaction.guild.id, targetUser.id, 0);
      const required = xpRequiredForLevel(updatedLevel + 1);

      return interaction.reply({
        content: `${targetUser}, you're now at level ${updatedLevel} with 0/${required} xp.`,
      });
    }
  }

  if (commandName === 'leaderboard') {
    const entries = (await getGuildLeaderboard(interaction.guild.id))
      .sort((a, b) => b[1] - a[1]) // ordine fisso, decrescente
      .slice(0, 5);

    if (entries.length === 0) {
      return interaction.reply({
        content: 'No one has earned any wallahis in this server yet.',
      });
    }

    const lines = await Promise.all(
      entries.map(async ([userId, value], index) => {
        let displayName;
        try {
          const member = await interaction.guild.members.fetch(userId);
          displayName = member.displayName;
        } catch {
          displayName = `Unknown user (${userId})`;
        }
        return `${index + 1}. ${displayName} — ${value} wallahis`;
      })
    );

    const embed = new EmbedBuilder()
      .setTitle('Wallahis Leaderboard')
      .setDescription(lines.join('\n'))
      .setColor(0xf1c40f);

    return interaction.reply({ embeds: [embed] });
  }
});

client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error('Failed to log in to Discord:', err);
});

client.on('error', (err) => {
  console.error('Discord client error:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
