require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { commands } = require('./deploy-commands');

const TEST_ONLY_COMMAND_NAMES = new Set(['add', 'collection', 'minigame']);

async function deployTestCommands() {
  const guildId = process.env.TEST_GUILD_ID;
  if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID || !guildId) {
    throw new Error('DISCORD_TOKEN, CLIENT_ID, and TEST_GUILD_ID are required.');
  }

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const testCommands = commands.filter((command) => TEST_ONLY_COMMAND_NAMES.has(command.name));
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId), {
    body: testCommands,
  });
  console.log(`V1.1.0 test-only commands registered in guild ${guildId}.`);
}

deployTestCommands().catch((error) => {
  console.error('Failed to register test commands:', error);
  process.exitCode = 1;
});
