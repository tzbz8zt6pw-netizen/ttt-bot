# Discord CRM Audit

## Current Project Structure

- `index.js`: Discord client, slash command registration, PostgreSQL helpers, YouTube polling, welcome automation, subscriber logic, broadcast logic, and Express routes.
- `package.json`: CommonJS Node app with `discord.js`, `express`, `dotenv`, `pg`, and `rss-parser`.
- `package-lock.json`: npm lockfile.
- `.gitignore`: ignores dependencies, env files, and dumps.

## Existing Express Routes

- `GET /health`
- `GET /api/crm-stats?secret=CRM_SHARED_SECRET`

## Existing Discord Commands

- `/announce`
- `/testyt`
- `/setupalerts`
- `/subscriberstats`
- `/listsubscribers`
- `/addsubscriber`
- `/removesubscriber`
- `/sendalert`

## Existing Event Listeners

- `clientReady`: initializes database, checks YouTube, starts YouTube interval.
- `guildMemberAdd`: runs welcome flow for non-bot non-pending members.
- `guildMemberUpdate`: runs welcome flow when membership screening completes.
- `messageCreate`: adds VIP reactions to VIP messages that mention everyone.
- `interactionCreate`: handles subscribe/unsubscribe buttons and all slash commands.

## Existing PostgreSQL Tables

- `subscribers(user_id, created_at)`
- `welcomed_users(user_id, created_at)`
- `app_state(key, value)`
- `stats(key, value)`

## Existing Environment Variables

- `DATABASE_URL`
- `DISCORD_TOKEN`
- `DISCORD_BOT_TOKEN` is now accepted as a fallback alias, but `DISCORD_TOKEN` remains compatible.
- `DISCORD_APP_ID`
- `DISCORD_GUILD_ID`
- `DISCORD_CHANNEL_ID`
- `GENERAL_CHANNEL_ID`
- `ANNOUNCEMENTS_CHANNEL_ID`
- `ACTIVE_PROMOTIONS_CHANNEL_ID`
- `WELCOME_CHANNEL_ID`
- `YOUTUBE_CHANNEL_ID`
- `CRM_SHARED_SECRET`
- `PORT`
- `WEBSITE_URL`
- `AUTO_POST_SHORTS`
- `YOUTUBE_POLLING_INTERVAL_MS` is now accepted as an optional polling override.
- `OWNER_USER_ID`
- `CEO_USER_ID`
- `WUMIC_USER_ID`

## Hardcoded Discord IDs

- No literal Discord channel IDs or role IDs were found in source.
- Channel IDs are read from environment variables.
- VIP user IDs are read from environment variables.

## Hardcoded Templates, Links, Colours, and Reactions

- Brand colour: `0xf35023`.
- Brand name/footer/logo URL and YouTube footer are inline constants.
- Website URL defaults to `https://tttmarkets.com`.
- WhatsApp support URL: `https://wa.me/message/CCZYYQBWUHWSB1`.
- Support emails are embedded in the subscriber welcome DM.
- Reaction sets are inline arrays for YouTube alerts, announcements, VIP messages, and managed post defaults.
- Welcome, subscriber, setup-alerts, announcement, and YouTube embed copy are inline in `index.js`.

## Current Automation Logic

- YouTube: polls the RSS feed for `YOUTUBE_CHANNEL_ID` every five minutes, stores `lastVideoId` in `app_state`, skips Shorts unless `AUTO_POST_SHORTS=true`, posts embeds to `DISCORD_CHANNEL_ID`, and reacts.
- Welcome: posts to `WELCOME_CHANNEL_ID`, DMs the member, increments stats, and records the member in `welcomed_users`.
- Subscribers: button and command handlers insert/delete from `subscribers`, list IDs, count totals, and increment manual add/remove stats.
- Broadcasts/announcements: `/announce` and `/sendalert` build the same branded embed, optionally DM subscribers, optionally post to env-configured channels, optionally ping everyone, and update stats.
- Statistics: counters are stored as text in `stats`; `lastVideoId` is stored in `app_state`.

## Startup and Railway Assumptions

- Main entry: `node index.js` via `package.json` `main`.
- `npm start` now runs `node index.js`; before this work there was no explicit `start` script.
- Express listens on `PORT` or `3000` on `0.0.0.0`, matching Railway expectations.
- PostgreSQL uses `DATABASE_URL` with SSL `rejectUnauthorized: false`.
- Slash commands are registered against `DISCORD_APP_ID` and `DISCORD_GUILD_ID`.

## Implementation Plan

- Reuse current PostgreSQL helpers and add only additive `CREATE TABLE IF NOT EXISTS` migrations.
- Reuse `buildGenericEmbed`, `buildYoutubeEmbed`, button builders, reaction helper, subscriber helpers, and `runBroadcast`.
- Extend broadcast sending so slash commands and CRM announcements call the same sending path.
- Add authenticated `/api/crm/discord/*` routes using `CRM_SHARED_SECRET`.
- Store editable settings, templates, announcement drafts, managed posts, campaigns, and activity in new tables.
- Keep `/health`, `/api/crm-stats`, all slash commands, and all existing environment variable names compatible.
