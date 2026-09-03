const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const MAX_WALLAHI_LEVEL = 100;

function wallahiKey(guildId, userId) {
  return `wallahi:${guildId}:${userId}`;
}

function xpKey(guildId, userId) {
  return `xp:${guildId}:${userId}`;
}

// ==========================================
// WALLAHI LEVEL
// ==========================================
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

// Only sets a wallahi value if the user doesn't already have one stored.
// Used when a member joins the server, so returning members keep their old value.
async function ensureWallahiExists(guildId, userId) {
  const exists = await redis.exists(wallahiKey(guildId, userId));
  if (!exists) {
    await redis.set(wallahiKey(guildId, userId), 0);
  }
}

// ==========================================
// XP PROGRESS
// ==========================================
async function getXp(guildId, userId) {
  const value = await redis.get(xpKey(guildId, userId));
  return value === null || value === undefined ? 0 : Number(value);
}

async function setXp(guildId, userId, value) {
  const capped = Math.max(0, Math.round(value));
  await redis.set(xpKey(guildId, userId), capped);
  return capped;
}

// ==========================================
// LEADERBOARD (scans all wallahi entries for a guild)
// ==========================================
async function getGuildLeaderboard(guildId) {
  const entries = [];
  let cursor = 0;

  do {
    const result = await redis.scan(cursor, {
      match: wallahiKey(guildId, '*'),
      count: 100,
    });
    cursor = result[0];
    const keys = result[1];

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

// ==========================================
// WIPE ALL DATA FOR A GUILD (called when the bot leaves/is removed from a server)
// ==========================================
async function wipeGuildData(guildId) {
  for (const pattern of [wallahiKey(guildId, '*'), xpKey(guildId, '*')]) {
    let cursor = 0;
    do {
      const result = await redis.scan(cursor, { match: pattern, count: 100 });
      cursor = result[0];
      const keys = result[1];
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== 0 && cursor !== '0');
  }
}

module.exports = {
  getWallahi,
  setWallahi,
  ensureWallahiExists,
  getXp,
  setXp,
  getGuildLeaderboard,
  wipeGuildData,
};
