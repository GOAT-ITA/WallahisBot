# WallahisBot 🔥

Bot Discord che traccia i "Wallahi" dei membri del server.

## Come funziona

- Quando qualcuno scrive **ISHOWSPEED** (in qualsiasi combinazione di maiuscole/minuscole) guadagna 1 Wallahi.
- Quando qualcuno scrive **Wallahi**, **Wallahis** o **Wallah** (qualsiasi maiuscole/minuscole) perde 1 Wallahi.
- Se un messaggio contiene entrambe le parole chiave, viene ignorato.
- I Wallahi non possono andare sotto 0. Se uno è già a 0 e scrive una parola "perdi-wallahi", non succede niente.
- Ogni nuovo membro che entra nel server parte da 0 Wallahi (se non ne ha già).
- I dati si resettano ogni volta che il bot viene riavviato/rimosso (sono tenuti in memoria, non salvati su disco).

## Comandi

- `/give utente quantità` — dà N wallahi a un utente. Richiede il ruolo **Wallahi**.
- `/remove utente` — azzera i wallahi di un utente. Richiede il ruolo **Wallahi**.
- `/leaderboard` — mostra la top 5 del server (ordine fisso, in caso di pari va per ordine di inserimento).

---

## SETUP — Passo per passo

### 1. Installa Node.js (se non ce l'hai)

Scarica e installa la versione LTS da: https://nodejs.org

Per verificare che sia installato, apri il **Prompt dei comandi** (cmd) e scrivi:
```
node -v
```
Deve mostrarti un numero tipo `v20.x.x` o superiore.

### 2. Sistema la cartella del progetto

Metti tutti questi file dentro:
```
C:\Users\nicol\Desktop\Other\DiscordBots\WallahisBot
```

### 3. Crea il file `.env`

- Rinomina `.env.example` in `.env`
- Aprilo con il Blocco Note
- Inserisci il tuo **token del bot** (quello nuovo, rigenerato) al posto del placeholder
- Client ID e Guild ID sono già inseriti, controlla che siano giusti

Il file finale deve assomigliare a:
```
DISCORD_TOKEN=il_tuo_vero_token_qui
CLIENT_ID=1544844350457118760
GUILD_ID=1374467763904712827
```

### 4. Apri il terminale nella cartella del progetto

- Apri la cartella `WallahisBot` in Esplora File
- Nella barra dell'indirizzo scrivi `cmd` e premi Invio (si apre il terminale già dentro quella cartella)

### 5. Installa le dipendenze

Nel terminale scrivi:
```
npm install
```
Aspetta che finisca (crea la cartella `node_modules`).

### 6. Registra i comandi slash su Discord

Sempre nel terminale:
```
npm run deploy
```
Deve stampare `✅ Comandi slash registrati con successo!`
(questo comando va rifatto solo se in futuro modifichi/aggiungi comandi)

### 7. Avvia il bot

```
npm start
```
Deve stampare `✅ Bot online come WallahisBot#xxxx`

Se vedi quel messaggio, il bot è online! Vai su Discord e prova a scrivere "ISHOWSPEED" in un canale.

### 8. Tenere il bot sempre acceso

Finché il terminale resta aperto con `npm start` in esecuzione, il bot è online.
Se chiudi il terminale, il bot si spegne (e i dati dei wallahi si resettano, come richiesto).

Per fermarlo: premi `CTRL + C` nel terminale.

---

## Problemi comuni

- **"npm non è riconosciuto come comando"** → Node.js non è installato correttamente, riavvia il PC dopo l'installazione.
- **Il bot non risponde ai messaggi** → controlla di aver attivato "Message Content Intent" nel Developer Portal (Bot → Privileged Gateway Intents).
- **I comandi slash non compaiono su Discord** → aspetta qualche minuto, oppure riavvia Discord (CTRL+R), oppure ricontrolla di aver lanciato `npm run deploy`.
- **Errore "Used disallowed intents"** → vai nel Developer Portal → Bot → attiva sia "Message Content Intent" che "Server Members Intent".
