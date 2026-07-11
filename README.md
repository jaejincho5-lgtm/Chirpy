# KFC — Conversational Ordering

AABW hackathon, KFC track.

## Contents

- **[kfc-conversational-ordering/](kfc-conversational-ordering/)** — the app: Messenger-style conversational ordering agent ("Chirpy") with OMS, loyalty + vouchers, OTP, live world signals, backend console, and the `/voice` chicken ambassador (vi-VN STT/TTS). See its [README](kfc-conversational-ordering/README.md) for setup.
- **[kfc.md](kfc.md)** — track strategy / notes.
- **[docs/BUILD_DAY.md](docs/BUILD_DAY.md)** — build-day playbook: demo script, lanes, never-cut list.
- **.claude/commands/** — `/goal-*` Claude Code commands, one per build-day lane.

## Quick start

```bash
cd kfc-conversational-ordering
npm install
cp .env.example .env.local   # fill in keys
npm run dev
```
