require('dotenv').config();
const http = require('http');
const path = require('path');
const {
  AttachmentBuilder,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  Partials,
} = require('discord.js');
const { generateWallahiImage } = require('./imageGen');
const { countLoseKeywords } = require('./wallahiText');
const { RARITIES, WALLAHIS, getWallahiById, getCollectionBoost } = require('./wallahiCatalog');
const {
  getWallahi,
  setWallahi,
  ensureWallahiExists,
  getXp,
  setXp,
  getGuildLeaderboard,
  getCollection,
  getBonusBoost,
  setBonusBoost,
  getMinigameConfig,
} = require('./storage');
const {
  initializeMinigames,
  initializeGuildMinigame,
  setChannel,
  changeEnabled,
  spawnWallahi,
  modifyScheduledSpawnTime,
  despawnActiveWallahi,
  handleCatch,
} = require('./minigame');

const OWNER_DISCORD_ID = process.env.OWNER_DISCORD_ID;
const WALLAHI_ROLE_NAME = 'Wallahi';
const MAX_WALLAHI_LEVEL = 100;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel],
});

const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    if (req.url === '/' || req.url === '/health') {
      const ready = client.isReady();
      res.writeHead(ready ? 200 : 503, { 'Content-Type': 'text/plain' });
      res.end(ready ? 'WallahisBot is alive and connected' : 'WallahisBot is starting');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  })
  .listen(PORT, () => console.log(`Keep-alive web server listening on port ${PORT}`));

function xpRequiredForLevel(level) {
  if (level <= 25) return level * 5;
  if (level <= 50) return 125 + (level - 25) * 10;
  if (level <= 75) return 375 + (level - 50) * 15;
  return 750 + (level - 75) * 20;
}

const activityData = {};
function getActivity(guildId, userId) {
  if (!activityData[guildId]) activityData[guildId] = {};
  if (!activityData[guildId][userId]) {
    activityData[guildId][userId] = { timestamps: [], lastContent: '', spamUntil: 0 };
  }
  return activityData[guildId][userId];
}

const XP_MIN_WORD_COUNT = 2;
const XP_BASE_AMOUNT = 5;
const XP_PER_CHARS = 5;
const XP_MAX_PER_MESSAGE = 18;
const SPAM_WINDOW_MS = 5000;
const SPAM_MESSAGE_THRESHOLD = 5;
const SPAM_COOLDOWN_MS = 30000;

function calculateMessageXp(length) {
  return Math.min(XP_BASE_AMOUNT + Math.floor(length / XP_PER_CHARS), XP_MAX_PER_MESSAGE);
}

function countWords(content) {
  return content.trim().match(/\S+/g)?.length || 0;
}

const IMAGE_ZERO = path.join(__dirname, 'assets', 'wallahi_0_red.jpg');
const IMAGE_SIXTY_SEVEN = path.join(__dirname, 'assets', 'wallahi_67_blue.jpg');
const IMAGE_HUNDRED = path.join(__dirname, 'assets', 'wallahi_100_gold.jpg');

async function buildWallahiAttachment(count) {
  if (count === 0) return new AttachmentBuilder(IMAGE_ZERO, { name: 'wallahi.jpg' });
  if (count === 67) return new AttachmentBuilder(IMAGE_SIXTY_SEVEN, { name: 'wallahi.jpg' });
  if (count === 100) return new AttachmentBuilder(IMAGE_HUNDRED, { name: 'wallahi.jpg' });
  return new AttachmentBuilder(await generateWallahiImage(count), { name: 'wallahi.jpg' });
}

function isOwner(interaction) {
  return Boolean(OWNER_DISCORD_ID) && interaction.user.id === OWNER_DISCORD_ID;
}

function hasWallahiRole(interaction) {
  return interaction.member?.roles?.cache?.some((role) => role.name === WALLAHI_ROLE_NAME);
}

function formatNumber(value) {
  return Number(value.toFixed(2)).toString();
}

async function denyUnauthorized(interaction) {
  await interaction.reply({ content: 'You are not authorized to use this command.', ephemeral: true });
}

client.once('clientReady', async () => {
  console.log(`Bot online as ${client.user.tag}`);
  if (!OWNER_DISCORD_ID) console.warn('OWNER_DISCORD_ID is not configured.');
  try {
    await initializeMinigames(client);
  } catch (error) {
    console.error('Failed to initialize CATCH WALLAHIS:', error);
  }
});

client.on('guildMemberAdd', async (member) => {
  try {
    await ensureWallahiExists(member.guild.id, member.id);
  } catch (error) {
    console.error('Failed to initialize Wallahi data for a new member:', error);
  }
});

client.on('guildCreate', async (guild) => {
  try {
    await initializeGuildMinigame(client, guild);
  } catch (error) {
    console.error('Failed to restore CATCH WALLAHIS after joining a server:', error);
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  try {
    const content = message.content;
    const guildId = message.guild.id;
    const userId = message.author.id;
    const lossesRequested = countLoseKeywords(content);

    if (lossesRequested > 0) {
      const current = await getWallahi(guildId, userId);
      if (current === 0) return;
      const lost = Math.min(current, lossesRequested);
      const updated = await setWallahi(guildId, userId, current - lost);
      await setXp(guildId, userId, 0);
      const attachment = await buildWallahiAttachment(updated);
      await message.reply({
        content: `${message.author} YOU LOST ${lost} WALLAHI${lost === 1 ? '' : 'S'} xd (${updated})`,
        files: [attachment],
      });
      return;
    }

    const activity = getActivity(guildId, userId);
    const now = Date.now();
    activity.timestamps = activity.timestamps.filter((timestamp) => now - timestamp < SPAM_WINDOW_MS);
    activity.timestamps.push(now);
    if (activity.timestamps.length >= SPAM_MESSAGE_THRESHOLD) {
      activity.spamUntil = now + SPAM_COOLDOWN_MS;
    }

    const trimmedContent = content.trim();
    const repeated = trimmedContent === activity.lastContent;
    activity.lastContent = trimmedContent;
    if (
      now < activity.spamUntil ||
      countWords(trimmedContent) < XP_MIN_WORD_COUNT ||
      repeated
    ) {
      return;
    }

    let level = await getWallahi(guildId, userId);
    if (level >= MAX_WALLAHI_LEVEL) {
      await setXp(guildId, userId, 0);
      return;
    }

    const baseXp = calculateMessageXp(trimmedContent.length);
    const collection = await getCollection(guildId, userId);
    const collectionBoost = getCollectionBoost(collection);
    const bonusBoost = await getBonusBoost(guildId, userId);
    const earnedXp = baseXp * (1 + (collectionBoost + bonusBoost) / 100);
    let xp = (await getXp(guildId, userId)) + earnedXp;
    let requiredForNext = xpRequiredForLevel(level + 1);
    let leveledUp = false;

    while (xp >= requiredForNext && level < MAX_WALLAHI_LEVEL) {
      xp -= requiredForNext;
      level += 1;
      leveledUp = true;
      if (level < MAX_WALLAHI_LEVEL) requiredForNext = xpRequiredForLevel(level + 1);
    }

    if (level >= MAX_WALLAHI_LEVEL) {
      level = MAX_WALLAHI_LEVEL;
      xp = 0;
    }
    await setXp(guildId, userId, xp);

    if (leveledUp) {
      await setWallahi(guildId, userId, level);
      await message.reply({
        content: `${message.author} YOU GAINED A WALLAHI (${level})`,
        files: [await buildWallahiAttachment(level)],
      });
    }
  } catch (error) {
    console.error('Failed to process a message:', error);
  }
});

async function handleCommand(interaction) {
  const { commandName } = interaction;
  const guildId = interaction.guild.id;

  if (['give', 'remove', 'set', 'add', 'despawn'].includes(commandName) && !isOwner(interaction)) {
    return denyUnauthorized(interaction);
  }

  if (commandName === 'give') {
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('quantity');
    if (amount < 1) {
      return interaction.reply({ content: 'Quantity must be at least 1.', ephemeral: true });
    }
    const current = await getWallahi(guildId, target.id);
    if (current + amount > MAX_WALLAHI_LEVEL) {
      return interaction.reply({
        content: `You can't give ${amount} Wallahis to ${target}. The max level is ${MAX_WALLAHI_LEVEL}.`,
        ephemeral: true,
      });
    }
    const updated = await setWallahi(guildId, target.id, current + amount);
    return interaction.reply({ content: `${target} now has ${updated} Wallahis!` });
  }

  if (commandName === 'remove') {
    const target = interaction.options.getUser('user');
    await setWallahi(guildId, target.id, 0);
    await setXp(guildId, target.id, 0);
    return interaction.reply({ content: `${target} now has 0 Wallahis!` });
  }

  if (commandName === 'xp') {
    const level = await getWallahi(guildId, interaction.user.id);
    if (level >= MAX_WALLAHI_LEVEL) {
      await setXp(guildId, interaction.user.id, 0);
      return interaction.reply({ content: `${interaction.user}, you're at max level.` });
    }
    const xp = await getXp(guildId, interaction.user.id);
    return interaction.reply({
      content: `You're at Wallahi level ${level}, with ${formatNumber(xp)}/${xpRequiredForLevel(level + 1)} XP until the next one.`,
    });
  }

  if (commandName === 'wallahis') {
    const current = await getWallahi(guildId, interaction.user.id);
    return interaction.reply({
      content: `${interaction.user} YOU HAVE ${current} WALLAHIS LEFT.`,
      files: [await buildWallahiAttachment(current)],
    });
  }

  if (commandName === 'set') {
    const subcommand = interaction.options.getSubcommand();
    const target = interaction.options.getUser('user');
    if (subcommand === 'level') {
      const amount = interaction.options.getInteger('amount');
      const level = await setWallahi(guildId, target.id, amount);
      await setXp(guildId, target.id, 0);
      return interaction.reply({ content: `${target} is now at Wallahi level ${level}.` });
    }

    const amount = interaction.options.getNumber('amount');
    const level = await getWallahi(guildId, target.id);
    if (level >= MAX_WALLAHI_LEVEL) {
      await setXp(guildId, target.id, 0);
      return interaction.reply({ content: `${target} is already at max level.`, ephemeral: true });
    }
    const required = xpRequiredForLevel(level + 1);
    if (amount > required) {
      return interaction.reply({
        content: `You can't set ${target}'s XP to ${formatNumber(amount)}/${required}.`,
        ephemeral: true,
      });
    }
    if (amount === required) {
      const newLevel = await setWallahi(guildId, target.id, level + 1);
      await setXp(guildId, target.id, 0);
      await interaction.reply({ content: `${target} reached ${required}/${required} XP.` });
      return interaction.followUp({
        content: `${target} YOU GAINED A WALLAHI (${newLevel})`,
        files: [await buildWallahiAttachment(newLevel)],
      });
    }
    await setXp(guildId, target.id, amount);
    return interaction.reply({
      content: `${target} now has ${formatNumber(amount)}/${required} XP at Wallahi level ${level}.`,
    });
  }

  if (commandName === 'add') {
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getNumber('amount');
    const updated = await setBonusBoost(guildId, target.id, amount);
    return interaction.reply({
      content: updated === 0
        ? `The additional XP boost was removed from ${target}.`
        : `${target} now has an additional permanent +${formatNumber(updated)}% XP boost.`,
    });
  }

  if (commandName === 'despawn') {
    const result = await despawnActiveWallahi(client, guildId);
    return interaction.reply({
      content: result.error
        ? result.error
        : `**${result.wallahi?.name || 'The active Wallahi'}** has been despawned.`,
      ephemeral: true,
    });
  }

  if (commandName === 'leaderboard') {
    const entries = (await getGuildLeaderboard(guildId)).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (entries.length === 0) return interaction.reply({ content: 'No one has earned any Wallahis yet.' });
    const lines = await Promise.all(
      entries.map(async ([userId, value], index) => {
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        return `${index + 1}. ${member?.displayName || `Unknown user (${userId})`} — ${value} Wallahis`;
      })
    );
    return interaction.reply({
      embeds: [new EmbedBuilder().setTitle('Wallahis Leaderboard').setDescription(lines.join('\n')).setColor(0xf1c40f)],
    });
  }

  if (commandName === 'collection') {
    const target = interaction.options.getUser('user') || interaction.user;
    const collection = await getCollection(guildId, target.id);
    const owned = new Set(collection);
    const collectionBoost = getCollectionBoost(collection);
    const bonusBoost = await getBonusBoost(guildId, target.id);
    const lines = WALLAHIS.map((wallahi) => {
      const rarity = RARITIES[wallahi.rarity];
      return `${owned.has(wallahi.id) ? '✅' : '⬛'} **${wallahi.name}** — ${rarity.name} (+${wallahi.boostPercent}%)`;
    });
    const embed = new EmbedBuilder()
      .setTitle(`${target.username}'s CATCH WALLAHIS Collection`)
      .setDescription(lines.join('\n'))
      .addFields(
        { name: 'Collected', value: `${collection.length}/${WALLAHIS.length}`, inline: true },
        { name: 'Collection Boost', value: `+${formatNumber(collectionBoost)}%`, inline: true },
        { name: 'Additional Boost', value: `+${formatNumber(bonusBoost)}%`, inline: true },
        { name: 'Total XP Boost', value: `+${formatNumber(collectionBoost + bonusBoost)}%` }
      )
      .setColor(0xf1c40f);
    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'minigame' || commandName === 'minigame-test') {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'spawn') {
      if (!isOwner(interaction)) return denyUnauthorized(interaction);
      await interaction.deferReply({ ephemeral: true });
      const result = await spawnWallahi(client, interaction.guild, {
        forced: true,
        rarity: interaction.options.getString('rarity'),
        wallahiId: interaction.options.getString('wallahi'),
      });
      return interaction.editReply(
        result.error ? result.error : `${result.wallahi.name} was spawned without an @everyone mention.`
      );
    }
    if (subcommand === 'modify-time-spawn') {
      if (!isOwner(interaction)) return denyUnauthorized(interaction);
      const seconds = interaction.options.getInteger('seconds');
      const result = await modifyScheduledSpawnTime(client, guildId, seconds);
      if (result.error) {
        return interaction.reply({ content: result.error, ephemeral: true });
      }
      const rarity = RARITIES[result.wallahi.rarity];
      return interaction.reply({
        content: [
          'The next Wallahi spawn has been rescheduled.',
          `**Wallahi:** ${result.wallahi.name}`,
          `**Rarity:** ${rarity.name}`,
          `**New spawn time:** <t:${Math.floor(result.nextSpawnAt / 1000)}:R>`,
        ].join('\n'),
        ephemeral: true,
      });
    }

    if (!hasWallahiRole(interaction)) {
      return interaction.reply({
        content: `You need the ${WALLAHI_ROLE_NAME} role to use this command.`,
        ephemeral: true,
      });
    }

    if (subcommand === 'channel') {
      const channel = interaction.options.getChannel('channel');
      const result = await setChannel(client, interaction.guild, channel);
      return interaction.reply({
        content: result.error
          ? result.error
          : `CATCH WALLAHIS will now spawn in ${channel}.${result.config.enabled ? ' The minigame is active.' : ' The minigame remains disabled.'}`,
        ephemeral: Boolean(result.error),
      });
    }
    if (subcommand === 'active') {
      const config = await changeEnabled(client, guildId, true);
      return interaction.reply({
        content: config
          ? 'CATCH WALLAHIS is now active.'
          : 'Set a spawn channel before activating the minigame.',
        ephemeral: !config,
      });
    }
    if (subcommand === 'disable') {
      const config = await changeEnabled(client, guildId, false);
      return interaction.reply({
        content: config
          ? 'CATCH WALLAHIS is now disabled. Collections and XP boosts were not changed.'
          : 'No minigame channel has been configured.',
        ephemeral: !config,
      });
    }
    if (subcommand === 'status') {
      const config = await getMinigameConfig(guildId);
      if (!config?.channelId) {
        return interaction.reply({ content: 'CATCH WALLAHIS is disabled and has no channel.', ephemeral: true });
      }
      const nextSpawn = config.enabled && config.nextSpawnAt
        ? `<t:${Math.floor(config.nextSpawnAt / 1000)}:R>`
        : 'Not scheduled';
      const nextWallahi = config.enabled ? getWallahiById(config.nextWallahiId) : null;
      return interaction.reply({
        content: [
          `Status: **${config.enabled ? 'Active' : 'Disabled'}**`,
          `Channel: <#${config.channelId}>`,
          `Next spawn: ${nextSpawn}`,
          `Next Wallahi: ${nextWallahi?.name || 'None'}`,
          `Rarity: ${nextWallahi ? RARITIES[nextWallahi.rarity].name : 'None'}`,
        ].join('\n'),
        ephemeral: true,
      });
    }
  }
}

client.on('interactionCreate', async (interaction) => {
  if (interaction.isAutocomplete()) {
    if (!['minigame', 'minigame-test'].includes(interaction.commandName)) return;
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'wallahi') return;
    const selectedRarity = interaction.options.getString('rarity');
    const query = focused.value.toLowerCase();
    const choices = WALLAHIS.filter(
      (wallahi) =>
        (!selectedRarity || wallahi.rarity === selectedRarity) &&
        wallahi.name.toLowerCase().includes(query)
    )
      .slice(0, 25)
      .map((wallahi) => ({ name: wallahi.name, value: wallahi.id }));
    return interaction.respond(choices).catch((error) => {
      console.error('Failed to provide Wallahi autocomplete:', error);
    });
  }
  if (interaction.isButton() && interaction.customId.startsWith('catch_wallahi:')) {
    return handleCatch(interaction);
  }
  if (!interaction.isChatInputCommand() || !interaction.guild) return;
  try {
    await handleCommand(interaction);
  } catch (error) {
    console.error('Failed to process an interaction:', error);
    const response = { content: 'Something went wrong. Please try again.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(response).catch(() => {});
    else await interaction.reply(response).catch(() => {});
  }
});

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error('Failed to log in to Discord:', error);
});

client.on('error', (error) => console.error('Discord client error:', error));
process.on('unhandledRejection', (reason) => console.error('Unhandled promise rejection:', reason));
