require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { commands } = require('./deploy-commands');
const { version } = require('./package.json');

async function deployTestCommands() {
  const guildId = process.env.TEST_GUILD_ID;
  if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID || !guildId) {
    throw new Error('DISCORD_TOKEN, CLIENT_ID, and TEST_GUILD_ID are required.');
  }

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const minigameCommand = commands.find((command) => command.name === 'minigame');
  const despawnCommand = commands.find((command) => command.name === 'despawn');
  const testCommands = [
    {
      ...minigameCommand,
      name: 'minigame-test',
      description: 'Test the upcoming CATCH WALLAHIS update',
    },
    despawnCommand,
  ];
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId), {
    body: testCommands,
  });
  console.log(`V${version} test-only commands registered in guild ${guildId}.`);
}

deployTestCommands().catch((error) => {
  console.error('Failed to register test commands:', error);
  process.exitCode = 1;
});
