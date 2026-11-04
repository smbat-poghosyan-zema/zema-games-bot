# TASKS

- [x] git init, .gitignore, package.json, TypeScript/ESLint/Vitest config
- [ ] Confirm Bot API poll-close updates and allowed_updates
- [ ] games.json with sourced player counts and durations
- [ ] Texts module (Armenian)
- [ ] Core logic: game filtering, plan (too few / single / vote / split), tie-break
- [ ] Reminder schedule (env-configurable, Asia/Yerevan) with tests
- [ ] JSON session store (atomic writes, survives restarts)
- [ ] Bot handlers: /play, /cancel, /games, /help, reminder button, poll + poll_answer
- [ ] Fallback finalizer if a poll-closed update never arrives
- [ ] Long polling (dev) and webhook (prod) modes
- [ ] Dockerfile + deploy config for chosen host
- [ ] README (setup, env, games.json, reminder, deploy)
- [ ] npm run build / lint / test pass
- [ ] Local run: /help and /games in a private chat
