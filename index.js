// index.js - Vault Creatures Bot (dev) with persistence + founder + limits + interactive battles + move registry + PvP
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');

// Optional image resizer for Telegram-friendly Grimnex image
let sharp = null;
try {
  sharp = require('sharp');
} catch (e) {
  console.warn('ℹ️ "sharp" not installed – Grimnex image will be sent as-is without resizing.');
}

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_USERNAME = (process.env.OWNER_USERNAME || 'cryptobie1').toLowerCase();

// Grimnex image config
const GRIMNEX_IMAGE_PATH = path.join(__dirname, 'grimnex.webp');     // original (put your file here)
const GRIMNEX_TG_PATH = path.join(__dirname, 'grimnex_tg.jpg');      // resized/cropped for Telegram
const GRIMNEX_FILE_ID = process.env.GRIMNEX_FILE_ID || null;         // optional cached Telegram file_id

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is missing in .env');
  process.exit(1);
}

console.log('🔑 BOT_TOKEN loaded:', BOT_TOKEN ? 'OK' : 'MISSING');
console.log('👑 OWNER_USERNAME:', OWNER_USERNAME);

// Create bot
const bot = new Telegraf(BOT_TOKEN);

// Helper: send Grimnex image (auto-resizes once for Telegram)
async function sendGrimnexImage(ctx, caption) {
  try {
    const extra = caption ? { caption, parse_mode: 'Markdown' } : {};

    // 1) Prefer cached Telegram file_id (no upload / instant)
    if (GRIMNEX_FILE_ID) {
      await ctx.replyWithPhoto(GRIMNEX_FILE_ID, extra);
      return;
    }

    let imagePath = null;

    // 2) If we already generated a Telegram-sized version, use it
    if (fs.existsSync(GRIMNEX_TG_PATH)) {
      imagePath = GRIMNEX_TG_PATH;
    } else if (fs.existsSync(GRIMNEX_IMAGE_PATH)) {
      // 3) First time: try to resize to 512x512 square (good for TG & avatars)
      imagePath = GRIMNEX_IMAGE_PATH;

      if (sharp) {
        try {
          console.log('🖼 Resizing Grimnex image for Telegram (512x512)...');
          await sharp(GRIMNEX_IMAGE_PATH)
            .resize(512, 512, { fit: 'cover' }) // crop center, square
            .jpeg({ quality: 80 })
            .toFile(GRIMNEX_TG_PATH);
          imagePath = GRIMNEX_TG_PATH;
          console.log('✅ Grimnex Telegram image created at', GRIMNEX_TG_PATH);
        } catch (e) {
          console.warn('⚠️ Failed to resize Grimnex image, using original:', e.message || e);
        }
      }
    }

    if (!imagePath) {
      console.warn('⚠️ Grimnex image file not found at:', GRIMNEX_IMAGE_PATH);
      return;
    }

    await ctx.replyWithPhoto({ source: imagePath }, extra);
  } catch (e) {
    console.error('⚠️ Failed to send Grimnex image:', e.message || e);
  }
}

async function sendGrimnexSummon(ctx, extraCaption) {
  const caption = extraCaption
    ? `${GRIMNEX_SUMMON_TEXT}\n\n${extraCaption}`
    : GRIMNEX_SUMMON_TEXT;
  await sendGrimnexImage(ctx, caption);
}

// --- Daily limits ---
const BASE_DISCOVERIES_PER_DAY = 3;
const OWNER_EXTRA_DISCOVERIES = 1; // Owner gets +1 over base
const MAX_DAILY_DISCOVERIES = 4;   // Hard cap for everyone

function todayStr() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// Max number of non-founder pets
const MAX_PETS_PER_USER = 20;

// --- Player XP / Level system (your table) ---
const PLAYER_LEVEL_THRESHOLDS = [
  { level: 1,  xp: 0 },
  { level: 2,  xp: 50 },
  { level: 3,  xp: 120 },
  { level: 4,  xp: 200 },
  { level: 5,  xp: 300 },
  { level: 6,  xp: 420 },
  { level: 7,  xp: 560 },
  { level: 8,  xp: 720 },
  { level: 9,  xp: 900 },
  { level: 10, xp: 1100 },
  { level: 15, xp: 1800 },
  { level: 20, xp: 2600 },
  { level: 30, xp: 4000 },
];

// Player XP rewards
const PLAYER_XP_WIN = 5;
const PLAYER_XP_LOSS = 1;
const PLAYER_XP_DISCOVER = 2;
const PLAYER_XP_DAILY = 3;

// VP rewards
const PLAYER_VP_WIN = 5;

// Ranked PvP constants
const RANKED_VP_WIN = 15;
const RANKED_VP_LOSS = 5;
const CURRENT_SEASON = 1;

// --- Status effects (battle-only) ---
const STATUS = {
  POISONED: 'Poisoned',      // -10% Defense (rest of battle)
  BURNED: 'Burned',          // -10% Power (rest of battle)
  STUNNED: 'Stunned',        // next attack does 0 damage
  SHIELDED: 'Shielded',      // +10% Defense (rest of battle)
  ENRAGED: 'Enraged',        // +10% Power, -5% Defense (rest of battle)
  CURSED: 'Cursed',          // -5% to all stats (rest of battle)
  FROZEN: 'Frozen',          // skips next turn
  SHOCKED: 'Shocked',        // chance to fail action
  BLEEDING: 'Bleeding',      // HP loss each turn (stronger than poison)
  BLINDED: 'Blinded',        // +30% miss chance when acting
  REGENERATING: 'Regenerating', // heals each turn
  ONE_HIT_KO: 'One-Hit KO',  // founder-only: Scythe of Oblivion
  FORCED_MISS: 'Forced Miss' // founder-only: Ultimate Mirage
};

// Pet XP & leveling (small incremental boosts)
const PET_XP_WIN = 10;
const PET_XP_LOSS = 3;

// Flavor text for Grimnex's special move (Scythe of Oblivion)
const SCYTHE_FLAVOR_TEXT =
  '⚔️ *Scythe of Oblivion!*\n' +
  'Grimnex carves a rift through reality itself—time stutters, sound dies,\n' +
  'and in a single, silent stroke… the enemy is no more.';

// Flavor text for Reaper's Return (auto-revive)
const REAPER_RETURN_TEXT =
  '🌑 *Reaper’s Return activates!*\n' +
  'The battlefield freezes as Grimnex’s shadow knits itself back together.\n' +
  'Death was a suggestion. He declines.';

const GRIMNEX_SUMMON_TEXT =
  '🌑 *GRIMNEX, THE VOID REAPER* descends from the eclipse.\n' +
  'Reality buckles as his scythe rips through the veil.';

// Titles by player level (cosmetic only)
const PLAYER_TITLES = [
  { level: 30, title: 'Eternal Tamer' },
  { level: 25, title: 'Voidwalker' },
  { level: 20, title: 'Vault Guardian' },
  { level: 18, title: 'Cosmic Wrangler' },
  { level: 15, title: 'Shadowcaller' },
  { level: 12, title: 'Omega Scout' },
  { level: 10, title: 'Prime Seeker' },
  { level: 8,  title: 'Arcane Handler' },
  { level: 6,  title: 'Beastcaller' },
  { level: 4,  title: 'Vault Wanderer' },
  { level: 2,  title: 'Novice Tamer' },
];

function getPlayerTitle(level) {
  if (!level || level < 2) return null;
  for (const row of PLAYER_TITLES) {
    if (level >= row.level) return row.title;
  }
  return null;
}

function calculatePlayerLevel(xp) {
  let lvl = 1;
  for (const row of PLAYER_LEVEL_THRESHOLDS) {
    if (xp >= row.xp) {
      lvl = row.level;
    } else {
      break;
    }
  }
  return lvl;
}

function updatePlayerLevel(user) {
  const current = user.level || 1;
  const newLevel = calculatePlayerLevel(user.xp || 0);
  if (!user.level || newLevel > current) {
    user.level = newLevel;
    console.log(`⭐ Player ${user.username || user.id} reached level ${user.level}`);
  }
}

// --- Rarity & name data ---
const RARITIES = [
  { name: 'common',    weight: 45 },
  { name: 'uncommon',  weight: 30 },
  { name: 'rare',      weight: 15 },
  { name: 'epic',      weight: 8  },
  { name: 'legendary', weight: 2  },
];

const PREFIXES = [
  'Quantum', 'Void', 'Arcane', 'Crystal', 'Phantom', 'Nova',
  'Shadow', 'Stellar', 'Flux', 'Celestial', 'Vault', 'Ebon',
];

const SPECIES = [
  'Serpent', 'Warden', 'Wisp', 'Golem', 'Beast', 'Hound',
  'Dragon', 'Spirit', 'Chimera', 'Titan', 'Raven', 'Reaper',
];

// Form tiers (evolution)
const FORM_TIER_NAMES = ['Base', 'Prime', 'Omega']; // 0, 1, 2

// --- DB persistence ---
const DB_FILE = path.join(__dirname, 'data.json');

let users = {}; // { [userId]: { ... } }
let pets  = {}; // { [petId]: { ... } }
let nextPetId = 1;

// In-memory PvE battle state
const battles = {};

// PvP state
const pendingPvP = {};
const pvpBattles = {};
const pvpByUser = {};
const rankedQueues = {};

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      if (raw.trim().length > 0) {
        const parsed = JSON.parse(raw);
        users = parsed.users || {};
        pets = parsed.pets || {};
        nextPetId = parsed.nextPetId || 1;

        let maxId = 0;
        for (const id in pets) {
          const p = pets[id];
          if (typeof p.prefix !== 'string') {
            const parts = (p.name || '').split(' ');
            p.prefix = parts[0] || 'Vault';
          }
          if (typeof p.species !== 'string') {
            const parts = (p.name || '').split(' ');
            p.species = parts[1] || 'Beast';
          }
          if (typeof p.formTier !== 'number') p.formTier = 0;
          if (typeof p.isFounder !== 'boolean') p.isFounder = false;
          if (!p.isFounder && (typeof p.specialMove !== 'string' || !SPECIAL_MOVE_POOL.includes(p.specialMove))) {
            p.specialMove = pickRandomSpecialMove();
          }
          if (typeof p.xp !== 'number') p.xp = 0;
          if (typeof p.level !== 'number') p.level = 1;
          const asNum = Number(id);
          if (!Number.isNaN(asNum) && asNum > maxId) maxId = asNum;
        }
        if (maxId + 1 > nextPetId) nextPetId = maxId + 1;

        console.log(
          `💾 Loaded DB: ${Object.keys(users).length} users, ${Object.keys(pets).length} pets, nextPetId=${nextPetId}`
        );
      } else {
        console.log('💾 data.json is empty. Starting fresh.');
      }
    } else {
      console.log('📄 No data.json found. Starting fresh DB.');
    }
  } catch (e) {
    console.error('⚠️ Failed to load DB, starting fresh:', e.message || e);
    users = {};
    pets = {};
    nextPetId = 1;
  }
}

function saveDB() {
  try {
    const payload = { users, pets, nextPetId };
    fs.writeFileSync(DB_FILE, JSON.stringify(payload, null, 2), 'utf8');
    console.log('💾 DB saved.');
  } catch (e) {
    console.error('⚠️ Failed to save DB:', e.message || e);
  }
}

// --- Helpers ---
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function rollRarity() {
  const total = RARITIES.reduce((sum, r) => sum + r.weight, 0);
  let roll = Math.random() * total;
  for (const r of RARITIES) {
    if (roll < r.weight) return r.name;
    roll -= r.weight;
  }
  return 'common';
}

function getUserId(ctx) {
  return String(ctx.from.id);
}

function ensureUser(ctx) {
  const id = getUserId(ctx);
  const usernameLower = (ctx.from.username || '').toLowerCase();

  if (!users[id]) {
    users[id] = {
      id,
      username: ctx.from.username || null,
      xp: 0,
      level: 1,
      vp: 0,
      activePetId: null,
      items: { ascend: 0 },
      discoveriesToday: 0,
      lastDiscoveryDate: null,
      lastDailyDate: null,
      rankedVp: 0,
      rankedWins: 0,
      rankedLosses: 0,
      rankedSeason: CURRENT_SEASON,
    };
  } else {
    if (ctx.from.username) users[id].username = ctx.from.username;
    if (typeof users[id].xp !== 'number') users[id].xp = 0;
    if (typeof users[id].level !== 'number') users[id].level = 1;
    if (typeof users[id].vp !== 'number') users[id].vp = 0;
    if (typeof users[id].discoveriesToday !== 'number') {
      users[id].discoveriesToday = 0;
    }
    if (!('lastDiscoveryDate' in users[id])) {
      users[id].lastDiscoveryDate = null;
    }
    if (!('lastDailyDate' in users[id])) {
      users[id].lastDailyDate = null;
    }
    if (typeof users[id].rankedVp !== 'number') users[id].rankedVp = 0;
    if (typeof users[id].rankedWins !== 'number') users[id].rankedWins = 0;
    if (typeof users[id].rankedLosses !== 'number') users[id].rankedLosses = 0;
    if (typeof users[id].rankedSeason !== 'number') users[id].rankedSeason = CURRENT_SEASON;
    if (!users[id].items || typeof users[id].items.ascend !== 'number') {
      const existing = users[id].items?.ascend || 0;
      users[id].items = { ascend: existing };
    }
    if (!('activePetId' in users[id])) {
      users[id].activePetId = null;
    }
  }

  updatePlayerLevel(users[id]);

  if (usernameLower === OWNER_USERNAME) {
    ensureFounderPetForOwner(id);
  }

  return users[id];
}

function getUserPets(ownerId, options = {}) {
  const all = Object.values(pets).filter((p) => p.ownerId === ownerId);
  if (options.excludeFounder) {
    return all.filter((p) => !p.isFounder);
  }
  return all;
}

// Calculate max daily discoveries including LVL ≥5 perk (cap at 4)
function getMaxDailyDiscoveries(user, isOwner) {
  let maxDaily = BASE_DISCOVERIES_PER_DAY + (isOwner ? OWNER_EXTRA_DISCOVERIES : 0);
  if ((user.level || 1) >= 5) {
    maxDaily += 1;
  }
  if (maxDaily > MAX_DAILY_DISCOVERIES) {
    maxDaily = MAX_DAILY_DISCOVERIES;
  }
  return maxDaily;
}

const SPECIAL_MOVE_POOL = [
  'burning_slash',
  'rend',
  'frost_nova',
  'volt_strike',
  'shadow_veil',
  'renewing_pulse',
  'venom_bite',
  'spectral_chain',
];

function pickRandomSpecialMove() {
  return SPECIAL_MOVE_POOL[randomInt(0, SPECIAL_MOVE_POOL.length - 1)];
}

function ensureSpecialMoveKey(pet) {
  if (!pet || pet.isFounder) return null;
  if (!pet.specialMove || !SPECIAL_MOVE_POOL.includes(pet.specialMove)) {
    const newMove = pickRandomSpecialMove();
    pet.specialMove = newMove;
    if (pet.id && pets[pet.id]) {
      pets[pet.id].specialMove = newMove;
    }
  }
  return pet.specialMove;
}

// Create a normal pet
function createRandomPet(ownerId) {
  const rarity = rollRarity();
  let baseMin = 25;
  let baseMax = 50;

  if (rarity === 'uncommon') { baseMin = 40; baseMax = 65; }
  if (rarity === 'rare')     { baseMin = 60; baseMax = 80; }
  if (rarity === 'epic')     { baseMin = 75; baseMax = 95; }
  if (rarity === 'legendary'){ baseMin = 90; baseMax = 100; }

  const prefix  = PREFIXES[Math.floor(Math.random() * (PREFIXES.length))];
  const species = SPECIES[Math.floor(Math.random() * (SPECIES.length))];

const pet = {
    id: String(nextPetId++),
    ownerId,
    name: `${prefix} ${species}`,
    prefix,
    species,
    rarity,
    level: 1,
    formTier: 0,          // 0 = Base, 1 = Prime, 2 = Omega
    isFounder: false,
  specialMove: pickRandomSpecialMove(),
    power:   randomInt(baseMin, baseMax),
    defense: randomInt(baseMin, baseMax),
    speed:   randomInt(baseMin, baseMax),
    luck:    randomInt(baseMin, baseMax),
    xp: 0,
  };

  pets[pet.id] = pet;
  return pet;
}

// Create an ephemeral wild pet (not persisted)
function createRandomWildPet() {
  const rarity = rollRarity();
  let baseMin = 25;
  let baseMax = 50;

  if (rarity === 'uncommon') { baseMin = 40; baseMax = 65; }
  if (rarity === 'rare')     { baseMin = 60; baseMax = 80; }
  if (rarity === 'epic')     { baseMin = 75; baseMax = 95; }
  if (rarity === 'legendary'){ baseMin = 90; baseMax = 100; }

  const prefix  = PREFIXES[Math.floor(Math.random() * (PREFIXES.length))];
  const species = SPECIES[Math.floor(Math.random() * (SPECIES.length))];

  return {
    id: 'wild-' + Date.now(),
    ownerId: null,
    name: `${prefix} ${species}`,
    prefix,
    species,
    rarity,
    level: randomInt(1, 40),
    formTier: 0,
    isFounder: false,
    specialMove: pickRandomSpecialMove(),
    power:   randomInt(baseMin, baseMax),
    defense: randomInt(baseMin, baseMax),
    speed:   randomInt(baseMin, baseMax),
    luck:    randomInt(baseMin, baseMax),
  };
}

// Founder pet (GRIMNEX, owner-only, LVL 100, with Scythe of Oblivion)
function createFounderPet(ownerId) {
  const pet = {
    id: String(nextPetId++),
    ownerId,
    name: 'GRIMNEX, THE VOID REAPER',
    prefix: 'Grimnex',
    species: 'Reaper',
    rarity: 'legendary',
    level: 100,
    formTier: 2,
    isFounder: true,
    specialMove: 'Scythe of Oblivion',
    power:   120,
    defense: 115,
    speed:   110,
    luck:    110,
    xp: 0,
  };
  pets[pet.id] = pet;
  console.log('👑 Founder pet created for owner:', ownerId);
  return pet;
}

function ensureFounderPetForOwner(ownerId) {
  const existing = Object.values(pets).find(
    (p) => p.ownerId === ownerId && p.isFounder
  );
  if (existing) return existing;
  const created = createFounderPet(ownerId);
  saveDB();
  return created;
}

// Load DB on startup (after move helpers are defined)
loadDB();

function findUserByUsername(usernameLower) {
  const normalized = usernameLower?.replace('@', '').toLowerCase();
  if (!normalized) return null;
  return Object.values(users).find(
    (u) => (u.username || '').toLowerCase() === normalized
  );
}

// --- Battle helpers & status system ---
function createEmptyStatus() {
  return {
    poisoned: false,
    burned: false,
    stunned: false,
    shielded: false,
    enraged: false,
    cursed: false,
    mirage: false,       // Ultimate Mirage (founder)
    frozen: false,       // Freeze (skip turn)
    shocked: false,      // Shock (chance to fail)
    bleeding: false,     // Bleed (stronger HP loss)
    blinded: false,      // Blind (higher miss chance)
    regenerating: false, // Regeneration (heal each turn)
  };
}

function calculateMaxHP(pet) {
  return 50 + (pet.defense || 0) * 2 + (pet.level || 1) * 5;
}

// New-ish damage formula: scales with level + slightly softer mitigation
function calculateDamage(attacker, defender, attackerStatus, defenderStatus, powerMult = 1) {
  const aStats = getEffectiveStats(attacker, attackerStatus);
  const dStats = getEffectiveStats(defender, defenderStatus);

  const attackerLevel = attacker.level || 1;
  const defenderLevel = defender.level || 1;
  const levelFactor = 1 + (attackerLevel - defenderLevel) * 0.03;

  const base = aStats.power * powerMult * Math.max(0.6, levelFactor);
  const mitigation = dStats.defense * 0.6;
  const variance = randomInt(-4, 4);

  const raw = base - mitigation + variance;
  return Math.max(1, Math.round(raw));
}

function getEffectiveStats(pet, status) {
  if (!pet) {
    return { power: 1, defense: 1, speed: 1, luck: 1 };
  }
  let power = pet.power || 1;
  let defense = pet.defense || 1;
  let speed = pet.speed || 1;
  let luck = pet.luck || 1;

  if (!status) return { power, defense, speed, luck };

  if (status.burned) {
    power = Math.max(1, Math.floor(power * 0.9));
  }
  if (status.enraged) {
    power   = Math.floor(power * 1.1);
    defense = Math.max(1, Math.floor(defense * 0.95));
  }
  if (status.poisoned) {
    defense = Math.max(1, Math.floor(defense * 0.9));
  }
  if (status.cursed) {
    power   = Math.max(1, Math.floor(power * 0.95));
    defense = Math.max(1, Math.floor(defense * 0.95));
    speed   = Math.max(1, Math.floor(speed  * 0.95));
    luck    = Math.max(1, Math.floor(luck   * 0.95));
  }
  if (status.shielded) {
    defense = Math.floor(defense * 1.1);
  }

  return { power, defense, speed, luck };
}

function formatStatusIcons(status) {
  if (!status) return '';
  const icons = [];
  if (status.poisoned)     icons.push('☠️Poisoned');
  if (status.burned)       icons.push('🔥Burned');
  if (status.stunned)      icons.push('💫Stunned');
  if (status.shielded)     icons.push('🛡Shielded');
  if (status.enraged)      icons.push('💢Enraged');
  if (status.cursed)       icons.push('🕯Cursed');
  if (status.frozen)       icons.push('❄️Frozen');
  if (status.shocked)      icons.push('⚡Shocked');
  if (status.bleeding)     icons.push('🩸Bleeding');
  if (status.blinded)      icons.push('👁‍🗨Blinded');
  if (status.regenerating) icons.push('💚Regenerating');
  if (status.mirage)       icons.push('🌫Mirage');
  return icons.length ? ` — _${icons.join(', ')}_` : '';
}

function describePetInline(p) {
  const rarity = (p.rarity || 'common').toUpperCase();
  const form = FORM_TIER_NAMES[p.formTier || 0] || 'Base';
  const founderTag = p.isFounder ? ' · 👑 FOUNDER' : '';
  return `*${p.name}* [${rarity} · ${form}${founderTag}] (Lv ${p.level || 1}, P:${p.power} D:${p.defense} S:${p.speed} L:${p.luck})`;
}

function formatBattleStateText(userId, extraLog) {
  const state = battles[userId];
  if (!state) return extraLog || '⚔️ The battle has ended.';

  const pet = pets[state.playerPetId];
  const enemy = state.enemy;

  const pStats = getEffectiveStats(pet, state.playerStatus);
  const eStats = getEffectiveStats(enemy, state.enemyStatus);

  let text = '';
  text += `⚔️ *Battle: ${pet.name} vs ${enemy.name}*\n\n`;
  text += `👤 Your ${pet.name}: HP ${state.playerHp}/${state.playerMaxHp} (P:${pStats.power} D:${pStats.defense} S:${pStats.speed} L:${pStats.luck})${formatStatusIcons(state.playerStatus)}\n`;
  text += `💀 Foe ${enemy.name}: HP ${state.enemyHp}/${state.enemyMaxHp} (P:${eStats.power} D:${eStats.defense} S:${eStats.speed} L:${eStats.luck})${formatStatusIcons(state.enemyStatus)}\n\n`;
  if (extraLog) {
    text += extraLog + '\n';
  }
  if (state.turn === 'player') {
    text += '*Your move!* Choose an ability:';
  } else if (state.turn === 'enemy') {
    text += '_The foe is preparing its move…_';
  }
  return text;
}

// --- Move registry (data-driven) ---

const MOVE_DEFS = {
  // --- Generic Non-Founder Moves ---

  // Basic physical
  strike: {
    key: 'strike',
    label: '⚔️ Strike',
    execute(state, pet, enemy) {
      const dmg = calculateDamage(pet, enemy, state.playerStatus, state.enemyStatus, 1.0);
      state.enemyHp = Math.max(0, state.enemyHp - dmg);
      let log = `\n⚔️ *${pet.name}* uses *Strike* and deals *${dmg}* damage!`;
      return { log };
    },
  },

  burning_slash: {
    key: 'burning_slash',
    label: '🔥 Burning Slash',
    execute(state, pet, enemy) {
      const dmg = calculateDamage(pet, enemy, state.playerStatus, state.enemyStatus, 1.0);
      state.enemyHp = Math.max(0, state.enemyHp - dmg);
      let log = `\n🔥 *${pet.name}* unleashes a *Burning Slash* for *${dmg}* damage!`;
      if (!state.enemyStatus.burned && state.enemyHp > 0 && Math.random() < 0.05) {
        state.enemyStatus.burned = true;
        log += `\n🔥 ${enemy.name} is *Burned* (power reduced)!`;
      }
      return { log };
    },
  },

  guard_up: {
    key: 'guard_up',
    label: '🛡 Guard Up',
    execute(state, pet, enemy) {
      state.playerStatus.shielded = true;
      state.playerStatus.regenerating = true;
      const heal = Math.max(1, Math.floor(state.playerMaxHp * 0.08));
      state.playerHp = Math.min(state.playerMaxHp, state.playerHp + heal);
      let log =
        `\n🛡 *${pet.name}* uses *Guard Up*!\n` +
        `Defense rises, regeneration begins, and it recovers *${heal}* HP.`;
      return { log };
    },
  },

  venom_bite: {
    key: 'venom_bite',
    label: '☠️ Venom Bite',
    execute(state, pet, enemy) {
      const dmg = calculateDamage(pet, enemy, state.playerStatus, state.enemyStatus, 0.95);
      state.enemyHp = Math.max(0, state.enemyHp - dmg);
      let log = `\n☠️ *${pet.name}* sinks fangs in for *${dmg}* damage!`;
      if (!state.enemyStatus.poisoned && state.enemyHp > 0 && Math.random() < 0.4) {
        state.enemyStatus.poisoned = true;
        log += `\n☠️ ${enemy.name} is *Poisoned* and will lose defense + HP!`;
      }
      return { log };
    },
  },

  rend: {
    key: 'rend',
    label: '🩸 Rend',
    execute(state, pet, enemy) {
      const dmg = calculateDamage(pet, enemy, state.playerStatus, state.enemyStatus, 1.05);
      state.enemyHp = Math.max(0, state.enemyHp - dmg);
      let log = `\n🩸 *${pet.name}* rends ${enemy.name} for *${dmg}* damage!`;
      if (!state.enemyStatus.bleeding && state.enemyHp > 0 && Math.random() < 0.08) {
        state.enemyStatus.bleeding = true;
        log += `\n🩸 ${enemy.name} is now *Bleeding*!`;
      }
      return { log };
    },
  },

  frost_nova: {
    key: 'frost_nova',
    label: '❄️ Frost Nova',
    execute(state, pet, enemy) {
      const dmg = calculateDamage(pet, enemy, state.playerStatus, state.enemyStatus, 0.85);
      state.enemyHp = Math.max(0, state.enemyHp - dmg);
      let log = `\n❄️ *${pet.name}* unleashes a *Frost Nova*, chilling ${enemy.name} for *${dmg}* damage!`;
      if (!state.enemyStatus.frozen && state.enemyHp > 0 && Math.random() < 0.4) {
        state.enemyStatus.frozen = true;
        log += `\n❄️ ${enemy.name} is *Frozen solid* and will skip its next turn!`;
      }
      return { log };
    },
  },

  volt_strike: {
    key: 'volt_strike',
    label: '⚡ Volt Strike',
    execute(state, pet, enemy) {
      const dmg = calculateDamage(pet, enemy, state.playerStatus, state.enemyStatus, 0.95);
      state.enemyHp = Math.max(0, state.enemyHp - dmg);
      let log = `\n⚡ *${pet.name}* crashes down with *Volt Strike* for *${dmg}* damage!`;
      if (!state.enemyStatus.shocked && state.enemyHp > 0 && Math.random() < 0.45) {
        state.enemyStatus.shocked = true;
        log += `\n⚡ ${enemy.name} is *Shocked* — its actions may fail!`;
      }
      return { log };
    },
  },

  shadow_veil: {
    key: 'shadow_veil',
    label: '🌫 Shadow Veil',
    execute(state, pet, enemy) {
      const dmg = calculateDamage(pet, enemy, state.playerStatus, state.enemyStatus, 0.9);
      state.enemyHp = Math.max(0, state.enemyHp - dmg);
      let log = `\n🌫 *${pet.name}* engulfs ${enemy.name} for *${dmg}* damage!`;
      if (!state.enemyStatus.blinded && state.enemyHp > 0) {
        state.enemyStatus.blinded = true;
        log += `\n🌫 ${enemy.name} is *Blinded* and may miss its attacks!`;
      }
      return { log };
    },
  },

  renewing_pulse: {
    key: 'renewing_pulse',
    label: '💚 Renewing Pulse',
    execute(state, pet) {
      state.playerStatus.regenerating = true;
      const heal = Math.max(1, Math.floor(state.playerMaxHp * 0.12));
      state.playerHp = Math.min(state.playerMaxHp, state.playerHp + heal);
      return {
        log:
          `\n💚 *${pet.name}* channels a *Renewing Pulse*, restoring *${heal}* HP` +
          ` and entering a *Regenerating* state!`,
      };
    },
  },

  spectral_chain: {
    key: 'spectral_chain',
    label: '⛓ Spectral Chain',
    execute(state, pet, enemy) {
      const dmg = calculateDamage(pet, enemy, state.playerStatus, state.enemyStatus, 0.9);
      state.enemyHp = Math.max(0, state.enemyHp - dmg);
      let log = `\n⛓ *${pet.name}* lashes out with spectral chains for *${dmg}* damage!`;
      if (!state.enemyStatus.stunned && state.enemyHp > 0 && Math.random() < 0.35) {
        state.enemyStatus.stunned = true;
        log += `\n⛓ ${enemy.name} is *Stunned* and will miss its next action!`;
      }
      return { log };
    },
  },

  // --- Founder / Grimnex Moves ---

  reaper: {
    key: 'reaper',
    label: '⚔️ Reaper’s Grasp',
    execute(state, pet, enemy) {
      const dmg = calculateDamage(pet, enemy, state.playerStatus, state.enemyStatus, 1.2);
      state.enemyHp = Math.max(0, state.enemyHp - dmg);
      let log =
        `\n⚔️ *Reaper’s Grasp!* *${pet.name}* cleaves through the foe for *${dmg}* damage.`;
      // 25% chance to Burn
      if (!state.enemyStatus.burned && state.enemyHp > 0 && Math.random() < 0.25) {
        state.enemyStatus.burned = true;
        log += `\n🔥 ${enemy.name} is *Burned*!`;
      }
      return { log };
    },
  },

  soul: {
    key: 'soul',
    label: '☠️ Soul Harvest',
    execute(state, pet, enemy) {
      const dmg = calculateDamage(pet, enemy, state.playerStatus, state.enemyStatus, 1.0);
      state.enemyHp = Math.max(0, state.enemyHp - dmg);
      let log =
        `\n☠️ *Soul Harvest!* ${pet.name} rips at ${enemy.name}’s essence for *${dmg}* damage.`;
      // 30% chance to Curse
      if (!state.enemyStatus.cursed && state.enemyHp > 0 && Math.random() < 0.30) {
        state.enemyStatus.cursed = true;
        log += `\n🕯 ${enemy.name} is *Cursed* — all stats are weakened!`;
      }
      return { log };
    },
  },

  mirage: {
    key: 'mirage',
    label: '🌫️ Ultimate Mirage',
    execute(state, pet, enemy) {
      state.playerStatus.mirage = true;
      const log =
        `\n🌫️ *Ultimate Mirage!* ${pet.name} splits into countless phantoms.\n` +
        `The next enemy attack is guaranteed to *miss* (founder-only forced miss).`;
      return { log };
    },
  },

  scythe: {
    key: 'scythe',
    label: '🗡 Scythe of Oblivion',
    execute(state, pet, enemy) {
      if (state.scytheUsed) {
        const log = `\n🗡 *Scythe of Oblivion* has already been used this battle!`;
        return { log };
      }
      state.scytheUsed = true;
      state.enemyHp = 0;
      let log =
        `\n${SCYTHE_FLAVOR_TEXT}\n\n💀 The foe *${enemy.name}* is erased in an instant! (Founder-only one-hit KO)`;
      return { log, ended: true, outcome: 'win' };
    },
  },
};

// Which moves each pet type gets
const MOVE_SETS = {
  founder: ['reaper', 'soul', 'mirage', 'scythe'],
};

function getMoveSetForPet(pet, state) {
  if (!pet) return [];
  if (pet.isFounder) {
    return MOVE_SETS.founder.filter((k) => k !== 'scythe' || !state?.scytheUsed);
  }
  const specialKey = ensureSpecialMoveKey(pet) || 'burning_slash';
  return ['strike', 'guard_up', specialKey];
}

function buildBattleKeyboard(userId) {
  const state = battles[userId];
  if (!state || !state.playerPetId) return undefined;

  const pet = pets[state.playerPetId];
  if (!pet) return undefined;

  const buttons = [];

  const moveKeys = getMoveSetForPet(pet, state);
  for (const key of moveKeys) {
    const def = MOVE_DEFS[key];
    if (!def) continue;
    buttons.push([
      Markup.button.callback(def.label, `battle:move:${key}`)
    ]);
  }

  buttons.push([Markup.button.callback('🏃‍♂️ Run', 'battle:run')]);

  return { inline_keyboard: buttons };
}

// XP scaling vs weaker enemies (anti-farm)
function getXpMultiplier(attackerLevel, defenderLevel) {
  const a = attackerLevel || 1;
  const d = defenderLevel || 1;
  const diff = a - d;

  if (diff >= 30) return 0;
  if (diff >= 20) return 0.25;
  if (diff >= 10) return 0.5;
  return 1;
}

// Global error catcher
bot.catch((err, ctx) => {
  console.error('🤖 Bot error for update', ctx?.update?.update_id, ':', err);
});

// /start
bot.start(async (ctx) => {
  const uname = ctx.from.username ? '@' + ctx.from.username : 'Unknown';
  const user = ensureUser(ctx);
  console.log(`➡️ /start from ${uname}`);

  if ((ctx.from.username || '').toLowerCase() === OWNER_USERNAME) {
    const founder = ensureFounderPetForOwner(user.id);
    if (founder) {
      await sendGrimnexImage(ctx);
      await ctx.reply(
        '🌑 *The Vault stirs…*\n' +
        'A shadow tears through the void, and a colossal figure steps forth.\n' +
        'You are now bound to *GRIMNEX, THE VOID REAPER*.\n\n' +
        'Use /mypets to behold your Founder.',
        { parse_mode: 'Markdown' }
      );
    }
  }

  await ctx.reply(
    `💜 *Welcome to Vault Creatures!*\n\n` +
    `You are: ${uname}\n\n` +
    `Core commands:\n` +
    `• /vaultpet – Discover new creatures (3/day, LVL≥5: +1, max 4/day)\n` +
    `• /daily – Claim your daily XP (+${PLAYER_XP_DAILY} XP)\n` +
    `• /mypets – View all your creatures\n` +
    `• /petinfo N – Detailed info about creature #N\n` +
    `• /wildbattle – Fight a random wild creature (choose pet & moves)\n` +
    `• /pvp @user – Challenge another tamer to a duel\n` +
    `• /ranked – Join the ranked PvP queue (VP matchmaking)\n` +
    `• /profile – See your trainer level, XP, VP\n` +
    `• /leaderboard – Top trainers by VP & XP\n` +
    `• /release N – Release a creature\n` +
    `• /evolve N – Evolve duplicates into Prime / Omega\n\n` +
    `Type /help anytime to see the full command list.`,
    { parse_mode: 'Markdown' }
  );
});

// /help – command overview
bot.command('help', async (ctx) => {
  const uname = ctx.from.username ? '@' + ctx.from.username : 'Unknown';
  console.log(`➡️ /help from ${uname}`);

  const lines = [];
  lines.push('📖 *Vault Creatures — Command Guide*');
  lines.push('');
  lines.push('Core:');
  lines.push('• /start – Intro & basics');
  lines.push(`• /daily – Claim daily login reward (+${PLAYER_XP_DAILY} XP)`);
  lines.push('• /profile – Your trainer level, XP, VP, title, and limits');
  lines.push('');
  lines.push('Creatures:');
  lines.push('• /vaultpet – Discover new creatures (3/day; LVL≥5: +1; max 4/day)');
  lines.push('• /mypets – List all your creatures (Founder included)');
  lines.push('• /petinfo N – Details for creature #N (see /mypets)');
  lines.push('• /release N – Release creature #N (cannot release Grimnex)');
  lines.push('• /evolve N – Evolve duplicates of #N into Prime → Omega');
  lines.push('');
  lines.push('Battles (PvE):');
  lines.push('• /wildbattle – Fight a random wild creature');
  lines.push('   – Pick a creature to send');
  lines.push('   – Use buttons to choose its moves');
  lines.push('   – Non-founders always have exactly 3 moves:');
  lines.push('      ⚔️ Strike (reliable basic damage)');
  lines.push('      🛡 Guard Up (Shield + regeneration burst)');
  lines.push('      🎲 1 random Special: Burning Slash (burn 5%), Rend (bleed 8%),');
  lines.push('         Frost Nova (freeze), Volt Strike (shock), Shadow Veil (blind),');
  lines.push('         Renewing Pulse (regen), Venom Bite (poison) or Spectral Chain (stun).');
  lines.push('   – Grimnex (Founder only):');
  lines.push('      ⚔️ Reaper’s Grasp (Burn chance)');
  lines.push('      ☠️ Soul Harvest (Curse chance)');
  lines.push('      🌫️ Ultimate Mirage (forced miss on next enemy attack)');
  lines.push('      🗡 Scythe of Oblivion (once-per-battle one-hit KO)');
  lines.push('');
  lines.push('Items & Ascension:');
  lines.push('• /ascend – Consume an Ascend Item to raise your active pet +1 level');
  lines.push('• /giftascend @user – Gift one Ascend Item to another trainer');
  lines.push('');
  lines.push('PvP:');
  lines.push('• /pvp @user – Challenge another trainer to a PvP duel');
  lines.push('   – Opponent Accepts/Declines via buttons');
  lines.push('   – Both pick one creature each');
  lines.push('   – Turn-based: Attack / Guard / Run (with status effects)');
  lines.push('• /ranked – Join the ranked PvP queue in this chat');
  lines.push('   – Matched by VP against another queued player');
  lines.push('   – Ranked wins/losses tracked per season');
  lines.push('');
  lines.push('Status Effects (Battles):');
  lines.push('• *Poisoned*      – -10% Defense, periodic HP loss');
  lines.push('• *Burned*        – -10% Power, periodic HP loss');
  lines.push('• *Frozen*        – Skips the next turn');
  lines.push('• *Shocked*       – Actions have a chance to fail');
  lines.push('• *Bleeding*      – HP loss each turn (stronger than poison)');
  lines.push('• *Blinded*       – +30% chance for attacks to miss');
  lines.push('• *Regenerating*  – Heals a portion of HP each round');
  lines.push('• *Shielded*      – +10% Defense');
  lines.push('• *Enraged*       – +10% Power, -5% Defense');
  lines.push('• *Cursed*        – -5% to all stats');
  lines.push('• *Mirage* (Founder) – Next enemy attack always misses');
  lines.push('• *Scythe of Oblivion* (Founder) – One-hit KO, once per battle');
  lines.push('');
  lines.push('Progress & Rankings:');
  lines.push('• Gain XP: Wins +5, Loss +1, Discover +2, Daily +3');
  lines.push('• Titles unlock at higher levels (Novice Tamer → Eternal Tamer)');
  lines.push('• /leaderboard – See top VP & XP leaders');
  lines.push('• Ranked PvP: extra Ranked VP, ranked wins/losses, per season');
  lines.push('');
  lines.push('Owner-only:');
  lines.push('• /resetdaily – Reset daily discovery limits for everyone');
  lines.push('• /testrevive – Preview Grimnex auto-revive text');
  lines.push('• /scythetest – Preview Scythe of Oblivion text');
  lines.push('• /grantascend @user – Give an Ascend Item to a trainer');

  return ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
});

// /ping
bot.command('ping', async (ctx) => {
  console.log(`➡️ /ping from ${(ctx.from.username || '').toLowerCase()}`);
  await ctx.reply('pong 🏓');
});

// /daily – daily login XP
bot.command('daily', async (ctx) => {
  const user = ensureUser(ctx);
  const uname = ctx.from.username ? '@' + ctx.from.username : 'Unknown';
  console.log(`➡️ /daily from ${uname}`);

  const today = todayStr();
  if (user.lastDailyDate === today) {
    return ctx.reply('⏰ You already claimed today’s daily reward. Come back tomorrow!');
  }

  user.lastDailyDate = today;
  user.xp = (user.xp || 0) + PLAYER_XP_DAILY;
  const beforeLevel = user.level || 1;
  updatePlayerLevel(user);
  saveDB();

  const title = getPlayerTitle(user.level);
  let msg =
    `🎁 *Daily Tribute Claimed!*\n` +
    `+${PLAYER_XP_DAILY} XP\n` +
    `Total XP: *${user.xp}*\n` +
    `Level: *${user.level}*`;

  if (user.level > beforeLevel && title) {
    msg += `\n\n👑 New Title Unlocked: *${title}*`;
  }

  return ctx.reply(msg, { parse_mode: 'Markdown' });
});

// /vaultpet – discover a new creature
bot.command('vaultpet', async (ctx) => {
  const user = ensureUser(ctx);
  const uname = ctx.from.username ? '@' + ctx.from.username : 'Unknown';
  console.log(`➡️ /vaultpet from ${uname}`);

  const today = todayStr();

  if (user.lastDiscoveryDate !== today) {
    user.lastDiscoveryDate = today;
    user.discoveriesToday = 0;
  }

  const isOwner = (ctx.from.username || '').toLowerCase() === OWNER_USERNAME;
  const maxDaily = getMaxDailyDiscoveries(user, isOwner);

  if (user.discoveriesToday >= maxDaily) {
    return await ctx.reply(
      `🔒 Daily discovery limit reached.\nYou have already discovered ${user.discoveriesToday}/${maxDaily} creatures today.`
    );
  }

  const nonFounderPets = getUserPets(user.id, { excludeFounder: true });
  if (nonFounderPets.length >= MAX_PETS_PER_USER) {
    return await ctx.reply(
      `📦 Your non-founder roster is full (${nonFounderPets.length}/${MAX_PETS_PER_USER}).\n` +
      `Use /release N to free a slot (e.g. /release 2).`
    );
  }

  const pet = createRandomPet(user.id);
  user.discoveriesToday += 1;

  const xpGain = PLAYER_XP_DISCOVER;
  user.xp = (user.xp || 0) + xpGain;
  updatePlayerLevel(user);
  saveDB();

  const totalNonFounder = nonFounderPets.length + 1;
  const hasFounder = getUserPets(user.id).some((p) => p.isFounder);
  const title = getPlayerTitle(user.level);

  let text =
    `🟣 *A new Vault Creature appears!*\n\n` +
    `Name: *${pet.name}*\n` +
    `Rarity: ${pet.rarity.toUpperCase()}\n` +
    `Form: ${FORM_TIER_NAMES[pet.formTier || 0]}\n` +
    `Level: ${pet.level}\n` +
    `Power: ${pet.power}\n` +
    `Defense: ${pet.defense}\n` +
    `Speed: ${pet.speed}\n` +
    `Luck: ${pet.luck}\n\n` +
    `+${xpGain} Player XP (Discover)\n` +
    `Total XP: *${user.xp}* | Level: *${user.level}*\n`;

  if (title) {
    text += `Title: *${title}*\n`;
  }

  text += `\n🔢 Discoveries today: ${user.discoveriesToday}/${maxDaily}\n` +
          `📦 Non-founder creatures: ${totalNonFounder}/${MAX_PETS_PER_USER}\n` +
          `👑 Founder: ${hasFounder ? 'GRIMNEX, THE VOID REAPER' : 'None'}`;

  return await ctx.reply(text, { parse_mode: 'Markdown' });
});

// /mypets – list your creatures
bot.command('mypets', async (ctx) => {
  const user = ensureUser(ctx);
  const uname = ctx.from.username ? '@' + ctx.from.username : 'Unknown';

  console.log(`➡️ /mypets from ${uname}`);

  const userPets = getUserPets(user.id);

  if (!userPets.length) {
    return await ctx.reply('📁 You have no Vault Creatures yet. Use /vaultpet to discover one!');
  }

  let text = `📜 *Your Vault Creatures* (${userPets.length} total)\n\n`;
  userPets.forEach((p, idx) => {
    const founderTag = p.isFounder ? ' · 👑 FOUNDER' : '';
    const specialLine = p.isFounder
      ? `   Moves: ⚔️ Reaper’s Grasp · ☠️ Soul Harvest · 🌫️ Ultimate Mirage · 🗡 Scythe of Oblivion\n`
      : '';
    text +=
      `${idx + 1}. *${p.name}* [${p.rarity.toUpperCase()} · ${FORM_TIER_NAMES[p.formTier || 0]}${founderTag}]\n` +
      `   Lv ${p.level || 1} | P:${p.power} D:${p.defense} S:${p.speed} L:${p.luck}\n` +
      specialLine +
      `\n`;
  });

  return await ctx.reply(text, { parse_mode: 'Markdown' });
});

// /petinfo N – detailed info about a single pet
bot.command('petinfo', async (ctx) => {
  const user = ensureUser(ctx);
  const uname = ctx.from.username ? '@' + ctx.from.username : 'Unknown';
  console.log(`➡️ /petinfo from ${uname}:`, ctx.message.text);

  const parts = ctx.message.text.trim().split(' ');
  if (parts.length < 2) {
    return ctx.reply('Usage: /petinfo N\nExample: /petinfo 1');
  }

  const index = parseInt(parts[1], 10);
  if (Number.isNaN(index) || index < 1) {
    return ctx.reply('Please provide a valid creature number. Example: /petinfo 2');
  }

  const userPets = getUserPets(user.id);
  if (!userPets.length) {
    return ctx.reply('You have no creatures yet. Use /vaultpet to discover one!');
  }

  if (index > userPets.length) {
    return ctx.reply(`You only have ${userPets.length} creatures.\nCheck /mypets for the list.`);
  }

  const p = userPets[index - 1];

  const rarity = (p.rarity || 'common').toUpperCase();
  const form = FORM_TIER_NAMES[p.formTier || 0] || 'Base';
  const title = getPlayerTitle(user.level || 1);

  const lines = [];
  lines.push(`🔍 *Creature #${index}: ${p.name}*`);
  lines.push('');
  lines.push(`Rarity: *${rarity}*`);
  lines.push(`Form: *${form}*${p.isFounder ? ' · 👑 Founder' : ''}`);
  lines.push('');
  lines.push(`Level: *${p.level || 1}*`);
  lines.push(`Power: *${p.power}*`);
  lines.push(`Defense: *${p.defense}*`);
  lines.push(`Speed: *${p.speed}*`);
  lines.push(`Luck: *${p.luck}*`);
  lines.push('');
  if (typeof p.xp === 'number') {
    lines.push(`Pet XP: *${p.xp}*`);
  }
  if (p.isFounder && p.specialMove) {
    // Show Grimnex art whenever his info is opened
    await sendGrimnexImage(ctx);
    lines.push('');
    lines.push(`Special: *${p.specialMove}*`);
    lines.push('Moveset:');
    lines.push('• ⚔️ Reaper’s Grasp');
    lines.push('• ☠️ Soul Harvest');
    lines.push('• 🌫️ Ultimate Mirage');
    lines.push('• 🗡 Scythe of Oblivion');
  }
  if (title) {
    lines.push('');
    lines.push(`Your current trainer title: *${title}* (Level ${user.level || 1})`);
  }

  return ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
});

// /profile – show trainer stats
bot.command('profile', async (ctx) => {
  const user = ensureUser(ctx);
  const uname = ctx.from.username ? '@' + ctx.from.username : 'Unknown';
  console.log(`➡️ /profile from ${uname}`);

  const isOwner = (ctx.from.username || '').toLowerCase() === OWNER_USERNAME;
  const today = todayStr();
  const maxDaily = getMaxDailyDiscoveries(user, isOwner);
  const userPets = getUserPets(user.id);
  const nonFounderPets = getUserPets(user.id, { excludeFounder: true });
  const title = getPlayerTitle(user.level || 1);

  const lines = [];
  lines.push('🧾 *Trainer Profile*');
  lines.push('');
  lines.push(`User: ${uname}`);
  if (title) {
    lines.push(`Title: *${title}* (Level ${user.level || 1})`);
  } else {
    lines.push(`Level: *${user.level || 1}*`);
  }
  lines.push(`XP: *${user.xp || 0}*`);
  lines.push(`VP: *${user.vp || 0}*`);
  lines.push(
    `Ranked VP (Season ${user.rankedSeason || CURRENT_SEASON}): *${user.rankedVp || 0}* — W:${user.rankedWins || 0} / L:${user.rankedLosses || 0}`
  );
  lines.push('');
  lines.push(`📦 Creatures: *${userPets.length}* total`);
  lines.push(`   – Non-founder: *${nonFounderPets.length}* / ${MAX_PETS_PER_USER}`);
  const hasFounder = userPets.some((p) => p.isFounder);
  lines.push(`   – Founder: ${hasFounder ? '👑 GRIMNEX, THE VOID REAPER' : 'None'}`);
  lines.push('');
  lines.push('📆 Daily Progress:');
  lines.push(`   Discoveries today: *${user.discoveriesToday || 0}* / ${maxDaily}`);
  lines.push(
    `   Last discovery reset: *${user.lastDiscoveryDate || 'No discoveries yet'}*`
  );
  lines.push(
    `   Last daily claim: *${user.lastDailyDate || 'Not claimed yet'}*`
  );

  return ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
});

// /leaderboard – top trainers by VP & XP
bot.command('leaderboard', async (ctx) => {
  const uname = ctx.from.username ? '@' + ctx.from.username : 'Unknown';
  console.log(`➡️ /leaderboard from ${uname}`);

  const allUsers = Object.values(users);
  if (!allUsers.length) {
    return ctx.reply('📊 No trainers yet. Be the first to earn XP and VP!');
  }

  const topVP = [...allUsers]
    .sort((a, b) => (b.vp || 0) - (a.vp || 0) || (b.xp || 0) - (a.xp || 0))
    .slice(0, 10);

  const topXP = [...allUsers]
    .sort((a, b) => (b.xp || 0) - (a.xp || 0))
    .slice(0, 10);

  const vpLines = ['🏆 *Top Vault Power (VP)*'];
  topVP.forEach((u, idx) => {
    const title = getPlayerTitle(u.level || 1);
    const label = u.username ? '@' + u.username : `User ${u.id}`;
    const titleText = title ? ` — ${title}` : '';
    vpLines.push(
      `${idx + 1}. ${label}${titleText} — *${u.vp || 0} VP* (Lv ${u.level || 1}, ${u.xp || 0} XP)`
    );
  });

  const xpLines = ['\n📚 *Top Experience (XP)*'];
  topXP.forEach((u, idx) => {
    const title = getPlayerTitle(u.level || 1);
    const label = u.username ? '@' + u.username : `User ${u.id}`;
    const titleText = title ? ` — ${title}` : '';
    xpLines.push(
      `${idx + 1}. ${label}${titleText} — *${u.xp || 0} XP* (VP ${u.vp || 0})`
    );
  });

  return ctx.reply([...vpLines, ...xpLines].join('\n'), { parse_mode: 'Markdown' });
});

bot.command('grantascend', async (ctx) => {
  if (!isOwner(ctx)) {
    return ctx.reply('❌ Only the Vault Overseer can grant Ascend Items.');
  }
  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 2) {
    return ctx.reply('Usage: /grantascend @username');
  }
  const target = findUserByUsername(parts[1]);
  if (!target) {
    return ctx.reply('❌ That user has never used the bot.');
  }
  target.items = target.items || { ascend: 0 };
  target.items.ascend += 1;
  saveDB();
  return ctx.reply(`🎁 Granted 1 Ascend Item to @${target.username}. They now have ${target.items.ascend}.`);
});

bot.command('ascend', async (ctx) => {
  const user = ensureUser(ctx);
  user.items = user.items || { ascend: 0 };
  if (user.items.ascend <= 0) {
    return ctx.reply('❌ You do not have any Ascend Items.');
  }
  const activePetId = user.activePetId;
  const pet = activePetId ? pets[activePetId] : null;
  if (!pet || pet.ownerId !== user.id) {
    return ctx.reply('❌ No active pet found. Send a creature into battle or a duel first.');
  }
  pet.level = (pet.level || 1) + 1;
  user.items.ascend -= 1;
  saveDB();
  return ctx.reply(
    `⬆️✨ *${pet.name}* ascends to Level ${pet.level}! One Ascend Item consumed.\nItems left: ${user.items.ascend}.`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('giftascend', async (ctx) => {
  const sender = ensureUser(ctx);
  sender.items = sender.items || { ascend: 0 };
  if (sender.items.ascend <= 0) {
    return ctx.reply('❌ You do not have any Ascend Items to gift.');
  }
  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 2) {
    return ctx.reply('Usage: /giftascend @username');
  }
  const receiver = findUserByUsername(parts[1]);
  if (!receiver) {
    return ctx.reply('❌ That user has never used the bot.');
  }
  if (receiver.id === sender.id) {
    return ctx.reply('❌ You cannot gift an Ascend Item to yourself.');
  }
  receiver.items = receiver.items || { ascend: 0 };
  sender.items.ascend -= 1;
  receiver.items.ascend += 1;
  saveDB();
  return ctx.reply(
    `🎁 You gifted 1 Ascend Item to @${receiver.username}! Items left: ${sender.items.ascend}.`
  );
});

// /release N – release a pet (cannot release founder)
bot.command('release', async (ctx) => {
  const user = ensureUser(ctx);
  const uname = ctx.from.username ? '@' + ctx.from.username : 'Unknown';
  console.log(`➡️ /release from ${uname}:`, ctx.message.text);

  const parts = ctx.message.text.trim().split(' ');
  if (parts.length < 2) {
    return ctx.reply('Usage: /release N\nExample: /release 2');
  }

  const index = parseInt(parts[1], 10);
  if (Number.isNaN(index) || index < 1) {
    return ctx.reply('Please provide a valid creature number. Example: /release 2');
  }

  const userPets = getUserPets(user.id);
  if (!userPets.length) {
    return ctx.reply('You have no creatures to release.');
  }

  if (index > userPets.length) {
    return ctx.reply(`You only have ${userPets.length} creatures.\nCheck /mypets for the list.`);
  }

  const pet = userPets[index - 1];
  if (pet.isFounder) {
    return ctx.reply('👑 You cannot release *GRIMNEX, THE VOID REAPER*. The bond is unbreakable.');
  }

  delete pets[pet.id];
  saveDB();

  return ctx.reply(
    `🕊 You release *${pet.name}* back into the void.\n` +
    'A new slot has opened in your roster.',
    { parse_mode: 'Markdown' }
  );
});

// Simple pet XP leveling helper
function addPetXp(pet, amount) {
  if (!pet) return;
  pet.xp = (pet.xp || 0) + amount;
  const newLevel = 1 + Math.floor((pet.xp || 0) / 50);
  if (newLevel > (pet.level || 1)) {
    const diff = newLevel - (pet.level || 1);
    pet.level = newLevel;
    pet.power += 2 * diff;
    pet.defense += 2 * diff;
    pet.speed += 1 * diff;
    pet.luck += 1 * diff;
  }
}

// /evolve N – merge duplicates into higher form
bot.command('evolve', async (ctx) => {
  const user = ensureUser(ctx);
  const uname = ctx.from.username ? '@' + ctx.from.username : 'Unknown';
  console.log(`➡️ /evolve from ${uname}:`, ctx.message.text);

  const parts = ctx.message.text.trim().split(' ');
  if (parts.length < 2) {
    return ctx.reply('Usage: /evolve N\nExample: /evolve 1');
  }

  const index = parseInt(parts[1], 10);
  if (Number.isNaN(index) || index < 1) {
    return ctx.reply('Please provide a valid creature number. Example: /evolve 1');
  }

  const userPets = getUserPets(user.id);
  if (!userPets.length) {
    return ctx.reply('You have no creatures to evolve. Use /vaultpet to discover more!');
  }

  if (index > userPets.length) {
    return ctx.reply(`You only have ${userPets.length} creatures.\nCheck /mypets for the list.`);
  }

  const basePet = userPets[index - 1];
  if (basePet.isFounder) {
    return ctx.reply('👑 Grimnex is already in his ultimate form. He cannot be evolved further.');
  }

  if ((basePet.formTier || 0) >= 2) {
    return ctx.reply(`🧬 *${basePet.name}* is already in its *${FORM_TIER_NAMES[basePet.formTier]}* form and cannot evolve further.`, { parse_mode: 'Markdown' });
  }

  const duplicates = userPets.filter(
    (p) =>
      !p.isFounder &&
      p.id !== basePet.id &&
      p.prefix === basePet.prefix &&
      p.species === basePet.species &&
      (p.formTier || 0) === (basePet.formTier || 0)
  );

  if (duplicates.length < 1) {
    return ctx.reply(
      `You need at least *2* creatures of the same form to evolve.\n` +
      `No suitable duplicate found for *${basePet.name}* (Form: ${FORM_TIER_NAMES[basePet.formTier || 0]}).`,
      { parse_mode: 'Markdown' }
    );
  }

  const consumed = duplicates[0];
  delete pets[consumed.id];

  basePet.formTier = (basePet.formTier || 0) + 1;
  basePet.power += 15;
  basePet.defense += 15;
  basePet.speed += 5;
  basePet.luck += 5;

  saveDB();

  const newForm = FORM_TIER_NAMES[basePet.formTier] || 'Ascended';
  return ctx.reply(
    `✨ *Evolution Complete!*\n\n` +
    `Your creature *${basePet.name}* has evolved to **${newForm} Form**.\n` +
    `Stats boosted and one duplicate was consumed in the process.`,
    { parse_mode: 'Markdown' }
  );
});

// /wildbattle – start a battle vs random wild creature
bot.command('wildbattle', async (ctx) => {
  const user = ensureUser(ctx);
  const uname = ctx.from.username ? '@' + ctx.from.username : 'Unknown';
  console.log(`➡️ /wildbattle from ${uname}`);

  const userPets = getUserPets(user.id);
  if (!userPets.length) {
    return ctx.reply(
      '⚠️ You have no creatures to send into battle.\nUse /vaultpet to discover one first!'
    );
  }

  if (battles[user.id]) {
    return ctx.reply(
      '⚔️ You are already in a battle!\nUse the buttons under the battle message to continue.'
    );
  }

  const buttons = userPets.map((p, idx) => {
    const label = `#${idx + 1} ${p.name} (Lv ${p.level || 1})${p.isFounder ? ' 👑' : ''}`;
    return [Markup.button.callback(label, `battle:pick:${p.id}`)];
  });

  return ctx.reply(
    '💥 *A wild anomaly stirs in the void...*\n\n' +
      'Choose a creature to send into battle:',
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: buttons,
      },
    }
  );
});

// ----------------------
// PvP helpers & command
// ----------------------

function formatUserLabelById(userId) {
  const u = users[userId];
  if (u && u.username) return '@' + u.username;
  return `Player ${userId}`;
}

function formatPvpBattleText(battle, extraLog) {
  const pet1 = pets[battle.p1PetId];
  const pet2 = pets[battle.p2PetId];

  const name1 = formatUserLabelById(battle.p1Id);
  const name2 = formatUserLabelById(battle.p2Id);

  const titleLine = battle.ranked
    ? `⚔️ *Vault Creatures Ranked Duel!* (Season ${CURRENT_SEASON})\n\n`
    : '⚔️ *Vault Creatures PvP Duel!*\n\n';

  const s1 = battle.p1Status || createEmptyStatus();
  const s2 = battle.p2Status || createEmptyStatus();

  let text = titleLine;
  text += `👤 ${name1}\n${describePetInline(pet1)}\n❤️ HP ${battle.p1Hp}/${battle.p1MaxHp}${formatStatusIcons(s1)}\n\n`;
  text += `👤 ${name2}\n${describePetInline(pet2)}\n❤️ HP ${battle.p2Hp}/${battle.p2MaxHp}${formatStatusIcons(s2)}\n\n`;

  if (extraLog) {
    text += extraLog + '\n\n';
  }

  const activeName = battle.turn === 1 ? name1 : name2;
  text += `*${activeName}* — it’s your move! (Attack / Guard / Run)`;
  return text;
}

function buildPvpKeyboard(battle) {
  return {
    inline_keyboard: [
      [Markup.button.callback('⚔️ Attack', `pvp:move:${battle.id}:attack`)],
      [Markup.button.callback('🛡 Guard', `pvp:move:${battle.id}:guard`)],
      [Markup.button.callback('🏃‍♂️ Run', `pvp:run:${battle.id}`)],
    ],
  };
}

function pvpAttack(battle, attackerIdx) {
  const attackerPet = pets[attackerIdx === 1 ? battle.p1PetId : battle.p2PetId];
  const defenderPet = pets[attackerIdx === 1 ? battle.p2PetId : battle.p1PetId];

  const attackerStatus = attackerIdx === 1 ? battle.p1Status : battle.p2Status;
  const defenderStatus = attackerIdx === 1 ? battle.p2Status : battle.p1Status;

  let attackerHp = attackerIdx === 1 ? battle.p1Hp : battle.p2Hp;
  let defenderHp = attackerIdx === 1 ? battle.p2Hp : battle.p1Hp;
  const attackerMaxHp = attackerIdx === 1 ? battle.p1MaxHp : battle.p2MaxHp;
  const defenderMaxHp = attackerIdx === 1 ? battle.p2MaxHp : battle.p1MaxHp;

  const dmg = calculateDamage(attackerPet, defenderPet, attackerStatus, defenderStatus, 1.0);

  if (attackerIdx === 1) {
    battle.p2Hp = Math.max(0, battle.p2Hp - dmg);
    defenderHp = battle.p2Hp;
  } else {
    battle.p1Hp = Math.max(0, battle.p1Hp - dmg);
    defenderHp = battle.p1Hp;
  }

  let log =
    `\n⚔️ *${attackerPet.name}* strikes *${defenderPet.name}* for *${dmg}* damage!`;

  if (defenderHp > 0) {
    const roll = Math.random();
    if (!defenderStatus.poisoned && roll < 0.2) {
      defenderStatus.poisoned = true;
      log += `\n☠️ ${defenderPet.name} is *Poisoned* in the duel!`;
    } else if (!defenderStatus.burned && roll < 0.4) {
      defenderStatus.burned = true;
      log += `\n🔥 ${defenderPet.name} is *Burned* in the duel!`;
    }
  }

  if (defenderStatus.burned && defenderHp > 0) {
    const tick = Math.max(1, Math.floor(defenderMaxHp * 0.05));
    defenderHp = Math.max(0, defenderHp - tick);
    log += `\n🔥 Burn sears ${defenderPet.name} for *${tick}* extra damage!`;
  }
  if (defenderStatus.poisoned && defenderHp > 0) {
    const tick = Math.max(1, Math.floor(defenderMaxHp * 0.04));
    defenderHp = Math.max(0, defenderHp - tick);
    log += `\n☠️ Venom saps ${defenderPet.name} for *${tick}* HP!`;
  }

  if (attackerStatus.poisoned && attackerHp > 0) {
    const tick = Math.max(1, Math.floor(attackerMaxHp * 0.03));
    attackerHp = Math.max(0, attackerHp - tick);
    log += `\n☠️ Poison bites back at *${attackerPet.name}* for *${tick}* HP!`;
  }

  if (attackerIdx === 1) {
    battle.p1Hp = attackerHp;
    battle.p2Hp = defenderHp;
  } else {
    battle.p2Hp = attackerHp;
    battle.p1Hp = defenderHp;
  }

  let ended = false;
  let winnerIdx = null;

  if (battle.p1Hp <= 0 || battle.p2Hp <= 0) {
    ended = true;
    if (battle.p1Hp > 0 && battle.p2Hp <= 0) winnerIdx = 1;
    else if (battle.p2Hp > 0 && battle.p1Hp <= 0) winnerIdx = 2;
    else winnerIdx = null;
  }

  return { log, ended, winnerIdx };
}

function pvpGuard(battle, actorIdx) {
  const pet = pets[actorIdx === 1 ? battle.p1PetId : battle.p2PetId];
  const maxHp = actorIdx === 1 ? battle.p1MaxHp : battle.p2MaxHp;
  const actorStatus = actorIdx === 1 ? battle.p1Status : battle.p2Status;

  const heal = Math.max(1, Math.floor(maxHp * 0.12));
  if (actorIdx === 1) {
    battle.p1Hp = Math.min(maxHp, battle.p1Hp + heal);
  } else {
    battle.p2Hp = Math.min(maxHp, battle.p2Hp + heal);
  }

  actorStatus.shielded = true;

  const log =
    `\n🛡 *${pet.name}* braces and recovers *${heal}* HP.\nDefense is bolstered for the rest of the duel.`;

  return { log, ended: false, winnerIdx: null };
}

async function finishPvpBattle(ctx, battle, winnerIdx, logText, reason) {
  const p1 = users[battle.p1Id];
  const p2 = users[battle.p2Id];
  const pet1 = pets[battle.p1PetId];
  const pet2 = pets[battle.p2PetId];

  const lines = [];
  lines.push('🏁 *Duel Complete!*');

  const chatId =
    battle.chatId ||
    (ctx.chat && ctx.chat.id) ||
    (ctx.callbackQuery && ctx.callbackQuery.message && ctx.callbackQuery.message.chat.id);
  const messageId =
    battle.messageId ||
    (ctx.callbackQuery && ctx.callbackQuery.message && ctx.callbackQuery.message.message_id);

  const giveRewards = reason !== 'run';

  if (winnerIdx === 1 || winnerIdx === 2) {
    const winnerUser = winnerIdx === 1 ? p1 : p2;
    const loserUser  = winnerIdx === 1 ? p2 : p1;
    const winnerPet  = winnerIdx === 1 ? pet1 : pet2;
    const loserPet   = winnerIdx === 1 ? pet2 : pet1;
    const winnerId   = winnerIdx === 1 ? battle.p1Id : battle.p2Id;
    const loserId    = winnerIdx === 1 ? battle.p2Id : battle.p1Id;

    const winnerName = formatUserLabelById(winnerId);
    const loserName  = formatUserLabelById(loserId);

    if (giveRewards) {
      const wXp = PLAYER_XP_WIN;
      const lXp = PLAYER_XP_LOSS;
      const wPetXp = PET_XP_WIN;
      const lPetXp = PET_XP_LOSS;
      const wVp = PLAYER_VP_WIN;

      winnerUser.xp = (winnerUser.xp || 0) + wXp;
      winnerUser.vp = (winnerUser.vp || 0) + wVp;
      loserUser.xp = (loserUser.xp || 0) + lXp;

      updatePlayerLevel(winnerUser);
      updatePlayerLevel(loserUser);
      addPetXp(winnerPet, wPetXp);
      addPetXp(loserPet, lPetXp);

      lines.push(`${winnerName} wins the duel against ${loserName}!`);
      lines.push(
        `Rewards:\n` +
        `• ${winnerName}: +*${wXp}* XP, +*${wPetXp}* Pet XP, +*${wVp}* VP\n` +
        `• ${loserName}: +*${lXp}* XP, +*${lPetXp}* Pet XP`
      );

      if (battle.ranked) {
        const wRankedGain = RANKED_VP_WIN;
        const lRankedGain = RANKED_VP_LOSS;

        winnerUser.rankedVp = (winnerUser.rankedVp || 0) + wRankedGain;
        loserUser.rankedVp = (loserUser.rankedVp || 0) + lRankedGain;
        winnerUser.rankedWins = (winnerUser.rankedWins || 0) + 1;
        loserUser.rankedLosses = (loserUser.rankedLosses || 0) + 1;
        winnerUser.rankedSeason = CURRENT_SEASON;
        loserUser.rankedSeason = CURRENT_SEASON;

        lines.push(
          `\n🏅 *Ranked Rewards* (Season ${CURRENT_SEASON}):\n` +
          `• ${winnerName}: +*${wRankedGain}* Ranked VP (total ${winnerUser.rankedVp})\n` +
          `• ${loserName}: +*${lRankedGain}* Ranked VP (total ${loserUser.rankedVp})`
        );
      }
    } else {
      lines.push(`${winnerName} wins the duel against ${loserName}!`);
      lines.push('_No rewards were granted for this result._');
    }
  } else {
    if (reason === 'run') {
      lines.push('The duel ends in a forfeit. No rewards granted.');
    } else {
      lines.push('No clear winner was decided.');
    }
  }

  if (reason === 'run') {
    lines.push('\n🏃‍♂️ One duelist fled the arena.');
  }

  saveDB();

  const finalText = `${logText}\n\n${lines.join('\n')}`;

  delete pvpByUser[battle.p1Id];
  delete pvpByUser[battle.p2Id];
  delete pvpBattles[battle.id];

  if (chatId && messageId) {
    try {
      return await ctx.telegram.editMessageText(
        chatId,
        messageId,
        undefined,
        finalText,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      console.error('⚠️ Failed to edit PvP message on finish:', e.message || e);
      return ctx.reply(finalText, { parse_mode: 'Markdown' });
    }
  } else if (ctx.editMessageText) {
    return ctx.editMessageText(finalText, { parse_mode: 'Markdown' });
  } else {
    return ctx.reply(finalText, { parse_mode: 'Markdown' });
  }
}

function getRankedMmr(userId) {
  const u = users[userId];
  if (!u) return 0;
  if (typeof u.rankedVp === 'number') return u.rankedVp;
  return u.vp || 0;
}

// /ranked – join ranked PvP queue
bot.command('ranked', async (ctx) => {
  const user = ensureUser(ctx);
  const uname = ctx.from.username ? '@' + ctx.from.username : 'Unknown';
  console.log(`➡️ /ranked from ${uname}`);

  const chatId = ctx.chat && ctx.chat.id;
  if (!chatId) {
    return ctx.reply('Ranked PvP must be used inside a chat.');
  }

  if (pvpByUser[user.id]) {
    return ctx.reply('⚔️ You are already in an active duel.');
  }

  rankedQueues[chatId] = rankedQueues[chatId] || [];
  const queue = rankedQueues[chatId];

  if (queue.includes(user.id)) {
    return ctx.reply('⌛ You are already in the ranked queue for this chat. Waiting for an opponent...');
  }

  if (queue.length === 0) {
    queue.push(user.id);
    return ctx.reply(
      '🎯 You entered the ranked queue.\nWaiting for another tamer to join...'
    );
  }

  const myMmr = getRankedMmr(user.id);
  let bestIdx = -1;
  let bestDiff = Infinity;

  for (let i = 0; i < queue.length; i++) {
    const otherId = queue[i];
    if (otherId === user.id) continue;
    const diff = Math.abs(getRankedMmr(otherId) - myMmr);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }

  if (bestIdx === -1) {
    queue.push(user.id);
    return ctx.reply(
      '🎯 You entered the ranked queue.\nWaiting for another tamer to join...'
    );
  }

  const opponentId = queue.splice(bestIdx, 1)[0];
  const p1Id = opponentId;
  const p2Id = user.id;

  const challengerPets = getUserPets(p1Id);
  const opponentPets = getUserPets(p2Id);

  if (!challengerPets.length || !opponentPets.length) {
    return ctx.reply(
      '⚠️ Ranked match canceled: one of the duelists has no creatures.\nBoth players need at least one creature.'
    );
  }

  const battleId = `pvp_${Date.now()}_${p1Id}_${p2Id}`;
  const msg = await ctx.reply(
    `⚔️ *Ranked Match Found!*\n\n` +
    `${formatUserLabelById(p1Id)} vs ${formatUserLabelById(p2Id)}\n\n` +
    `${formatUserLabelById(p1Id)}, choose your creature:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: challengerPets.map((p, idx) => {
          const label = `P1: #${idx + 1} ${p.name} (Lv ${p.level || 1})${p.isFounder ? ' 👑' : ''}`;
          return [Markup.button.callback(label, `pvp:pick:${battleId}:1:${p.id}`)];
        }),
      },
    }
  );

  pvpBattles[battleId] = {
    id: battleId,
    p1Id,
    p2Id,
    p1PetId: null,
    p2PetId: null,
    p1Hp: 0,
    p2Hp: 0,
    p1MaxHp: 0,
    p2MaxHp: 0,
    turn: 1,
    chatId: msg.chat.id,
    messageId: msg.message_id,
    stage: 'pick_p1',
    ranked: true,
    p1Status: createEmptyStatus(),
    p2Status: createEmptyStatus(),
  };
  pvpByUser[p1Id] = battleId;
  pvpByUser[p2Id] = battleId;
});

// /pvp @opponent – challenge another player
bot.command('pvp', async (ctx) => {
  const challenger = ensureUser(ctx);
  const uname = ctx.from.username ? '@' + ctx.from.username : 'Unknown';
  console.log(`➡️ /pvp from ${uname}:`, ctx.message.text);

  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 2 || !parts[1].startsWith('@')) {
    return ctx.reply('Usage: /pvp @opponent\n\nExample: /pvp @vault_tamer');
  }

  const opponentUsernameRaw = parts[1].replace('@', '');
  if (!opponentUsernameRaw) {
    return ctx.reply('Please tag a valid opponent username. Example: /pvp @vault_tamer');
  }

  const challengerUsernameLower = (ctx.from.username || '').toLowerCase();
  const opponentUsernameLower = opponentUsernameRaw.toLowerCase();

  if (!ctx.from.username) {
    return ctx.reply('You need a Telegram username set to use /pvp (so your opponent can be identified).');
  }

  if (challengerUsernameLower === opponentUsernameLower) {
    return ctx.reply('You cannot challenge yourself. Find another tamer to fight!');
  }

  const challengerPets = getUserPets(challenger.id);
  if (!challengerPets.length) {
    return ctx.reply('You have no creatures to duel with. Use /vaultpet first.');
  }

  const challengeId = `c_${Date.now()}_${challenger.id}`;
  pendingPvP[challengeId] = {
    challengerId: challenger.id,
    challengerUsername: ctx.from.username || null,
    opponentUsernameLower,
    status: 'pending',
    createdAt: Date.now(),
  };

  const text =
    `⚔️ *PvP Challenge Issued!*\n\n` +
    `${formatUserLabelById(challenger.id)} has challenged *@${opponentUsernameRaw}* to a duel.\n\n` +
    `If you are *@${opponentUsernameRaw}*, use the buttons below:`;

  return ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [Markup.button.callback('✅ Accept Duel', `pvp:accept:${challengeId}`)],
        [Markup.button.callback('❌ Decline', `pvp:decline:${challengeId}`)],
      ],
    },
  });
});

// --- Battle resolution helpers (PvE) ---
async function finishBattle(ctx, userId, outcome, logText) {
  const state = battles[userId];
  if (!state) {
    return ctx.editMessageText
      ? ctx.editMessageText('⚔️ The battle has already ended.', {
          parse_mode: 'Markdown',
        })
      : ctx.reply('⚔️ The battle has already ended.', { parse_mode: 'Markdown' });
  }

  const user = users[userId];
  const pet = pets[state.playerPetId];
  const enemy = state.enemy;
  const playerLevel = user?.level || 1;
  const enemyLevel = enemy.level || 1;
  const mult = getXpMultiplier(playerLevel, enemyLevel);

  let resultLines = [];
  let debugInfo = { playerXpGain: 0, petXpGain: 0, vpGain: 0, outcome };

  if (outcome === 'win') {
    const playerXpGain = Math.round(PLAYER_XP_WIN * mult);
    const petXpGain = Math.round(PET_XP_WIN * mult);
    const vpGain = Math.round(PLAYER_VP_WIN * mult);

    user.xp = (user.xp || 0) + playerXpGain;
    user.vp = (user.vp || 0) + vpGain;
    updatePlayerLevel(user);
    addPetXp(pet, petXpGain);

    debugInfo.playerXpGain = playerXpGain;
    debugInfo.petXpGain = petXpGain;
    debugInfo.vpGain = vpGain;

    resultLines.push('');
    resultLines.push('🏅 *Victory!*');
    resultLines.push(
      `You defeated *${enemy.name}* (Lv ${enemyLevel}).`
    );
    resultLines.push(
      `Rewards: +*${playerXpGain}* XP, +*${petXpGain}* Pet XP, +*${vpGain}* VP`
    );
    resultLines.push(`Total XP: *${user.xp}* (Lv ${user.level || 1})`);
    resultLines.push(`Total VP: *${user.vp}*`);
  } else if (outcome === 'lose') {
    const playerXpGain = Math.round(PLAYER_XP_LOSS * mult);
    const petXpGain = Math.round(PET_XP_LOSS * mult);

    user.xp = (user.xp || 0) + playerXpGain;
    updatePlayerLevel(user);
    addPetXp(pet, petXpGain);

    debugInfo.playerXpGain = playerXpGain;
    debugInfo.petXpGain = petXpGain;

    resultLines.push('');
    resultLines.push('💀 *Defeat…*');
    resultLines.push(
      `Your ${pet ? pet.name : 'creature'} fell to *${enemy.name}* (Lv ${enemyLevel}).`
    );
    resultLines.push(`Consolation rewards: +*${playerXpGain}* XP, +*${petXpGain}* Pet XP`);
    resultLines.push(`Total XP: *${user.xp}* (Lv ${user.level || 1})`);
  } else if (outcome === 'run') {
    resultLines.push('');
    resultLines.push('🏃‍♂️ You fled the battle. No rewards gained.');
  }

  console.log(
    `🎲 Battle finished — user=${userId}, outcome=${outcome}, mult=${mult}, ` +
      `playerXP+${debugInfo.playerXpGain}, petXP+${debugInfo.petXpGain}, VP+${debugInfo.vpGain}`
  );

  saveDB();

  const finalText = `${logText}\n\n${resultLines.join('\n')}`;

  const chatId =
    state.battleChatId ||
    (ctx.chat && ctx.chat.id) ||
    (ctx.callbackQuery && ctx.callbackQuery.message && ctx.callbackQuery.message.chat.id);
  const messageId =
    state.battleMessageId ||
    (ctx.callbackQuery && ctx.callbackQuery.message && ctx.callbackQuery.message.message_id);

  delete battles[userId];

  if (chatId && messageId) {
    try {
      return await ctx.telegram.editMessageText(
        chatId,
        messageId,
        undefined,
        finalText,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      console.error('⚠️ Failed to edit battle message on finish:', e.message || e);
      return ctx.reply(finalText, { parse_mode: 'Markdown' });
    }
  } else if (ctx.editMessageText) {
    return ctx.editMessageText(finalText, { parse_mode: 'Markdown' });
  } else {
    return ctx.reply(finalText, { parse_mode: 'Markdown' });
  }
}

function performEnemyMove(state, pet, enemy) {
  let log = '';

  // Check if enemy is stunned/frozen/shocked/blinded before acting (enemy = attacker)
  if (state.enemyStatus.frozen) {
    log += `\n❄️ *${enemy.name}* is *Frozen* and cannot move this turn!`;
    state.enemyStatus.frozen = false;
    state.turn = 'player';
    return { log, ended: false };
  }

  if (state.enemyStatus.stunned) {
    log += `\n💫 *${enemy.name}* is *Stunned* and cannot act!`;
    state.enemyStatus.stunned = false;
    state.turn = 'player';
    return { log, ended: false };
  }

  if (state.enemyStatus.shocked && Math.random() < 0.3) {
    log += `\n⚡ *${enemy.name}* is *Shocked* and its action fails!`;
    state.turn = 'player';
    return { log, ended: false };
  }

  if (state.enemyStatus.blinded && Math.random() < 0.3) {
    log += `\n👁‍🗨 *${enemy.name}* flails blindly — the attack *misses completely*!`;
    state.turn = 'player';
    return { log, ended: false };
  }

  // Check if player has Mirage active (enemy attack will miss)
  if (state.playerStatus.mirage) {
    log += `\n🌫 *Ultimate Mirage!* The foe’s attack misses entirely!`;
    state.playerStatus.mirage = false;
    // still tick status effects after a "miss"
  } else {
    const dmg = calculateDamage(enemy, pet, state.enemyStatus, state.playerStatus, 1.0);
    state.playerHp = Math.max(0, state.playerHp - dmg);
    log += `\n💥 *${enemy.name}* uses *Shadow Bite* and deals *${dmg}* damage!`;

    if (!state.playerStatus.poisoned && Math.random() < 0.20 && state.playerHp > 0) {
      state.playerStatus.poisoned = true;
      log += `\n☠️ *${pet.name}* is *Poisoned*!`;
    }
  }

  // Status ticks on player (defender)
  if (state.playerStatus.poisoned && state.playerHp > 0) {
    const tick = Math.max(1, Math.floor(state.playerMaxHp * 0.04));
    state.playerHp = Math.max(0, state.playerHp - tick);
    log += `\n☠️ Poison seeps through *${pet.name}*, dealing *${tick}* damage!`;
  }

  if (state.playerStatus.burned && state.playerHp > 0) {
    const tick = Math.max(1, Math.floor(state.playerMaxHp * 0.05));
    state.playerHp = Math.max(0, state.playerHp - tick);
    log += `\n🔥 Flames scorch *${pet.name}* for *${tick}* damage!`;
  }

  if (state.playerStatus.bleeding && state.playerHp > 0) {
    const tick = Math.max(1, Math.floor(state.playerMaxHp * 0.06));
    state.playerHp = Math.max(0, state.playerHp - tick);
    log += `\n🩸 *${pet.name}* bleeds for *${tick}* HP!`;
  }

  if (state.playerStatus.regenerating && state.playerHp > 0) {
    const heal = Math.max(1, Math.floor(state.playerMaxHp * 0.05));
    const before = state.playerHp;
    state.playerHp = Math.min(state.playerMaxHp, state.playerHp + heal);
    const gained = state.playerHp - before;
    if (gained > 0) {
      log += `\n💚 Regeneration knits *${pet.name}* back together for *${gained}* HP.`;
    }
  }

  // Enemy side status ticks as well
  if (state.enemyStatus.poisoned && state.enemyHp > 0) {
    const tick = Math.max(1, Math.floor(state.enemyMaxHp * 0.04));
    state.enemyHp = Math.max(0, state.enemyHp - tick);
    log += `\n☠️ Venom eats away at *${enemy.name}* for *${tick}* HP!`;
  }

  if (state.enemyStatus.burned && state.enemyHp > 0) {
    const tick = Math.max(1, Math.floor(state.enemyMaxHp * 0.05));
    state.enemyHp = Math.max(0, state.enemyHp - tick);
    log += `\n🔥 Flames cling to *${enemy.name}*, burning for *${tick}* damage!`;
  }

  if (state.enemyStatus.bleeding && state.enemyHp > 0) {
    const tick = Math.max(1, Math.floor(state.enemyMaxHp * 0.06));
    state.enemyHp = Math.max(0, state.enemyHp - tick);
    log += `\n🩸 *${enemy.name}* continues to bleed for *${tick}* HP!`;
  }

  if (state.enemyStatus.regenerating && state.enemyHp > 0) {
    const heal = Math.max(1, Math.floor(state.enemyMaxHp * 0.05));
    const before = state.enemyHp;
    state.enemyHp = Math.min(state.enemyMaxHp, state.enemyHp + heal);
    const gained = state.enemyHp - before;
    if (gained > 0) {
      log += `\n💚 ${enemy.name} regenerates *${gained}* HP.`;
    }
  }

  // Check end conditions (from damage or status)
  if (state.playerHp <= 0 && state.enemyHp <= 0) {
    log += `\n💥 Both creatures collapse at the same time!`;
    return { log, ended: true, outcome: 'draw' };
  }
  if (state.playerHp <= 0) {
    log += `\n💀 *${pet.name}* can fight no more...`;
    return { log, ended: true, outcome: 'lose' };
  }
  if (state.enemyHp <= 0) {
    log += `\n🏅 *${enemy.name}* falls!`;
    return { log, ended: true, outcome: 'win' };
  }

  // If still going, pass turn back to player
  state.turn = 'player';
  return { log, ended: false };
}

// -------------
// PvE callbacks
// -------------

// Pick pet for /wildbattle
bot.action(/^battle:pick:(.+)$/, async (ctx) => {
  try {
    const petId = ctx.match[1];
    const userId = getUserId(ctx);
    const user = users[userId] || ensureUser(ctx);

    if (battles[userId]) {
      return ctx.answerCbQuery('You are already in a battle.', { show_alert: true });
    }

    const pet = pets[petId];
    if (!pet || pet.ownerId !== userId) {
      return ctx.answerCbQuery('That creature is not yours or no longer exists.', { show_alert: true });
    }

    users[userId].activePetId = pet.id;

    if (pet.isFounder) {
      await sendGrimnexSummon(ctx, '*Your Summon answers the call to battle.*');
    }

    const enemy = createRandomWildPet();
    const playerMaxHp = calculateMaxHP(pet);
    const enemyMaxHp = calculateMaxHP(enemy);

    const state = {
      userId,
      playerPetId: pet.id,
      enemy,
      playerHp: playerMaxHp,
      playerMaxHp,
      enemyHp: enemyMaxHp,
      enemyMaxHp,
      playerStatus: createEmptyStatus(),
      enemyStatus: createEmptyStatus(),
      scytheUsed: false,
      reaperReturnUsed: false,
      battleChatId: ctx.chat.id,
      battleMessageId: ctx.callbackQuery.message.message_id,
      turn: (pet.speed || 1) >= (enemy.speed || 1) ? 'player' : 'enemy',
    };

    battles[userId] = state;

    let extraLog =
      `\n💥 *Battle Start!*\n` +
      `${pet.name} (Lv ${pet.level || 1}) vs ${enemy.name} (Lv ${enemy.level || 1})`;

    if (state.turn === 'enemy') {
      extraLog += `\n\n${enemy.name} is faster and moves first!`;
    }

    const text = formatBattleStateText(userId, extraLog);

    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: buildBattleKeyboard(userId),
    });

    // If enemy goes first, immediately perform its move
    if (state.turn === 'enemy') {
      const { log, ended, outcome } = performEnemyMove(state, pet, enemy);
      if (ended) {
        return finishBattle(
          ctx,
          userId,
          outcome === 'win' ? 'win' : 'lose',
          formatBattleStateText(userId, log),
        );
      }
      const updated = formatBattleStateText(userId, log);
      return ctx.editMessageText(updated, {
        parse_mode: 'Markdown',
        reply_markup: buildBattleKeyboard(userId),
      });
    }
  } catch (e) {
    console.error('battle:pick error:', e);
    return ctx.answerCbQuery('Something went wrong starting the battle.', { show_alert: true });
  }
});

// Player uses a move
bot.action(/^battle:move:([a-z_]+)$/, async (ctx) => {
  try {
    const moveKey = ctx.match[1];
    const userId = getUserId(ctx);
    const state = battles[userId];

    if (!state) {
      return ctx.answerCbQuery('No active battle.', { show_alert: true });
    }

    if (state.turn !== 'player') {
      return ctx.answerCbQuery('Not your turn yet!', { show_alert: false });
    }

    const pet = pets[state.playerPetId];
    const enemy = state.enemy;

    if (!pet) {
      delete battles[userId];
      return ctx.answerCbQuery('Your creature went missing. Battle canceled.', { show_alert: true });
    }

    const moveSet = getMoveSetForPet(pet, state);
    if (!moveSet.includes(moveKey)) {
      return ctx.answerCbQuery('That move is not available.', { show_alert: true });
    }

    const def = MOVE_DEFS[moveKey];
    if (!def) {
      return ctx.answerCbQuery('Unknown move.', { show_alert: true });
    }

    let playerLog = '';
    // Execute the move
    const res = def.execute(state, pet, enemy);
    playerLog += res.log || '';

    // End immediately if move itself declares an outcome
    if (res.ended) {
      const outcome = res.outcome || 'win';
      const finalText = formatBattleStateText(userId, playerLog);
      return finishBattle(ctx, userId, outcome, finalText);
    }

    // Now, if enemy HP <= 0, win
    if (state.enemyHp <= 0) {
      const finalText = formatBattleStateText(userId, playerLog);
      return finishBattle(ctx, userId, 'win', finalText);
    }

    // Enemy's turn
    state.turn = 'enemy';
    const midText = formatBattleStateText(userId, playerLog);
    await ctx.editMessageText(midText, {
      parse_mode: 'Markdown',
      reply_markup: buildBattleKeyboard(userId),
    });

    const { log: enemyLog, ended, outcome } = performEnemyMove(state, pet, enemy);
    const combinedLog = playerLog + enemyLog;

    if (ended) {
      const finalText = formatBattleStateText(userId, combinedLog);
      return finishBattle(
        ctx,
        userId,
        outcome === 'win' ? 'win' : (outcome === 'draw' ? 'run' : 'lose'),
        finalText,
      );
    }

    const updatedText = formatBattleStateText(userId, combinedLog);
    return ctx.editMessageText(updatedText, {
      parse_mode: 'Markdown',
      reply_markup: buildBattleKeyboard(userId),
    });
  } catch (e) {
    console.error('battle:move error:', e);
    return ctx.answerCbQuery('Error processing move.', { show_alert: true });
  }
});

// Player runs from battle
bot.action('battle:run', async (ctx) => {
  try {
    const userId = getUserId(ctx);
    const state = battles[userId];
    if (!state) {
      return ctx.answerCbQuery('No active battle to run from.', { show_alert: true });
    }

    const log = '\n🏃‍♂️ You turn tail and flee into the Vault’s shadows.';
    const text = formatBattleStateText(userId, log);
    return finishBattle(ctx, userId, 'run', text);
  } catch (e) {
    console.error('battle:run error:', e);
    return ctx.answerCbQuery('Error trying to run.', { show_alert: true });
  }
});


// -------------------------
// PvP accept/decline/picks
// -------------------------

bot.action(/^pvp:accept:(.+)$/, async (ctx) => {
  const challengeId = ctx.match[1];
  const info = pendingPvP[challengeId];
  const uname = ctx.from.username ? '@' + ctx.from.username : 'Unknown';

  if (!info) {
    return ctx.answerCbQuery('This challenge is no longer active.', { show_alert: true });
  }

  const meUsernameLower = (ctx.from.username || '').toLowerCase();
  if (meUsernameLower !== info.opponentUsernameLower) {
    return ctx.answerCbQuery('This challenge is not addressed to you.', { show_alert: true });
  }

  const challengerId = info.challengerId;
  const opponent = ensureUser(ctx);
  const opponentId = opponent.id;

  const challenger = users[challengerId];
  if (!challenger) {
    delete pendingPvP[challengeId];
    return ctx.answerCbQuery('The challenger is no longer available.', { show_alert: true });
  }

  if (pvpByUser[challengerId] || pvpByUser[opponentId]) {
    delete pendingPvP[challengeId];
    return ctx.answerCbQuery('Either you or the challenger is already in a duel.', { show_alert: true });
  }

  const challengerPets = getUserPets(challengerId);
  const opponentPets = getUserPets(opponentId);

  if (!challengerPets.length || !opponentPets.length) {
    delete pendingPvP[challengeId];
    return ctx.editMessageText(
      '⚠️ PvP duel canceled: both players need at least one creature to fight.',
      { parse_mode: 'Markdown' }
    );
  }

  info.status = 'accepted';
  delete pendingPvP[challengeId];

  const battleId = `pvp_${Date.now()}_${challengerId}_${opponentId}`;
  const msg = await ctx.editMessageText(
    `⚔️ *PvP Duel Accepted!*\n\n` +
    `${formatUserLabelById(challengerId)} vs ${formatUserLabelById(opponentId)}\n\n` +
    `${formatUserLabelById(challengerId)}, choose your creature:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: challengerPets.map((p, idx) => {
          const label = `P1: #${idx + 1} ${p.name} (Lv ${p.level || 1})${p.isFounder ? ' 👑' : ''}`;
          return [Markup.button.callback(label, `pvp:pick:${battleId}:1:${p.id}`)];
        }),
      },
    }
  );

  pvpBattles[battleId] = {
    id: battleId,
    p1Id: challengerId,
    p2Id: opponentId,
    p1PetId: null,
    p2PetId: null,
    p1Hp: 0,
    p2Hp: 0,
    p1MaxHp: 0,
    p2MaxHp: 0,
    turn: 1,
    chatId: msg.chat.id,
    messageId: msg.message_id,
    stage: 'pick_p1',
    ranked: false,
    p1Status: createEmptyStatus(),
    p2Status: createEmptyStatus(),
  };
  pvpByUser[challengerId] = battleId;
  pvpByUser[opponentId] = battleId;

  console.log(`✅ PvP battle created: ${battleId} (${challengerId} vs ${opponentId})`);
});

bot.action(/^pvp:decline:(.+)$/, async (ctx) => {
  const challengeId = ctx.match[1];
  const info = pendingPvP[challengeId];

  if (!info) {
    return ctx.answerCbQuery('This challenge is no longer active.', { show_alert: true });
  }

  const meUsernameLower = (ctx.from.username || '').toLowerCase();
  if (meUsernameLower !== info.opponentUsernameLower) {
    return ctx.answerCbQuery('This challenge is not addressed to you.', { show_alert: true });
  }

  delete pendingPvP[challengeId];

  return ctx.editMessageText(
    `❌ PvP challenge was declined by @${ctx.from.username}.`,
    { parse_mode: 'Markdown' }
  );
});

bot.action(/^pvp:pick:([^:]+):([12]):(.+)$/, async (ctx) => {
  const battleId = ctx.match[1];
  const slotIdx = parseInt(ctx.match[2], 10); // 1 or 2
  const petId = ctx.match[3];

  const battle = pvpBattles[battleId];
  if (!battle) {
    return ctx.answerCbQuery('PvP battle not found.', { show_alert: true });
  }

  const userId = getUserId(ctx);
  if ((slotIdx === 1 && userId !== battle.p1Id) || (slotIdx === 2 && userId !== battle.p2Id)) {
    return ctx.answerCbQuery('You cannot pick for this slot.', { show_alert: true });
  }

  const pet = pets[petId];
  if (!pet || pet.ownerId !== userId) {
    return ctx.answerCbQuery('That creature is not yours or no longer exists.', { show_alert: true });
  }

  users[userId].activePetId = pet.id;

  if (pet.isFounder) {
    const summoner = formatUserLabelById(userId);
    await sendGrimnexSummon(ctx, `${summoner} summons the Founder into the duel!`);
  }

  if (slotIdx === 1 && battle.p1PetId) {
    return ctx.answerCbQuery('Player 1 creature is already chosen.', { show_alert: true });
  }
  if (slotIdx === 2 && battle.p2PetId) {
    return ctx.answerCbQuery('Player 2 creature is already chosen.', { show_alert: true });
  }

  if (slotIdx === 1) {
    battle.p1PetId = pet.id;
    battle.p1MaxHp = calculateMaxHP(pet);
    battle.p1Hp = battle.p1MaxHp;
    battle.stage = 'pick_p2';
  } else {
    battle.p2PetId = pet.id;
    battle.p2MaxHp = calculateMaxHP(pet);
    battle.p2Hp = battle.p2MaxHp;
  }

  // If only P1 picked yet, show prompt for P2
  if (!battle.p2PetId) {
    const p2Pets = getUserPets(battle.p2Id);
    return ctx.editMessageText(
      `⚔️ PvP Duel: ${formatUserLabelById(battle.p1Id)} vs ${formatUserLabelById(battle.p2Id)}\n\n` +
      `${formatUserLabelById(battle.p1Id)} has chosen their creature.\n\n` +
      `${formatUserLabelById(battle.p2Id)}, choose your creature:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: p2Pets.map((p, idx) => {
            const label = `P2: #${idx + 1} ${p.name} (Lv ${p.level || 1})${p.isFounder ? ' 👑' : ''}`;
            return [Markup.button.callback(label, `pvp:pick:${battleId}:2:${p.id}`)];
          }),
        },
      }
    );
  }

  // Both chosen — start duel
  battle.stage = 'active';
  battle.turn = 1;

  const text = formatPvpBattleText(battle, '\n💥 The duel begins!');
  return ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: buildPvpKeyboard(battle),
  });
});

// PvP moves
bot.action(/^pvp:move:([^:]+):(attack|guard)$/, async (ctx) => {
  const battleId = ctx.match[1];
  const action = ctx.match[2];
  const battle = pvpBattles[battleId];

  if (!battle) {
    return ctx.answerCbQuery('This duel has already ended.', { show_alert: true });
  }

  const userId = getUserId(ctx);
  const actorIdx = battle.turn;
  const isP1 = userId === battle.p1Id;
  const isP2 = userId === battle.p2Id;

  if (!isP1 && !isP2) {
    return ctx.answerCbQuery('You are not part of this duel.', { show_alert: true });
  }

  if ((actorIdx === 1 && !isP1) || (actorIdx === 2 && !isP2)) {
    return ctx.answerCbQuery('Not your turn.', { show_alert: false });
  }

  let result;
  if (action === 'attack') {
    result = pvpAttack(battle, actorIdx);
  } else {
    result = pvpGuard(battle, actorIdx);
  }

  let log = result.log || '';
  let ended = result.ended;
  let winnerIdx = result.winnerIdx;

  if (!ended) {
    // Switch turn
    battle.turn = actorIdx === 1 ? 2 : 1;
    const text = formatPvpBattleText(battle, log);
    return ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: buildPvpKeyboard(battle),
    });
  }

  const text = formatPvpBattleText(battle, log);
  return finishPvpBattle(ctx, battle, winnerIdx, text, 'normal');
});

bot.action(/^pvp:run:([^:]+)$/, async (ctx) => {
  const battleId = ctx.match[1];
  const battle = pvpBattles[battleId];

  if (!battle) {
    return ctx.answerCbQuery('This duel has already ended.', { show_alert: true });
  }

  const userId = getUserId(ctx);
  const isP1 = userId === battle.p1Id;
  const isP2 = userId === battle.p2Id;

  if (!isP1 && !isP2) {
    return ctx.answerCbQuery('You are not part of this duel.', { show_alert: true });
  }

  const runnerName = formatUserLabelById(userId);
  const log = `\n🏃‍♂️ ${runnerName} flees the duel!`;
  const winnerIdx = isP1 ? 2 : 1;

  const text = formatPvpBattleText(battle, log);
  return finishPvpBattle(ctx, battle, winnerIdx, text, 'run');
});

// -----------------
// Owner-only tools
// -----------------

function isOwner(ctx) {
  return (ctx.from.username || '').toLowerCase() === OWNER_USERNAME;
}

// /resetdaily – owner: reset daily discoveries
bot.command('resetdaily', async (ctx) => {
  if (!isOwner(ctx)) {
    return ctx.reply('Only the Vault Overseer can use this command.');
  }
  Object.values(users).forEach((u) => {
    u.discoveriesToday = 0;
    u.lastDiscoveryDate = null;
  });
  saveDB();
  return ctx.reply('✅ All daily discovery limits have been reset for every trainer.');
});

// /testrevive – owner: preview Grimnex revive text
bot.command('testrevive', async (ctx) => {
  if (!isOwner(ctx)) {
    return ctx.reply('Only the Vault Overseer can use this command.');
  }
  await sendGrimnexImage(ctx, REAPER_RETURN_TEXT);
});

// /scythetest – owner: preview Scythe of Oblivion text
bot.command('scythetest', async (ctx) => {
  if (!isOwner(ctx)) {
    return ctx.reply('Only the Vault Overseer can use this command.');
  }
  await sendGrimnexImage(ctx, SCYTHE_FLAVOR_TEXT);
});

// ---------------
// Bot lifecycle
// ---------------

bot.launch().then(() => {
  console.log('🤖 Vault Creatures Bot is live.');
});

// Enable graceful stop
process.once('SIGINT', () => {
  console.log('👋 SIGINT received, stopping bot...');
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  console.log('👋 SIGTERM received, stopping bot...');
  bot.stop('SIGTERM');
});
