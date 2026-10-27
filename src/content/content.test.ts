import { describe, expect, it } from 'vitest';
import { ROLES, ROLE_IDS } from '../engine/roles.ts';
import { GLOSSARY, HOW_TO_PLAY, PHASE_HELP, ROLE_CARDS, fill } from './index.ts';

const allText = (): string[] => [
  ...HOW_TO_PLAY.flatMap((s) => [s.title, ...s.body]),
  ...Object.values(PHASE_HELP).flatMap((p) => [p.title, p.short, p.detail]),
  ...Object.values(ROLE_CARDS).flatMap((c) => [c.ability, ...c.tips]),
  ...GLOSSARY.flatMap((g) => [g.term, g.definition]),
];

describe('help content', () => {
  it('fills every role and faction token from the engine names', () => {
    expect(fill('{augur} vs {mafia}')).toBe(`${ROLES.augur.name} vs Syndicate`);
    expect(() => fill('{sheriff}')).toThrow(/Unknown help token/);
    for (const text of allText()) expect(text).not.toMatch(/[{}]/);
  });

  it("uses this game's own role names, not other games' in the genre", () => {
    const foreign =
      /\b(sheriff|godfather|mafioso|consigliere|consort|jailor|jester|executioner|serial killer|investigator|lookout|bodyguard|vigilante|doctor|mayor|medium|janitor|framer|escort)\b/i;
    for (const text of allText()) expect(text).not.toMatch(foreign);
  });

  it('keeps copy short enough for banners, tooltips, and cards', () => {
    for (const p of Object.values(PHASE_HELP)) {
      expect(p.short.length, p.short).toBeLessThanOrEqual(50);
      expect(p.detail.length, p.detail).toBeLessThanOrEqual(200);
    }
    for (const c of Object.values(ROLE_CARDS)) {
      expect(c.ability.length, c.ability).toBeLessThanOrEqual(220);
      expect(c.tips.length).toBeGreaterThan(0);
      for (const tip of c.tips) expect(tip.length, tip).toBeLessThanOrEqual(100);
    }
    for (const g of GLOSSARY) expect(g.definition.length, g.definition).toBeLessThanOrEqual(130);
  });

  it('shows each role card with the engine flavor line, short enough for one intertitle', () => {
    for (const id of ROLE_IDS) {
      expect(ROLE_CARDS[id].flavor).toBe(ROLES[id].flavor);
      expect(ROLES[id].flavor.length, ROLES[id].flavor).toBeLessThanOrEqual(90);
    }
  });

  it('says how each role reads to the Augur only where the engine agrees', () => {
    for (const id of ROLE_IDS) {
      const card = ROLE_CARDS[id];
      expect(card.reads).toBe(ROLES[id].appearsSuspicious ? 'Suspicious' : 'Clear');
      for (const text of [card.ability, ...card.tips]) {
        const said = /\bYou read (Suspicious|Clear)\b/.exec(text)?.[1];
        if (said) expect(said, `${id}: ${text}`).toBe(card.reads);
      }
    }
  });

  it('links glossary roles to their cards', () => {
    const linked = GLOSSARY.filter((g) => g.role);
    expect(linked.length).toBeGreaterThan(0);
    for (const g of linked) expect(g.term).toBe(ROLE_CARDS[g.role as keyof typeof ROLE_CARDS].name);
  });
});
