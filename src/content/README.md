# src/content

Owner: rules engine and bots agent (copy). The UI decides how it looks.

In-game help as plain data, direction-neutral: no markup, no styling, no art-direction voice. Import from `src/content/index.ts`.

| Export        | Shape                                         | Use                                                                                                      |
| ------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `HOW_TO_PLAY` | `{ id, title, body: string[] }[]`             | A short "How to play" page: the idea, days and nights, trials, winning, talking, wills.                  |
| `PHASE_HELP`  | `Record<PhaseKind, { title, short, detail }>` | `short` for a phase banner (50 characters at most), `detail` for a tooltip.                              |
| `ROLE_CARDS`  | `Record<RoleId, RoleCard>`                    | Name, faction, category, goal, plain-words ability, tips, how it reads to the Augur, uniqueness, flavor. |
| `GLOSSARY`    | `{ term, definition, role? }[]`, sorted       | The game's own terms. `role` links a term to its card.                                                   |
| `fill(text)`  | `string`                                      | Fills `{roleId}` and `{faction}` tokens with display names.                                              |

Player-facing words for engine terms (`labels.ts`), for feed lines, cards, and the curtain call. `describeEvent` in `src/app/format.ts` uses them, so both UIs read the same.

| Export                                                    | Shape                                  | Use                                                                                                                                                     |
| --------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEATH_CAUSE`, `deathPhrase(causes)`                      | `Record<DeathCause, string>`, `string` | What happened, after the name: "Sabine was killed by the Syndicate", "Bram died guarding someone". `deathPhrase` joins several causes.                  |
| `OUTCOME_HEADLINE`, `RESULT_REASON`, `resultLine(result)` | `Record<…, string>`, `string`          | The curtain-call headline ("The Town prevails"), the reason as a sentence, and both as one line: "The Town prevails: every threat to the town is gone." |
| `SAVED_BY`                                                | `Record<savedBy, string>`              | Why a player survived an attack, after "You were attacked, but".                                                                                        |
| `NIGHT_OUTCOME`                                           | `Record<NightOutcome, string>`         | A short label for how one night ability turned out ("stopped by a Sentinel").                                                                           |

Role and faction names, goals, and flavor lines come from `src/engine/roles.ts`. The copy here refers to them with tokens (`{augur}`, `{mafia}`), so renaming a role in the engine renames it everywhere. When restyling, edit the names and flavor in `roles.ts`, and the wording here.

Tests (`content.test.ts`) check that every token resolves, that no other game's role names slip in, that copy stays within the length limits, that what a card says about Augur readings matches the engine, and that labels never show an engine id (`mafia`, `threatsEliminated`).
