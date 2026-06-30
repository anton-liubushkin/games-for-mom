# Games for Mom

A collection of small browser-based mini-games built with web technologies.

## Games

| Game | Folder | Description |
|------|--------|-------------|
| Mahjong Slide Match | [`mahjong-slide-match/`](mahjong-slide-match/) | Offline-first slide puzzle — match mahjong tiles by sliding rows and columns |

Each game lives in its own folder with its own README and can be run independently.

## Deploy

Pushes to `main` deploy all game folders (directories with `index.html`) to [heyanton.ru/games/](https://heyanton.ru/games/) via GitHub Actions.

1. Add secrets from [`env.example`](env.example) to **Settings → Secrets and variables → Actions**.
2. Games are served at `https://heyanton.ru/games/<folder-name>/` (trailing slash required for PWA/service worker).
