# Vesper Claude relay

A small [Cloudflare Worker](https://developers.cloudflare.com/workers/) that lets the game call Claude with your Anthropic API key, without the key ever reaching a browser. Use it when your key can't be used from a browser (for example, organizations with custom data retention), or when you'd rather not paste a key into the game.

How it works: you deploy this Worker to your own free Cloudflare account and give it two secrets, your Anthropic API key and a passphrase you make up. In the game, the host pastes the Worker's address and the passphrase. The game sends each bot line to your relay with the passphrase. The relay checks it, adds your key on the server, and forwards the request to Anthropic.

## Deploy it (about 5 minutes)

You need a GitHub account, an Anthropic API key (from [console.anthropic.com](https://console.anthropic.com/settings/keys)), and a free Cloudflare account. If you don't have a Cloudflare account yet, you'll create one on the way.

First, make up a passphrase: a long random string that only you know. For example, run `openssl rand -hex 16` in a terminal, or use a password manager's generator. Keep it handy.

### Option A: the Deploy button (no terminal)

1. Click [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/theoi/vesper/tree/main/relay)
2. Sign in to Cloudflare, or sign up for a free account.
3. When asked, connect your GitHub account. Cloudflare copies the relay into a new repository in your account, so you can update it later.
4. On the setup page:
   - Keep the project name (`vesper-claude-relay`) or choose your own.
   - **ANTHROPIC_API_KEY**: paste your Anthropic API key.
   - **RELAY_PASSPHRASE**: paste your passphrase.
   - Leave the other settings as they are, unless you play on a different site (see [Settings](#settings)).
5. Click **Create and deploy**, then wait for the build to finish (about a minute).
6. Copy your relay's address from the project page. It looks like `https://vesper-claude-relay.<your-subdomain>.workers.dev`. If Cloudflare asks you to choose a `workers.dev` subdomain first, pick any name.

### Option B: the command line

Requires [Node.js](https://nodejs.org/) 22 or newer.

```bash
git clone https://github.com/theoi/vesper.git
cd vesper/relay
npm install
npx wrangler login                          # opens your browser to sign in to Cloudflare
npx wrangler deploy                         # prints your relay's address (…workers.dev)
npx wrangler secret put ANTHROPIC_API_KEY   # paste your Anthropic key when asked
npx wrangler secret put RELAY_PASSPHRASE    # paste your passphrase when asked
```

Secrets apply right away; you don't need to deploy again.

### Check it

Open your relay's address in a browser. You should see:

```json
{ "service": "vesper-claude-relay", "ready": true }
```

`"ready": false` means one of the two secrets is missing.

## Use it in the game

1. Host a game (online or solo).
2. In the lobby, find **Claude bots** and choose **My relay**.
3. Paste your relay's address into the URL field and your passphrase into the passphrase field.
4. Optional: tick **Remember on this device** so this browser keeps the address and passphrase. Otherwise, they're forgotten when you close the tab.
5. Click **Use relay**. The status should say `ok: Bots chat with Claude.`

If it doesn't work, the status says why:

| Status                                                                | What to do                                                                               |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| The relay rejected the passphrase                                     | Retype the passphrase, or set a new one with `npx wrangler secret put RELAY_PASSPHRASE`. |
| The relay does not accept requests from this site                     | Add the site's address to `ALLOWED_ORIGINS` (see [Settings](#settings)).                 |
| Could not reach the relay                                             | Check the address, and open it in a browser to see if the Worker is deployed.            |
| The relay is missing its ANTHROPIC_API_KEY or RELAY_PASSPHRASE secret | Set both secrets.                                                                        |
| Anthropic rejected the relay's API key                                | Set a working key with `npx wrangler secret put ANTHROPIC_API_KEY`.                      |
| The relay does not allow the model                                    | Use a model listed in `ALLOWED_MODELS`, or add it there.                                 |

## Settings

These are plain settings (not secrets) in `wrangler.jsonc`, or under **Settings → Variables and Secrets** in the Cloudflare dashboard:

| Setting           | Default                   | Meaning                                                                        |
| ----------------- | ------------------------- | ------------------------------------------------------------------------------ |
| `ALLOWED_ORIGINS` | `https://theoi.github.io` | Sites that may use the relay, separated by commas (scheme and host only).      |
| `ALLOWED_MODELS`  | `claude-haiku-5-5`        | Models the relay forwards, separated by commas.                                |
| `MAX_TOKENS`      | `300`                     | Larger `max_tokens` requests are lowered to this. The game asks for about 120. |
| `MAX_BODY_BYTES`  | `65536`                   | Larger requests are refused.                                                   |

The rate limit (about 60 requests a minute) is the `ratelimits` entry in `wrangler.jsonc`. One game makes at most 45 calls a minute.

## What it protects, and what it doesn't

- Your key stays in Cloudflare. Browsers only ever see your relay's address. The passphrase is sent only to your relay.
- The relay only forwards `POST /v1/messages` from allowed sites with the right passphrase, for allowed models, with `max_tokens` capped and bodies up to 64 KB. Its refusals use their own error types (`relay_auth`, `relay_origin`, `relay_model`, `relay_too_large`, `relay_config`), so the game can explain them.
- It logs nothing, and `wrangler.jsonc` turns Workers request logging off.
- **The passphrase is the real lock.** The origin check only stops other websites from using the relay inside a browser. A script can fake its origin. Anyone who has both your relay's address and your passphrase can spend your key, within the limits above. Don't share the passphrase. If it leaks, change it with `npx wrangler secret put RELAY_PASSPHRASE`.
- The rate limit is approximate and per Cloudflare location. For a hard ceiling, set a monthly spend limit for your key in the [Anthropic console](https://console.anthropic.com/settings/limits).
- Cloudflare's free plan covers 100,000 requests a day, far more than a game uses. Claude usage is billed to your Anthropic account as usual.

## Develop

```bash
cp .dev.vars.example .dev.vars   # fill in a key and a passphrase
npx wrangler dev                 # http://localhost:8787
```

The relay's unit tests live in `src/relay.test.ts` and run with the game's tests (`npm test` at the repository root). `.github/workflows/claude-relay-e2e.yml` plays a full game through the relay. It can run the relay inside CI behind a temporary tunnel, or test your deployed relay when the `VESPER_RELAY_URL` and `VESPER_RELAY_PASSPHRASE` repository secrets are set.
