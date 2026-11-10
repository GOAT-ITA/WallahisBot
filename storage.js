const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const MAX_WALLAHI_LEVEL = 100;
const wallahiKey = (guildId, userId) => `wallahi:${guildId}:${userId}`;
const xpKey = (guildId, userId) => `xp:${guildId}:${userId}`;
const collectionKey = (guildId, userId) => `collection:${guildId}:${userId}`;
const bonusBoostKey = (guildId, userId) => `boost:${guildId}:${userId}`;
const minigameConfigKey = (guildId) => `minigame:config:${guildId}`;
const activeSpawnKey = (guildId) => `minigame:spawn:${guildId}`;
const spawnClaimKey = (guildId, spawnId) => `minigame:claim:${guildId}:${spawnId}`;

async function getWallahi(guildId, userId) {
  const value = await redis.get(wallahiKey(guildId, userId));
  if (value === null || value === undefined) return 0;
  return Math.min(MAX_WALLAHI_LEVEL, Math.max(0, Number(value) || 0));
}

async function setWallahi(guildId, userId, value) {
  const capped = Math.min(MAX_WALLAHI_LEVEL, Math.max(0, Math.round(value)));
  await redis.set(wallahiKey(guildId, userId), capped);
  return capped;
}

async function ensureWallahiExists(guildId, userId) {
  if (!(await redis.exists(wallahiKey(guildId, userId)))) {
    await redis.set(wallahiKey(guildId, userId), 0);
  }
}

async function getXp(guildId, userId) {
  const value = await redis.get(xpKey(guildId, userId));
  return value === null || value === undefined ? 0 : Number(value) || 0;
}

async function setXp(guildId, userId, value) {
  const capped = Math.max(0, Math.round(Number(value) * 100) / 100);
  await redis.set(xpKey(guildId, userId), capped);
  return capped;
}

async function getGuildLeaderboard(guildId) {
  const entries = [];
  let cursor = 0;
  do {
    const [nextCursor, keys] = await redis.scan(cursor, {
      match: wallahiKey(guildId, '*'),
      count: 100,
    });
    cursor = nextCursor;
    if (keys.length > 0) {
      const values = await redis.mget(...keys);
      keys.forEach((key, index) => {
        const userId = key.split(':')[2];
        const value = Number(values[index]) || 0;
        if (value > 0) entries.push([userId, value]);
      });
    }
  } while (cursor !== 0 && cursor !== '0');
  return entries;
}

async function getCollection(guildId, userId) {
  return (await redis.smembers(collectionKey(guildId, userId))) || [];
}

async function ownsWallahi(guildId, userId, wallahiId) {
  return Boolean(await redis.sismember(collectionKey(guildId, userId), wallahiId));
}

async function addWallahiToCollection(guildId, userId, wallahiId) {
  return redis.sadd(collectionKey(guildId, userId), wallahiId);
}

async function getBonusBoost(guildId, userId) {
  const value = await redis.get(bonusBoostKey(guildId, userId));
  return value === null || value === undefined ? 0 : Number(value) || 0;
}

async function setBonusBoost(guildId, userId, amount) {
  const normalized = Math.max(0, Math.round(Number(amount) * 100) / 100);
  if (normalized === 0) {
    await redis.del(bonusBoostKey(guildId, userId));
    return 0;
  }
  await redis.set(bonusBoostKey(guildId, userId), normalized);
  return normalized;
}

async function getMinigameConfig(guildId) {
  return redis.get(minigameConfigKey(guildId));
}

async function setMinigameChannel(guildId, channelId) {
  const current = await getMinigameConfig(guildId);
  const config = {
    channelId,
    enabled: current ? Boolean(current.enabled) : true,
    nextSpawnAt: current?.nextSpawnAt || null,
  };
  await redis.set(minigameConfigKey(guildId), config);
  return config;
}

async function setMinigameEnabled(guildId, enabled) {
  const current = await getMinigameConfig(guildId);
  if (!current?.channelId) return null;
  const config = { ...current, enabled: Boolean(enabled) };
  await redis.set(minigameConfigKey(guildId), config);
  return config;
}

async function setNextSpawnAt(guildId, nextSpawnAt) {
  const current = await getMinigameConfig(guildId);
  if (!current) return null;
  const config = { ...current, nextSpawnAt };
  await redis.set(minigameConfigKey(guildId), config);
  return config;
}

async function getActiveSpawn(guildId) {
  return redis.get(activeSpawnKey(guildId));
}

async function setActiveSpawn(guildId, spawn) {
  await redis.set(activeSpawnKey(guildId), spawn);
}

async function clearActiveSpawn(guildId) {
  await redis.del(activeSpawnKey(guildId));
}

async function claimSpawn(guildId, spawnId, userId, ttlSeconds) {
  const result = await redis.set(spawnClaimKey(guildId, spawnId), userId, {
    nx: true,
    ex: ttlSeconds,
  });
  return result === 'OK';
}

module.exports = {
  getWallahi,
  setWallahi,
  ensureWallahiExists,
  getXp,
  setXp,
  getGuildLeaderboard,
  getCollection,
  ownsWallahi,
  addWallahiToCollection,
  getBonusBoost,
  setBonusBoost,
  getMinigameConfig,
  setMinigameChannel,
  setMinigameEnabled,
  setNextSpawnAt,
  getActiveSpawn,
  setActiveSpawn,
  clearActiveSpawn,
  claimSpawn,
};
