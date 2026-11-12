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
const {
  RARITIES,
  WALLAHIS,
  chooseRandomWallahi,
  getWallahiById,
  getCollectionBoost,
} = require('./wallahiCatalog');
const {
  ownsWallahi,
  addWallahiToCollection,
  getCollection,
  getBonusBoost,
  getMinigameConfig,
  setMinigameChannel,
  setMinigameEnabled,
  setNextSpawnAt,
  setNextSpawnSchedule,
  getActiveSpawn,
  setActiveSpawn,
  clearActiveSpawn,
  claimSpawn,
} = require('./storage');

const MIN_SPAWN_DELAY_MS = 11 * 60 * 1000;
const MAX_SPAWN_DELAY_MS = 19 * 60 * 1000;
const SPAWN_LIFETIME_MS = 5 * 60 * 1000;
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

async function updateExpiredSpawnMessage(client, spawn) {
  try {
    const channel = await client.channels.fetch(spawn.channelId);
    const message = await channel.messages.fetch(spawn.messageId);
    const wallahi = getWallahiById(spawn.wallahiId);
    if (!wallahi) {
      await message.edit({ components: [catchButton(spawn.guildId, spawn.id, true)] });
      return;
    }
    const rarity = RARITIES[wallahi.rarity];
    const embed = EmbedBuilder.from(message.embeds[0])
      .setTitle('CATCH WALLAHIS — EXPIRED')
      .setColor(0x2f3136)
      .setFields(
        { name: 'Name', value: wallahi.name, inline: true },
        { name: 'Rarity', value: rarity.name, inline: true },
        { name: 'XP Boost', value: `+${wallahi.boostPercent}%`, inline: true },
        { name: 'Result', value: 'Nobody caught this Wallahi.' }
      );
    const filename = path.basename(wallahi.image);
    embed.setImage(`attachment://${filename}`);
    await message.edit({
      embeds: [embed],
      components: [catchButton(spawn.guildId, spawn.id, true)],
      attachments: [],
      files: [new AttachmentBuilder(wallahi.image, { name: filename })],
    });
  } catch (error) {
    console.error('Failed to update an expired Wallahi spawn:', error);
  }
}

async function expireSpawn(client, guildId, spawnId) {
  const spawn = await getActiveSpawn(guildId);
  if (!spawn || spawn.id !== spawnId) return;
  await updateExpiredSpawnMessage(client, spawn);
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
  const shouldNotifyEveryone = ['mythic', 'secret'].includes(wallahi.rarity);
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
  let nextWallahi = useSavedTime ? getWallahiById(config.nextWallahiId) : null;
  if (!nextSpawnAt || nextSpawnAt <= Date.now()) {
    nextSpawnAt = Date.now() + randomSpawnDelay();
  }
  if (!nextWallahi) nextWallahi = chooseRandomWallahi();
  await setNextSpawnSchedule(guildId, nextSpawnAt, nextWallahi.id);

  timers.set(
    guildId,
    setTimeout(async () => {
      try {
        const guild = await client.guilds.fetch(guildId);
        const result = await spawnWallahi(client, guild, { wallahiId: nextWallahi.id });
        if (result.error) console.error(`Automatic spawn skipped in guild ${guildId}: ${result.error}`);
      } catch (error) {
        console.error(`Automatic spawn failed in guild ${guildId}:`, error);
      } finally {
        await planNextSpawn(client, guildId, false);
      }
    }, Math.max(0, nextSpawnAt - Date.now()))
  );
}

async function modifyScheduledSpawnTime(client, guildId, seconds) {
  const config = await getMinigameConfig(guildId);
  if (!config?.channelId) return { error: 'No minigame channel has been configured.' };
  if (!config.enabled) return { error: 'CATCH WALLAHIS is currently disabled.' };
  const wallahi = getWallahiById(config.nextWallahiId);
  if (!config.nextSpawnAt || !wallahi) {
    return { error: 'There is no scheduled Wallahi spawn to modify.' };
  }

  const nextSpawnAt = Date.now() + seconds * 1000;
  await setNextSpawnAt(guildId, nextSpawnAt);
  await planNextSpawn(client, guildId, true);
  return { wallahi, nextSpawnAt };
}

async function changeScheduledWallahi(client, guildId, rarityId, wallahiId) {
  const config = await getMinigameConfig(guildId);
  if (!config?.channelId) return { error: 'No minigame channel has been configured.' };
  if (!config.enabled) return { error: 'CATCH WALLAHIS is currently disabled.' };
  if (!config.nextSpawnAt || !config.nextWallahiId) {
    return { error: 'There is no scheduled Wallahi spawn to modify.' };
  }

  const previousWallahi = getWallahiById(config.nextWallahiId);
  const nextWallahi = getWallahiById(wallahiId);
  if (!nextWallahi || nextWallahi.rarity !== rarityId) {
    return { error: 'The selected Wallahi could not be found.' };
  }
  if (previousWallahi?.id === nextWallahi.id) {
    return { error: 'This Wallahi is already selected for the next spawn.' };
  }

  await setNextSpawnSchedule(guildId, config.nextSpawnAt, nextWallahi.id);
  await planNextSpawn(client, guildId, true);
  return {
    previousWallahi,
    nextWallahi,
    nextSpawnAt: Number(config.nextSpawnAt),
  };
}

async function despawnActiveWallahi(client, guildId) {
  const spawn = await getActiveSpawn(guildId);
  if (!spawn) {
    return { error: 'There is no active Wallahi available to despawn.' };
  }
  if (spawn.expiresAt <= Date.now()) {
    await expireSpawn(client, guildId, spawn.id);
    return { error: 'There is no active Wallahi available to despawn.' };
  }
  const wallahi = getWallahiById(spawn.wallahiId);
  await expireSpawn(client, guildId, spawn.id);
  return { wallahi };
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
    const collection = await getCollection(guildId, interaction.user.id);
    const collectionBoost = getCollectionBoost(collection);
    const bonusBoost = await getBonusBoost(guildId, interaction.user.id);
    const collectedCount = collection.filter((wallahiId) => getWallahiById(wallahiId)).length;
    const rarity = RARITIES[wallahi.rarity];
    const caughtEmbed = EmbedBuilder.from(interaction.message.embeds[0])
      .setTitle('CATCH WALLAHIS — CAUGHT')
      .setFields(
        { name: 'Name', value: wallahi.name, inline: true },
        { name: 'Rarity', value: rarity.name, inline: true },
        { name: 'XP Boost', value: `+${wallahi.boostPercent}%`, inline: true },
        { name: 'Caught By', value: `${interaction.user}` }
      );
    const filename = path.basename(wallahi.image);
    caughtEmbed.setImage(`attachment://${filename}`);
    await interaction.message
      .edit({
        embeds: [caughtEmbed],
        components: [catchButton(guildId, spawn.id, true)],
        attachments: [],
        files: [new AttachmentBuilder(wallahi.image, { name: filename })],
      })
      .catch((error) => console.error('Failed to update a caught Wallahi panel:', error));
    return interaction.reply({
      content: [
        `${interaction.user} caught **${wallahi.name}**!`,
        `**Permanent boost earned:** +${wallahi.boostPercent}%`,
        `**Collection boost:** +${collectionBoost}%`,
        `**Additional boost:** +${bonusBoost}%`,
        `**Total XP boost:** +${collectionBoost + bonusBoost}%`,
        `**Collection progress:** ${collectedCount}/${WALLAHIS.length}`,
      ].join('\n'),
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
  modifyScheduledSpawnTime,
  changeScheduledWallahi,
  despawnActiveWallahi,
  setChannel,
  changeEnabled,
  spawnWallahi,
  handleCatch,
};
