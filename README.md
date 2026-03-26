# insider-game

## Setup

Install dependencies:

```bash
npm install
```

Run the app with your MongoDB connection string:

```bash
MONGO_URL="your-mongo-url" npm start
```

Check that the app can reach MongoDB before starting:

```bash
MONGO_URL="your-mongo-url" npm run check:db
```

Run the self-contained Werewolf smoke test:

```bash
npm run smoke:werewolf
npm run smoke:werewolf:selection
npm run smoke:werewolf:roles
npm run smoke:werewolf:5
npm run smoke:werewolf:6
```

Print the recommended 3-player Werewolf role rotation for solo manual testing:

```bash
npm run plan:werewolf:3
```

This prints a sequence of exact 3-role room setups that lets one person cycle through every active Werewolf role across multiple 3-player rounds.

## Local Data Files

The app can fall back to local JSON files under `data/` when `MONGO_URL` is not provided.

Do not push these local data files to the remote repository:

- `data/playerStats.json`
- `data/players.json`

These files are treated as local runtime and smoke-test artifacts only.
If they change during local testing, leave them out of commits and pushes.

Enable the repository pre-push hook locally so Git blocks these files automatically:

```bash
git config core.hooksPath .githooks
chmod +x .githooks/pre-push
```

If `MONGO_URL` is not provided, the app falls back to local JSON files in `data/`.

App is responding by default on port `8080`.

## Screenshots of Insider Game

![Alt text](/screenshots/01-welcome.png?raw=true "Welcome screen")
![Alt text](/screenshots/02-waiting.png?raw=true "Waiting screen")
![Alt text](/screenshots/03-role.png?raw=true "Role random affectation screen")
![Alt text](/screenshots/04-word.png?raw=true "Word choice screen")
![Alt text](/screenshots/05-reveal-word.png?raw=true "About to reveal word screen")
![Alt text](/screenshots/06-word-revealed.png?raw=true "Word revealed screen")
![Alt text](/screenshots/07-starting-game.png?raw=true "About to start the game screen")
![Alt text](/screenshots/08-game-started.png?raw=true "Game in progress screen")
![Alt text](/screenshots/09-found-word.png?raw=true "Found word screen")
![Alt text](/screenshots/10-vote1.png?raw=true "Vote 1 screen")
![Alt text](/screenshots/11-vote1-result.png?raw=true "Vote 1 results screen")
![Alt text](/screenshots/12-vote2.png?raw=true "Vote 2 screen")
![Alt text](/screenshots/13-result.png?raw=true "Final results screen")
![Alt text](/screenshots/14-admin.png?raw=true "Admin screen")

## Techno

- Node
- Express JS
- Socket.io