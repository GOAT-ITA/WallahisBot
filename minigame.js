const crypto = require('crypto');
const path = require('path');
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionsBitField,
} = require('discord.js');
const { RARITIES, chooseRandomWallahi, getWallahiById } = require('./wallahiCatalog');
const {
  ownsWallahi,
  addWallahiToCollection,
  getMinigameConfig,
  setMinigameChannel,
  setMinigameEnabled,
  setNextSpawnAt,
  getActiveSpawn,
  setActiveSpawn,
  clearActiveSpawn,
  claimSpawn,
} = require('./storage');

const MIN_SPAWN_DELAY_MS = 20 * 60 * 1000;
const MAX_SPAWN_DELAY_MS = 40 * 60 * 1000;
const SPAWN_LIFETIME_MS = 10 * 60 * 1000;
const timers = new Map();
const expiryTimers = new Map();

function randomSpawnDelay() {
  return MIN_SPAWN_DELAY_MS + Math.floor(Math.random() * (MAX_SPAWN_DELAY_MS - MIN_SPAWN_DELAY_MS));
}

function catchButton(guildId, spawnId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`catch_wallahi:${guildId}:${spawnId}`)
      .setLabel('CATCH')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled)
  );
}

function clearTimer(map, guildId) {
  const timer = map.get(guildId);
  if (timer) clearTimeout(timer);
  map.delete(guildId);
}

async function disableSpawnMessage(client, spawn) {
  try {
    const channel = await client.channels.fetch(spawn.channelId);
    const message = await channel.messages.fetch(spawn.messageId);
    await message.edit({ components: [catchButton(spawn.guildId, spawn.id, true)] });
  } catch (error) {
    console.error('Failed to disable an expired Wallahi spawn:', error);
  }
}

async function expireSpawn(client, guildId, spawnId) {
  const spawn = await getActiveSpawn(guildId);
  if (!spawn || spawn.id !== spawnId) return;
  await disableSpawnMessage(client, spawn);
  await clearActiveSpawn(guildId);
  clearTimer(expiryTimers, guildId);
}

function scheduleExpiry(client, spawn) {
  clearTimer(expiryTimers, spawn.guildId);
  const delay = Math.max(0, spawn.expiresAt - Date.now());
  expiryTimers.set(
    spawn.guildId,
    setTimeout(() => expireSpawn(client, spawn.guildId, spawn.id).catch(console.error), delay)
  );
}

async function validateSpawnChannel(guild, channel) {
  if (!channel?.isTextBased() || !channel.isSendable()) return 'The configured channel is not writable.';
  const member = guild.members.me;
  const permissions = channel.permissionsFor(member);
  const required = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.EmbedLinks,
    PermissionsBitField.Flags.AttachFiles,
  ];
  if (!permissions?.has(required)) {
    return 'I need View Channel, Send Messages, Embed Links, and Attach Files permissions.';
  }
  return null;
}

async function spawnWallahi(client, guild, options = {}) {
  const config = await getMinigameConfig(guild.id);
  if (!config?.channelId) return { error: 'No minigame channel has been configured.' };
  if (!config.enabled && !options.forced) return { error: 'The minigame is disabled.' };

  const existing = await getActiveSpawn(guild.id);
  if (existing && existing.expiresAt > Date.now()) {
    return { error: 'A Wallahi is already waiting to be caught.' };
  }
  if (existing) await clearActiveSpawn(guild.id);

  const channel = await guild.channels.fetch(config.channelId).catch(() => null);
  const channelError = await validateSpawnChannel(guild, channel);
  if (channelError) return { error: channelError };

  const wallahi = chooseRandomWallahi(options.rarity, options.wallahiId);
  if (!wallahi) return { error: 'No Wallahi matches the requested selection.' };
  const rarity = RARITIES[wallahi.rarity];
  const spawnId = crypto.randomUUID();
  const filename = path.basename(wallahi.image);
  const article = rarity.name === 'Epic' ? 'An' : 'A';
  const shouldNotifyEveryone = !options.forced && ['mythic', 'secret'].includes(wallahi.rarity);
  const content = `${shouldNotifyEveryone ? '@everyone ' : ''}${article} ${rarity.name} Wallahi has spawned!`;
  const embed = new EmbedBuilder()
    .setTitle('CATCH WALLAHIS')
    .setColor(rarity.color)
    .addFields(
      { name: 'Name', value: wallahi.name, inline: true },
      { name: 'Rarity', value: rarity.name, inline: true },
      { name: 'XP Boost', value: `+${wallahi.boostPercent}%`, inline: true }
    )
    .setImage(`attachment://${filename}`);

  const message = await channel.send({
    content,
    embeds: [embed],
    files: [new AttachmentBuilder(wallahi.image, { name: filename })],
    components: [catchButton(guild.id, spawnId)],
    allowedMentions: { parse: shouldNotifyEveryone ? ['everyone'] : [] },
  });

  const spawn = {
    id: spawnId,
    guildId: guild.id,
    channelId: channel.id,
    messageId: message.id,
    wallahiId: wallahi.id,
    expiresAt: Date.now() + SPAWN_LIFETIME_MS,
  };
  await setActiveSpawn(guild.id, spawn);
  scheduleExpiry(client, spawn);
  return { wallahi, message };
}

async function planNextSpawn(client, guildId, useSavedTime = false) {
  clearTimer(timers, guildId);
  const config = await getMinigameConfig(guildId);
  if (!config?.enabled || !config.channelId) return;

  let nextSpawnAt = useSavedTime ? Number(config.nextSpawnAt) : 0;
  if (!nextSpawnAt || nextSpawnAt <= Date.now()) {
    nextSpawnAt = Date.now() + randomSpawnDelay();
    await setNextSpawnAt(guildId, nextSpawnAt);
  }

  timers.set(
    guildId,
    setTimeout(async () => {
      try {
        const guild = await client.guilds.fetch(guildId);
        const result = await spawnWallahi(client, guild);
        if (result.error) console.error(`Automatic spawn skipped in guild ${guildId}: ${result.error}`);
      } catch (error) {
        console.error(`Automatic spawn failed in guild ${guildId}:`, error);
      } finally {
        await planNextSpawn(client, guildId, false);
      }
    }, Math.max(0, nextSpawnAt - Date.now()))
  );
}

async function initializeGuildMinigame(client, guild) {
  const spawn = await getActiveSpawn(guild.id);
  if (spawn) {
    if (spawn.expiresAt > Date.now()) scheduleExpiry(client, spawn);
    else await expireSpawn(client, guild.id, spawn.id);
  }
  await planNextSpawn(client, guild.id, true);
}

async function initializeMinigames(client) {
  for (const guild of client.guilds.cache.values()) {
    await initializeGuildMinigame(client, guild);
  }
}

async function setChannel(client, guild, channel) {
  const channelError = await validateSpawnChannel(guild, channel);
  if (channelError) return { error: channelError };
  const config = await setMinigameChannel(guild.id, channel.id);
  if (config.enabled) await planNextSpawn(client, guild.id, false);
  return { config };
}

async function changeEnabled(client, guildId, enabled) {
  const config = await setMinigameEnabled(guildId, enabled);
  if (!config) return null;
  if (enabled) await planNextSpawn(client, guildId, false);
  else clearTimer(timers, guildId);
  return config;
}

async function handleCatch(interaction) {
  const [, guildId, spawnId] = interaction.customId.split(':');
  if (interaction.guildId !== guildId) {
    return interaction.reply({ content: 'This catch button is invalid.', ephemeral: true });
  }

  try {
    const spawn = await getActiveSpawn(guildId);
    if (!spawn || spawn.id !== spawnId || spawn.expiresAt <= Date.now()) {
      return interaction.reply({ content: 'This Wallahi is no longer available.', ephemeral: true });
    }
    const wallahi = getWallahiById(spawn.wallahiId);
    if (!wallahi) {
      return interaction.reply({ content: 'This Wallahi is no longer available.', ephemeral: true });
    }
    if (await ownsWallahi(guildId, interaction.user.id, wallahi.id)) {
      return interaction.reply({
        content: 'You already own this Wallahi. Let someone else catch it!',
        ephemeral: true,
      });
    }

    const claimed = await claimSpawn(guildId, spawn.id, interaction.user.id, 24 * 60 * 60);
    if (!claimed) {
      return interaction.reply({ content: 'This Wallahi has already been caught.', ephemeral: true });
    }

    await addWallahiToCollection(guildId, interaction.user.id, wallahi.id);
    await clearActiveSpawn(guildId);
    clearTimer(expiryTimers, guildId);
    await interaction.message.edit({ components: [catchButton(guildId, spawn.id, true)] });
    return interaction.reply({
      content: `${interaction.user} caught **${wallahi.name}**!`,
      allowedMentions: { users: [interaction.user.id] },
    });
  } catch (error) {
    console.error('Failed to catch a Wallahi:', error);
    if (!interaction.replied && !interaction.deferred) {
      return interaction.reply({
        content: 'Your collection could not be updated. Please try again.',
        ephemeral: true,
      });
    }
  }
}

module.exports = {
  initializeMinigames,
  initializeGuildMinigame,
  planNextSpawn,
  setChannel,
  changeEnabled,
  spawnWallahi,
  handleCatch,
};
