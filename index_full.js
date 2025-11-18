// index.js
require('dotenv').config();
const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');

/* -------------------------
   ENV & BOT SETUP
------------------------- */

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_USERNAME = process.env.OWNER_USERNAME; // e.g. cryptobie1 (no @)
const DATA_FILE = path.join(__dirname, 'data.json');

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is missing in .env');
  process.exit(1);
}

console.log('🔑 BOT_TOKEN loaded:', BOT_TOKEN ? 'OK' : 'MISSING');
console.log('👑 OWNER_USERNAME:', OWNER_USERNAME || 'NOT SET');

const bot = new Telegraf(BOT_TOKEN);

/* -------------------------
   SIMPLE PERSISTENT STORAGE
------------------------- */

let db = {
  users: {}, // { [userId]: User }
  pets: {},  // { [petId]: Pet }
};

function loadDB() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      db = JSON.parse(raw);
      console.log('📂 DB loaded:', Object.keys(db.users).length, 'users,', Object.keys(db.pets).length, 'pets');
    } else {
      console.log('📄 No data.json found, starting fresh DB.');
      saveDB();
    }
  } catch (err) {
    console.error('❌ Failed to load DB:', err);
    db = { users: {}, pets: {} };
  }
}

function saveDB() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('❌ Failed to save DB:', err);
  }
}

/* -------------------------
   UTILITIES
------------------------- */

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function todayStr() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function newId() {
  return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function isOwner(ctx) {
  const username = (ctx.from?.username || '').toLowerCase();
  const owner = (OWNER_USERNAME || '').toLowerCase();
  return username && owner && username === owner;
}

/* -------------------------
   GAME CONSTANTS
------------------------- */

const BASE_DISCOVERIES_PER_DAY = 3;
const EXTRA_DISCOVERY_LEVEL_REQUIREMENT = 5;
const MAX_DISCOVERIES_PER_DAY = 4;
const MAX_PETS_PER_USER = 20;

const RARITY_WEIGHTS = {
  common: 45,
  uncommon: 30,
  rare: 15,
  epic: 8,
  legendary: 2,
};

const STAT_RANGES = {
  common:    { min: 25, max: 50 },
  uncommon:  { min: 40, max: 65 },
  rare:      { min: 60, max: 80 },
  epic:      { min: 75, max: 95 },
  legendary: { min: 90, max: 100 },
  founder:   { min: 100, max: 100 }, // Grimnex only
};

const PLAYER_LEVEL_THRESHOLDS = [
  { level: 1, xp: 0 },
  { level: 2, xp: 50 },
  { level: 3, xp: 120 },
  { level: 4, xp: 200 },
  { level: 5, xp: 300 },
  { level: 6, xp: 420 },
  { level: 7, xp: 560 },
  { level: 8, xp: 720 },
  { level: 9, xp: 900 },
  { level: 10, xp: 1100 },
  { level: 15, xp: 1800 },
  { level: 20, xp: 2600 },
  { level: 30, xp: 4000 },
];

const MOODS = ['Calm', 'Hyper', 'Curious', 'Focused', 'Agitated', 'Sleepy'];
const TYPES = ['arcane', 'cosmic', 'crystal', 'shadow', 'quantum', 'temporal', 'supra'];

const PREFIXES = [
  'Quantum', 'Void', 'Arcane', 'Crystal', 'Phantom', 'Nova',
  'Shadow', 'Stellar', 'Flux', 'Celestial', 'Vault', 'Ebon',
];

const SPECIES = [
  'Serpent', 'Warden', 'Wisp', 'Golem', 'Beast', 'Hound',
  'Dragon', 'Spirit', 'Chimera', 'Titan', 'Raven', 'Reaper',
];

const ORIGINS = [
  'Born in the depths of the Infinite Vault.',
  'Forged by Supra Node 8 during an energy spike.',
  'Found guarding ancient relics in the Purple Nexus.',
  'Roams the edges of Supra L1, watching in silence.',
  'Emerging from a collapsed dimension near the Vault.',
  'Summoned by forgotten smart contracts.',
];


/* -------------------------
   USER & PET HELPERS
------------------------- */

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

function ensureUser(telegramUser) {
  const id = String(telegramUser.id);
  if (!db.users[id]) {
    db.users[id] = {
      id,
      username: telegramUser.username || null,
      xp: 0,
      level: 1,
      vp: 0,
      discoveriesToday: 0,
      lastDiscoveryDate: null,
      lastCheckinDate: null,
      titlesUnlocked: [],
      activeTitle: null,
      badge: null,
    };
    // If this is the owner, also ensure Grimnex exists
    if ((telegramUser.username || '').toLowerCase() === (OWNER_USERNAME || '').toLowerCase()) {
      ensureOwnerGrimnex(id);
    }
    saveDB();
  }
  return db.users[id];
}

function updateUserLevelAndRewards(user) {
  const newLevel = calculatePlayerLevel(user.xp);
  if (newLevel > user.level) {
    user.level = newLevel;
    // For now, just log. Titles/badges can be wired later.
    console.log(`⭐ User ${user.username || user.id} reached level ${user.level}`);
  }
}

function getUserPets(userId) {
  return Object.values(db.pets).filter((p) => p.ownerId === userId);
}

function rollRarity() {
  const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (const [rarity, weight] of Object.entries(RARITY_WEIGHTS)) {
    if (roll < weight) return rarity;
    roll -= weight;
  }
  return 'common';
}

function rollStats(range) {
  return {
    power: randomInt(range.min, range.max),
    defense: randomInt(range.min, range.max),
    speed: randomInt(range.min, range.max),
    luck: randomInt(range.min, range.max),
  };
}

function generateBaseName() {
  const prefix = randomFrom(PREFIXES);
  const species = randomFrom(SPECIES);
  return prefix + ' ' + species;
}

function generatePet(ownerId) {
  const rarity = rollRarity();
  const type = randomFrom(TYPES);
  const baseName = generateBaseName();
  const stats = rollStats(STAT_RANGES[rarity]);
  const mood = randomFrom(MOODS);
  const origin = randomFrom(ORIGINS);

  const id = newId();
  const pet = {
    id,
    ownerId,
    name: baseName,
    baseName,
    rarity,
    type,
    tier: 'base',
    level: 1,
    xp: 0,
    power: stats.power,
    defense: stats.defense,
    speed: stats.speed,
    luck: stats.luck,
    mood,
    origin,
    pinned: false,
    createdAt: new Date().toISOString(),
  };

  db.pets[id] = pet;
  saveDB();
  return pet;
}

/* -------------------------
   OWNER PET: GRIMNEX
------------------------- */

function ensureOwnerGrimnex(ownerId) {
  // Check if owner already has a founder pet
  const existing = Object.values(db.pets).find(
    (p) => p.ownerId === ownerId && p.tier === 'founder'
  );
  if (existing) return existing;

  const id = newId();
  const pet = {
    id,
    ownerId,
    name: 'GRIMNEX, THE VOID REAPER',
    baseName: 'GRIMNEX, THE VOID REAPER',
    rarity: 'founder',
    type: 'shadow',
    tier: 'founder',
    level: 100,
    xp: 0,
    power: 100,
    defense: 100,
    speed: 100,
    luck: 100,
    mood: 'Eternal Calm',
    origin: 'Born from the ashes of failed chains, Grimnex wanders the Supra Realms collecting fallen spirits.',
    pinned: true,
    createdAt: new Date().toISOString(),
  };

  db.pets[id] = pet;
  saveDB();
  console.log('💀 Owner pet GRIMNEX created for', ownerId);
  return pet;
}

/* -------------------------
   COMMAND HANDLERS
------------------------- */

// /start
bot.start((ctx) => {
  const user = ensureUser(ctx.from);
  const uname = ctx.from.username ? '@' + ctx.from.username : 'Unknown';
  const ownerNote = isOwner(ctx)
    ? '\n\n💀 You are the *Owner* of GRIMNEX, THE VOID REAPER.'
    : '';

  console.log(`➡️ /start from ${uname}`);

  ctx.reply(
    `💜 Welcome to *Supra Vault Creatures*!

Discover, battle, evolve, and collect your own Vault Pets.

Basic commands:
/vaultpet - Discover a new creature
/mypets   - View your collection
/release N - Release a pet by its number
/battle @user - Challenge someone to a duel (coming soon)
/profile  - View your player profile
/checkin  - Daily XP reward

You are: ${uname}${ownerNote}`,
    { parse_mode: 'Markdown' }
  );
});

// /vaultpet - real discovery logic
bot.command('vaultpet', (ctx) => {
  const user = ensureUser(ctx.from);
  const uname = ctx.from.username ? '@' + ctx.from.username : 'Unknown';
  console.log(`➡️ /vaultpet from ${uname}`);

  const today = todayStr();
  if (user.lastDiscoveryDate !== today) {
    user.lastDiscoveryDate = today;
    user.discoveriesToday = 0;
  }

  const maxDaily =
    user.level >= EXTRA_DISCOVERY_LEVEL_REQUIREMENT
      ? MAX_DISCOVERIES_PER_DAY
      : BASE_DISCOVERIES_PER_DAY;

  if (user.discoveriesToday >= maxDaily) {
    return ctx.reply(
      `🔒 You have reached your daily discovery limit of ${maxDaily} creatures.\nCome back tomorrow or level up for more perks.`
    );
  }

  const pets = getUserPets(user.id);
  if (pets.length >= MAX_PETS_PER_USER) {
    return ctx.reply(
      `📦 Your roster is full (${pets.length}/${MAX_PETS_PER_USER}).\nUse /mypets to view them and /release N to free a slot.`
    );
  }

  // Generate pet
  const pet = generatePet(user.id);
  user.discoveriesToday += 1;

  // User XP for discovery
  user.xp += 2;
  updateUserLevelAndRewards(user);
  saveDB();

  ctx.reply(
    `🟣 A new Vault Creature emerges from the darkness!

Name: *${pet.name}*
Rarity: ${pet.rarity.toUpperCase()}
Type: ${pet.type.toUpperCase()}
Level: ${pet.level}
Power: ${pet.power}
Defense: ${pet.defense}
Speed: ${pet.speed}
Luck: ${pet.luck}
Mood: ${pet.mood}
Origin: ${pet.origin}

🔢 You have discovered ${user.discoveriesToday}/${maxDaily} creatures today.`,
    { parse_mode: 'Markdown' }
  );
});

// /mypets - list pets
bot.command('mypets', (ctx) => {
  const user = ensureUser(ctx.from);
  const uname = ctx.from.username ? '@' + ctx.from.username : 'Unknown';
  console.log(`➡️ /mypets from ${uname}`);

  const pets = getUserPets(user.id);
  if (!pets.length) {
    return ctx.reply('📁 You have no Vault Creatures yet. Use /vaultpet to discover one!');
  }

  // Sort: pinned first, then newest
  pets.sort((a, b) => {
    if (a.tier === 'founder' && b.tier !== 'founder') return -1;
    if (b.tier === 'founder' && a.tier !== 'founder') return 1;
    if (a.pinned && !b.pinned) return -1;
    if (b.pinned && !a.pinned) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  let text = `📜 *Your Vault Creatures* (${pets.length}/${MAX_PETS_PER_USER})\n\n`;
  pets.forEach((p, idx) => {
    const tierLabel = p.tier === 'founder'
      ? 'FOUNDER'
      : p.tier === 'prime'
      ? 'PRIME'
      : p.tier === 'omega'
      ? 'OMEGA'
      : 'BASE';

    text += `${idx + 1}. *${p.name}* [${tierLabel} | ${p.rarity.toUpperCase()} | ${p.type.toUpperCase()}]\n   Lvl ${p.level} | P:${p.power} D:${p.defense} S:${p.speed} L:${p.luck}\n`;
    if (p.mood) text += `   Mood: ${p.mood}\n`;
    text += '\n';
  });

  text += `Use /release N to release a pet by its number (e.g. /release 2).`;

  ctx.reply(text, { parse_mode: 'Markdown' });
});

// /release N - release by index in /mypets list
bot.command('release', (ctx) => {
  const user = ensureUser(ctx.from);
  const uname = ctx.from.username ? '@' + ctx.from.username : 'Unknown';
  console.log(`➡️ /release from ${uname}`);

  const parts = ctx.message.text.trim().split(' ');
  if (parts.length < 2) {
    return ctx.reply('Usage: /release N\nExample: /release 2');
  }

  const index = parseInt(parts[1], 10);
  if (isNaN(index) || index < 1) {
    return ctx.reply('Please provide a valid pet number. Example: /release 2');
  }

  const pets = getUserPets(user.id);
  if (!pets.length) {
    return ctx.reply('You have no pets to release.');
  }

  // Sort same as /mypets to ensure consistent indexing
  pets.sort((a, b) => {
    if (a.tier === 'founder' && b.tier !== 'founder') return -1;
    if (b.tier === 'founder' && a.tier !== 'founder') return 1;
    if (a.pinned && !b.pinned) return -1;
    if (b.pinned && !a.pinned) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  if (index > pets.length) {
    return ctx.reply(`You only have ${pets.length} pets. Use /mypets to see their numbers.`);
  }

  const pet = pets[index - 1];

  // Prevent releasing founder Grimnex
  if (pet.tier === 'founder') {
    return ctx.reply('💀 GRIMNEX cannot be released. The Void Reaper is bound to the Owner forever.');
  }

  delete db.pets[pet.id];

  // User XP bonus (later we can gate with level ≥15 if you want)
  user.xp += 5;
  updateUserLevelAndRewards(user);
  saveDB();

  ctx.reply(
    `🌫️ You release *${pet.name}* back into the Vault.\n(+5 Player XP)`,
    { parse_mode: 'Markdown' }
  );
});

// /profile - simple player info
bot.command('profile', (ctx) => {
  const user = ensureUser(ctx.from);
  const uname = ctx.from.username ? '@' + ctx.from.username : 'Unknown';
  console.log(`➡️ /profile from ${uname}`);

  const pets = getUserPets(user.id);
  const lines = [];

  lines.push('🧬 *Player Profile*');
  lines.push('');
  lines.push(`Username: @${ctx.from.username || 'Unknown'}`);
  lines.push(`Level: ${user.level}`);
  lines.push(`XP: ${user.xp}`);
  lines.push(`VP: ${user.vp}`);
  lines.push(`Creatures: ${pets.length}/${MAX_PETS_PER_USER}`);

  ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
});

// /checkin - daily XP
bot.command('checkin', (ctx) => {
  const user = ensureUser(ctx.from);
  const uname = ctx.from.username ? '@' + ctx.from.username : 'Unknown';
  console.log(`➡️ /checkin from ${uname}`);

  const today = todayStr();
  if (user.lastCheckinDate === today) {
    return ctx.reply('✅ You already claimed your daily check-in reward today.');
  }

  user.lastCheckinDate = today;
  user.xp += 3;
  updateUserLevelAndRewards(user);
  saveDB();

  ctx.reply('🎁 Daily check-in complete! You gained +3 Player XP.');
});

// OWNER-ONLY: /grantlvl (still placeholder, but protected)
bot.command('grantlvl', (ctx) => {
  const user = ensureUser(ctx.from);
  const uname = ctx.from.username ? '@' + ctx.from.username : 'Unknown';
  console.log(`➡️ /grantlvl from ${uname}`);

  if (!isOwner(ctx)) {
    return ctx.reply('❌ Only the *Owner* can use this command.', {
      parse_mode: 'Markdown',
    });
  }

  const parts = ctx.message.text.trim().split(' ');
  if (parts.length < 3) {
    return ctx.reply('Usage: /grantlvl @username Pet Name');
  }

  const targetUsername = parts[1].replace('@', '').toLowerCase();
  const petName = parts.slice(2).join(' ');

  const targetUser = Object.values(db.users).find(
    (u) => (u.username || '').toLowerCase() === targetUsername
  );

  if (!targetUser) {
    return ctx.reply(`Could not find user @${targetUsername} in the DB yet. They must start the bot at least once.`);
  }

  const pets = getUserPets(targetUser.id);
  const pet = pets.find((p) => p.name.toLowerCase() === petName.toLowerCase());

  if (!pet) {
    return ctx.reply(`User @${targetUsername} does not have a pet named "${petName}".`);
  }

  // Very simple +1 level: add enough XP to level once
  const xpToNext = 50; // placeholder small bump
  pet.xp += xpToNext;
  // You can later plug in real xpRequiredForPetLevel logic

  saveDB();

  ctx.reply(
    `🎁 Owner has granted +1 Level to *${pet.name}* for @${targetUsername}!`,
    { parse_mode: 'Markdown' }
  );
});

// OWNER-ONLY: /scythe (flavor, battle integration later)
bot.command('scythe', (ctx) => {
  const user = ensureUser(ctx.from);
  const uname = ctx.from.username ? '@' + ctx.from.username : 'Unknown';
  console.log(`➡️ /scythe from ${uname}`);

  if (!isOwner(ctx)) {
    return ctx.reply('❌ Only the *Owner* can command the Scythe of Oblivion.', {
      parse_mode: 'Markdown',
    });
  }

  const parts = ctx.message.text.trim().split(' ');
  const petName = parts.slice(1).join(' ') || 'Grimnex';

  ctx.reply(
    `💀 ${petName} unleashes *Scythe of Oblivion*!
A dimensional tear slices through reality…
**Instant KO!**`,
    { parse_mode: 'Markdown' }
  );

  // Later: tie this into an active battle session
});

// Fallback: generic text handler
bot.on('text', (ctx) => {
  const uname = ctx.from.username ? '@' + ctx.from.username : 'Unknown';
  const msg = ctx.message.text;
  console.log(`💬 Message from ${uname}: ${msg}`);

  if (!msg.startsWith('/')) {
    ctx.reply('✨ Use /vaultpet, /mypets, /release, /profile, or /checkin to play.');
  }
});

/* -------------------------
   START BOT
------------------------- */

loadDB();

console.log('▶️ Launching Vault Creatures Bot...');
bot.launch()
  .then(() => console.log('🚀 Bot launched successfully!'))
  .catch((err) => {
    console.error('❌ Bot launch error:', err);
    process.exit(1);
  });

process.once('SIGINT', () => {
  console.log('🛑 Stopping bot (SIGINT)…');
  bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
  console.log('🛑 Stopping bot (SIGTERM)…');
  bot.stop('SIGTERM');
});

