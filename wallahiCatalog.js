const path = require('path');

const RARITIES = {
  common: { name: 'Common', weight: 50, color: 0x95a5a6 },
  rare: { name: 'Rare', weight: 27, color: 0x3498db },
  epic: { name: 'Epic', weight: 15, color: 0x9b59b6 },
  legendary: { name: 'Legendary', weight: 7.4, color: 0xe67e22 },
  mythic: { name: 'Mythic', weight: 0.5, color: 0xf1c40f },
  secret: { name: 'Secret', weight: 0.1, color: 0x111111 },
};

const WALLAHIS = [
  ['doritos_wallahi', 'Doritos Wallahi', 'common', 1, 'doritos_wallahi.jpg'],
  ['mistreated_wallahi', 'Mistreated Wallahi', 'rare', 2, 'mistreated_wallahi.jpg'],
  ['little_wallahi', 'Little Wallahi', 'epic', 3, 'little_wallahi.png'],
  ['chill_wallahi', 'Chill Wallahi', 'legendary', 5, 'chill_wallahi.png'],
  ['miracle_wallahi', 'Miracle Wallahi', 'mythic', 8, 'miracle_wallahi.png'],
  ['wallahi_killer', 'Wallahi Killer', 'secret', 15, 'wallahi_killer.jpg'],
].map(([id, name, rarity, boostPercent, filename]) => ({
  id,
  name,
  rarity,
  boostPercent,
  image: path.join(__dirname, 'assets', 'catch-wallahis', filename),
}));

function validateCatalog() {
  const totalWeight = Object.values(RARITIES).reduce((total, rarity) => total + rarity.weight, 0);
  if (Math.abs(totalWeight - 100) > 0.0001) {
    throw new Error(`Rarity weights must total 100, received ${totalWeight}`);
  }

  const ids = new Set();
  for (const wallahi of WALLAHIS) {
    if (!wallahi.id || !wallahi.name || !RARITIES[wallahi.rarity]) {
      throw new Error(`Invalid Wallahi catalog entry: ${JSON.stringify(wallahi)}`);
    }
    if (ids.has(wallahi.id)) throw new Error(`Duplicate Wallahi ID: ${wallahi.id}`);
    if (!Number.isFinite(wallahi.boostPercent) || wallahi.boostPercent < 0) {
      throw new Error(`Invalid boost for ${wallahi.id}`);
    }
    ids.add(wallahi.id);
  }

  for (const [rarityId, rarity] of Object.entries(RARITIES)) {
    if (rarity.weight > 0 && !WALLAHIS.some((wallahi) => wallahi.rarity === rarityId)) {
      throw new Error(`No Wallahis configured for rarity ${rarityId}`);
    }
  }
}

function chooseRandomWallahi(forcedRarity, forcedWallahiId) {
  if (forcedWallahiId) {
    return WALLAHIS.find((wallahi) => wallahi.id === forcedWallahiId) || null;
  }

  let rarityId = forcedRarity;
  if (!rarityId) {
    let roll = Math.random() * 100;
    for (const [candidateId, rarity] of Object.entries(RARITIES)) {
      roll -= rarity.weight;
      if (roll < 0) {
        rarityId = candidateId;
        break;
      }
    }
  }

  const candidates = WALLAHIS.filter((wallahi) => wallahi.rarity === rarityId);
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function getWallahiById(id) {
  return WALLAHIS.find((wallahi) => wallahi.id === id) || null;
}

function getCollectionBoost(ids) {
  const owned = new Set(ids);
  return WALLAHIS.reduce(
    (total, wallahi) => total + (owned.has(wallahi.id) ? wallahi.boostPercent : 0),
    0
  );
}

validateCatalog();

module.exports = {
  RARITIES,
  WALLAHIS,
  chooseRandomWallahi,
  getWallahiById,
  getCollectionBoost,
};
