# previews

Owner: art and sound agent.

Live art and sound previews for decision D4. Every `index.html` under this folder is built automatically and served at the same path, for example `previews/masque/index.html` becomes https://theoi.github.io/vesper/previews/masque/.

- `index.html`: the chooser page linking every direction.
- `shared/`: the preview harness (scene rail, click-to-begin gate, mute and volume, automation hooks), a fullscreen shader layer, a tweener, and the procedural audio kit used by every score.
- `<direction>/`: one folder per direction (`main.ts` scenes, `score.ts` procedural score, `style.css`).
- `_tools/shoot.mjs`: captures every scene with headless Chrome and verifies the audio (live output level per shot, plus OfflineAudioContext renders of every bed and sting): `node previews/_tools/shoot.mjs <siteUrl> <outDir> <slug...> --audio`.
- `_tools/vite.only.config.mjs`: builds only the named pages, for capture runs.

All visuals are generated in code and all sound is synthesised in the browser. Fonts are SIL OFL, bundled from `@fontsource`.
