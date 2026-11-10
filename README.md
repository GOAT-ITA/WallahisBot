# WallahisBot v1.1.0 🔥

Bot Discord che traccia livelli e XP Wallahi e include il minigioco CATCH WALLAHIS.

## Configurazione

Variabili ambiente richieste:

- `DISCORD_TOKEN`
- `CLIENT_ID`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `OWNER_DISCORD_ID`

`GUILD_ID` è opzionale e viene usato solo per rimuovere i vecchi comandi specifici del server durante `npm run deploy`.

## Avvio

- `npm start` avvia il bot.
- `npm run deploy` registra globalmente gli slash command.
- `npm run deploy:test` registra gli slash command soltanto nel server indicato da `TEST_GUILD_ID`.

Il minigioco è disattivato finché un utente con il ruolo `Wallahi` non configura il primo canale tramite `/minigame channel`.
