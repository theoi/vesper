/** The sequence library: short staged scenes, each skippable, never blocking play. */
import { ROLES, type NightAction, type PlayerId } from '../../engine/index.ts';
import type { CueName, GameAudio } from '../contracts.ts';
import { NIGHT_ACT, NIGHT_GAP, type Shade, type Stage } from '../stage/index.ts';
import { deathsLine, describeAction } from './history.ts';
import type { DeathInfo, Note, SeqSpec } from './plan.ts';

/** Thrown into a running sequence when it is skipped. */
export class Skip extends Error {}

/** One run of a sequence: waits that end early on skip, timers and extras it cleans up. */
export class Take {
  skipped = false;
  speed = 1;
  private waits = new Set<{ id: number; reject: (e: Error) => void }>();
  private timers = new Set<number>();
  readonly extras = new Set<Shade>();

  constructor(private readonly stage: Stage) {}

  wait(ms: number): Promise<void> {
    if (this.skipped) return Promise.reject(new Skip());
    return new Promise((resolve, reject) => {
      const w = {
        id: window.setTimeout(() => {
          this.waits.delete(w);
          resolve();
        }, ms / this.speed),
        reject,
      };
      this.waits.add(w);
    });
  }

  later(ms: number, fn: () => void): void {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      if (!this.skipped) fn();
    }, ms / this.speed);
    this.timers.add(id);
  }

  extra(x: number, fig: 'm' | 'w', dim = 1): Shade {
    const s = this.stage.extra(x, fig, dim);
    this.extras.add(s);
    return s;
  }

  skip(): void {
    this.skipped = true;
    for (const w of this.waits) {
      window.clearTimeout(w.id);
      w.reject(new Skip());
    }
    this.waits.clear();
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
  }

  end(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
    for (const s of this.extras) this.stage.dropExtra(s, 300);
    this.extras.clear();
  }
}

interface Ctx {
  t: Take;
  s: Stage;
  a: GameAudio;
}

const roleName = (r: keyof typeof ROLES) => ROLES[r].name;

function living(s: Stage): PlayerId[] {
  return s.view?.players.filter((p) => p.alive).map((p) => p.id) ?? [];
}

function toneOf(role: keyof typeof ROLES | null): 'town' | 'mafia' | 'neutral' | 'paper' {
  return role ? ROLES[role].faction : 'paper';
}

// --- role deal ------------------------------------------------------------------------

async function deal({ t, s, a }: Ctx, q: Extract<SeqSpec, { id: 'deal' }>): Promise<void> {
  const view = s.view;
  if (!view) return;
  const me = view.you.id;
  const role = ROLES[q.role];
  const cue: CueName =
    q.tone === 'mafia' ? 'roleMafia' : q.tone === 'neutral' ? 'roleNeutral' : 'roleTown';
  s.cloth.look(
    'reveal',
    700,
    q.tone === 'neutral' ? { cold: 0.45, hx: 0.8 } : q.tone === 'mafia' ? { ember: 0.35 } : {},
  );
  for (const p of view.players) {
    if (p.id === me || q.teammates.includes(p.id)) continue;
    s.shadeOf(p.id)?.go({ dim: 0.28 }, 700);
  }
  const mine = s.shadeOf(me);
  const home = q.tone === 'neutral' ? 82 : 50;
  if (mine) {
    const ms = mine.walkTo(home, { z: 0.14, dim: 1 });
    t.later(ms, () => {
      mine.walk(false);
      mine.act(q.tone === 'mafia' ? 'cloak' : q.tone === 'neutral' ? 'idle' : 'candle', 300);
    });
  }
  q.teammates.forEach((id, i) => {
    const sh = s.shadeOf(id);
    if (!sh) return;
    const x = home + (i % 2 === 0 ? -1 : 1) * (9 + Math.floor(i / 2) * 7);
    const ms = sh.walkTo(x, { dim: 0.95 });
    t.later(ms, () => {
      sh.walk(false);
      sh.act('cloak', 300);
      sh.face(x < home ? 1 : -1);
    });
  });
  a.cue(cue);
  await t.wait(400);
  const sub =
    q.tone === 'mafia' && q.teammates.length
      ? `With ${q.teammates.map((id) => s.nameOf(id)).join(', ')}`
      : role.flavor;
  s.spirit(q.changed ? `Now: ${role.name}` : role.name, q.tone, sub);
  await t.wait(2500);
  s.film.card({
    kicker: q.changed ? 'Your part has changed' : 'You are',
    role: `the ${role.name}`,
    body: role.goal,
    tone: q.tone,
  });
  a.cue('cut');
  await t.wait(2000);
}

// --- day ----------------------------------------------------------------------------------

async function dayOpen({ t, s, a }: Ctx, q: Extract<SeqSpec, { id: 'dayOpen' }>): Promise<void> {
  const view = s.view;
  if (!view) return;
  const alive = living(s);
  a.cue('dayBreak');
  if (q.variant === 'first') {
    // The company steps out of the lamp's glare and into focus on the cloth.
    s.cloth.look('day', 2400);
    alive.forEach((id, i) => {
      const sh = s.shadeOf(id);
      if (!sh) return;
      const x = s.markOf(id);
      sh.go({ x, z: 0.45, dim: 0 }, 0);
      sh.act('idle', 0);
      sh.face(x < 50 ? 1 : -1);
      t.later(170 * i, () => sh.go({ z: 0, dim: 1 }, 1300, 'cubic-bezier(.2,.7,.3,1)'));
    });
    s.plate('The company takes its marks.', 'Day 1', 3200);
    await t.wait(3600);
    return;
  }
  s.cloth.look('day', 2200);
  if (q.variant === 'quiet') {
    s.plate('The lamp rises on a quiet town.', `Day ${q.day}`, 2600);
    alive.forEach((id, i) => {
      const sh = s.shadeOf(id);
      if (!sh || i % 2) return;
      t.later(120 * i, () => sh.act('vote', 300));
      t.later(120 * i + 900, () => sh.act('idle', 300));
    });
    await t.wait(2600);
    return;
  }
  // Mourning: someone kneels at an empty mark.
  const gone = view.graveyard
    .filter((g) => g.day === q.day - 1 && g.time === 'night')
    .map((g) => g.id);
  s.plate('One mark stands empty.', `Day ${q.day}`, 2800);
  const grave = gone[0];
  const mourner = grave
    ? alive
        .slice()
        .sort(
          (x, y) =>
            Math.abs(s.markOf(x) - s.markOf(grave)) - Math.abs(s.markOf(y) - s.markOf(grave)),
        )[0]
    : undefined;
  const sh = mourner ? s.shadeOf(mourner) : undefined;
  if (sh && grave) {
    const gx = s.markOf(grave);
    const ms = sh.walkTo(gx + (sh.x < gx ? -3 : 3), { speed: 10 });
    t.later(ms, () => {
      sh.walk(false);
      sh.act('grieve', 400);
      sh.face(sh.x < gx ? 1 : -1);
    });
  }
  await t.wait(3000);
}

// --- trial and verdict ----------------------------------------------------------------

async function trial({ t, s, a }: Ctx, q: Extract<SeqSpec, { id: 'trial' }>): Promise<void> {
  const face = s.faceOf(q.defendant);
  const who = s.nameOf(q.defendant);
  a.cue('trial');
  if (q.variant === 'walk') {
    const sh = s.shadeOf(q.defendant);
    s.cloth.look('trial', 1400, { hr: 0.22, lamp: 1.05 });
    for (const id of living(s)) if (id !== q.defendant) s.shadeOf(id)?.go({ dim: 0.5 }, 800);
    if (sh) {
      const ms = sh.walkTo(50, { speed: 12, z: 0.32 });
      t.later(ms, () => {
        sh.walk(false);
        sh.act('idle');
        sh.flag('swell', true);
      });
      t.later(3400, () => sh.flag('swell', false));
    }
    s.plate(`${who} is brought before the lamp.`, 'Trial', 3000);
    await t.wait(3400);
    return;
  }
  if (q.variant === 'again') {
    s.film.card({ title: 'Again', body: `${who} stands accused.` }, 'slam');
    a.cue('cut');
    await t.wait(1300);
  } else {
    s.film.card({ kicker: 'The town accuses', title: who });
    a.cue('cut');
    await t.wait(1500);
  }
  if (face) {
    const c = s.film.close(face, { x: 'afraid', z: 2.1, ax: 0.42 });
    a.cue('cut');
    t.later(500, () => c.p.flinch());
  }
  await t.wait(1600);
}

async function verdict({ t, s, a }: Ctx, q: Extract<SeqSpec, { id: 'verdict' }>): Promise<void> {
  const who = s.nameOf(q.defendant);
  const face = s.faceOf(q.defendant);
  const score = q.guilty ? `${q.g} to ${q.i}` : `${q.i} to ${q.g}`;
  if (q.guilty) {
    if (q.variant === 'poly') {
      const faces = q.guiltyVoters.map((id) => s.faceOf(id)).filter((f) => f !== undefined);
      if (faces.length) {
        s.film.poly(faces, { x: 'neutral' }, `They find ${who} guilty, ${score}.`);
        a.cue('cut');
        await t.wait(900 + faces.length * 280);
      }
      a.cue('guilty');
      s.film.card({ title: 'Guilty', body: score }, 'slam');
      await t.wait(1600);
      return;
    }
    if (q.variant === 'slam') {
      a.cue('guilty');
      s.film.card({ kicker: who, title: 'Guilty', body: score }, 'slam');
      await t.wait(2000);
      if (face) {
        s.film.close(face, { x: 'afraid', z: 2.5, ax: 0.58 });
        a.cue('cut');
      }
      await t.wait(1300);
      return;
    }
    // Flare: the lamp drops, the condemned's candle flares.
    s.cloth.to({ lamp: 0.22, ember: 0.3 }, 600);
    a.cue('guilty');
    s.candle(q.defendant, 'flare');
    s.plate('Guilty.', `${who} · ${score}`, 2600);
    await t.wait(2800);
    return;
  }
  if (q.variant === 'exhale' && face) {
    const c = s.film.close(face, { x: 'closed', z: 1.9 }, `Innocent, ${score}.`);
    a.cue('innocent');
    await t.wait(1100);
    c.p.show('neutral', 700);
    await t.wait(1500);
    return;
  }
  a.cue('innocent');
  s.film.card({ kicker: who, title: 'Innocent', body: score });
  await t.wait(1700);
  s.film.clear();
  for (const id of q.innocentVoters) s.shadeOf(id)?.act('vote', 300);
  await t.wait(1200);
}

async function magistrate(
  { t, s, a }: Ctx,
  q: Extract<SeqSpec, { id: 'magistrate' }>,
): Promise<void> {
  const sh = s.shadeOf(q.player);
  a.cue('reveal');
  s.cloth.flash(0.3, 600);
  if (sh) {
    sh.go({ z: 0.3 }, 900);
    sh.flag('swell', true);
    t.later(2600, () => sh.flag('swell', false));
  }
  await t.wait(900);
  s.film.card({
    kicker: s.nameOf(q.player),
    role: 'the Magistrate',
    body: 'The chain of office catches the light. Their vote counts three times.',
    tone: 'town',
  });
  await t.wait(2600);
}

// --- deaths -----------------------------------------------------------------------------

/** The attack, in silhouette, at the victim's mark. Never gory. */
async function stageDeath({ t, s, a }: Ctx, d: DeathInfo, short: boolean): Promise<void> {
  const victim = s.shadeOf(d.player);
  const x = s.markOf(d.player);
  const pan = s.pan(d.player);
  if (victim) {
    victim.go({ x, z: 0, dim: 1 }, 0);
    victim.act('idle', 0);
  }
  const fall = () => {
    victim?.act('fall', 160);
    t.later(450, () => victim?.act('lie', 200));
    s.candle(d.player, 'out');
    a.cue('candleOut', { pan, delay: 0.3 });
  };
  const side = x < 50 ? 1 : -1;
  switch (d.staging) {
    case 'mafia': {
      const crew = [0, 1, 2].map((i) => {
        const from = i === 1 ? x - side * 40 : x + side * (40 + i * 8);
        const e = t.extra(from, 'm', 0.95);
        e.act(i === 0 ? 'lunge' : i === 1 ? 'creep' : 'cloak', 0);
        return { e, to: x + (i === 1 ? -side * 6 : side * (5 + i * 3)) };
      });
      for (const { e, to } of crew) {
        const ms = e.walkTo(to, { speed: 34, act: e.current === 'lunge' ? 'lunge' : 'creep' });
        t.later(ms, () => e.walk(false));
      }
      a.cue('deathMafia', { pan });
      victim?.act('recoil', 200);
      await t.wait(short ? 900 : 1300);
      fall();
      await t.wait(short ? 600 : 1000);
      return;
    }
    case 'cutthroat': {
      const e = t.extra(x - side * 50, 'm', 1);
      e.act('lunge', 0);
      const ms = e.walkTo(x + side * 50, { speed: 85, act: 'lunge' });
      a.cue('deathCutthroat', { pan });
      t.later(ms / 2, () => {
        s.cloth.flash(0.12, 300);
        fall();
      });
      await t.wait(short ? 1300 : 1800);
      return;
    }
    case 'reckoner': {
      const e = t.extra(x - side * 18, 'm', 1);
      e.act('aim', 0);
      e.face(side > 0 ? 1 : -1);
      await t.wait(short ? 400 : 700);
      a.cue('deathReckoner', { pan });
      s.cloth.flash(0.65, 450);
      const [mx, my] = e.point(s.box(), 0.97, 0.18);
      const flash = document.createElement('div');
      flash.className = 'vs-flash';
      flash.style.left = `${mx * 100}%`;
      flash.style.top = `${my * 100}%`;
      s.el.querySelector('.vs-fx')?.append(flash);
      t.later(600, () => flash.remove());
      fall();
      await t.wait(short ? 700 : 1100);
      return;
    }
    case 'guard': {
      const e = t.extra(x - side * 7, 'm', 1);
      e.act('guard', 0);
      e.face(side > 0 ? 1 : -1);
      victim?.act('struggle', 200);
      a.cue('deathGuard', { pan });
      await t.wait(short ? 700 : 1100);
      fall();
      e.act('fall', 200);
      await t.wait(short ? 600 : 900);
      return;
    }
    case 'executed':
      fall();
      await t.wait(800);
      return;
  }
}

/** Close-up with closed eyes, the name and role, then the will as a letter. */
async function revealDeath(
  { t, s, a }: Ctx,
  d: DeathInfo,
  short: boolean,
  close = !short,
): Promise<void> {
  const who = s.nameOf(d.player);
  const face = s.faceOf(d.player);
  if (face && close) {
    s.film.close(face, { x: 'closed', z: 1.8, blink: false }, who);
    a.cue('cut');
    await t.wait(1100);
  }
  a.cue('reveal');
  s.film.card(
    d.embalmed || !d.role
      ? {
          kicker: who,
          role: 'The coffin is closed',
          body: 'Someone took the name away.',
          tone: 'paper',
        }
      : {
          kicker: who,
          role: `the ${roleName(d.role)}`,
          body: ROLES[d.role].flavor,
          tone: toneOf(d.role),
        },
  );
  await t.wait(short ? 1300 : 1700);
  s.film.clear();
  // Letters linger over the cloth after the sequence ends, so reading never holds up play.
  const will = d.will?.trim();
  if (will) {
    s.letter(`The last will of ${who}`, will, 'will', readingMs(will));
    a.cue('will');
  }
  const note = d.notes
    .map((n) => n.trim())
    .filter(Boolean)
    .join('\n');
  if (note) s.letter('Left on the body', note, 'note', readingMs(note));
}

function readingMs(text: string): number {
  return Math.min(12000, 4500 + text.length * 40);
}

async function execution(c: Ctx, q: Extract<SeqSpec, { id: 'execution' }>): Promise<void> {
  const { t, s, a } = c;
  const id = q.death?.player ?? q.player;
  if (!id) return;
  const sh = s.shadeOf(id);
  const face = s.faceOf(id);
  if (q.variant === 'lamp') {
    if (face) {
      s.film.close(face, { x: 'afraid', z: 2.3, ax: 0.6 });
      a.cue('cut');
      await t.wait(900);
      s.film.clear(0);
    }
    s.cloth.to({ lamp: 1.3, hr: 0.18, hx: 0.5, ember: 0.15 }, 1500);
    if (sh) {
      sh.go({ x: 50, z: 0, dim: 1 }, 0);
      sh.act('idle', 0);
      sh.go({ z: 0.95, dim: 0 }, 1800, 'cubic-bezier(.5,0,.8,.6)');
    }
    a.cue('deathExecuted');
    await t.wait(1600);
    s.cloth.flash(0.45, 700);
    s.candle(id, 'out');
    await t.wait(500);
    if (q.death) await revealDeath(c, q.death, false, false);
    return;
  }
  s.cloth.to({ lamp: 0.07, ember: 0.55, hr: 0.25 }, 2200);
  if (sh) {
    sh.go({ x: 50, z: 0.1, dim: 1 }, 400);
    sh.act('kneel', 300);
    sh.go({ dim: 0 }, 2200);
  }
  a.cue('deathExecuted');
  await t.wait(2000);
  s.candle(id, 'out');
  a.cue('candleOut', { pan: s.pan(id) });
  await t.wait(500);
  if (q.death) await revealDeath(c, q.death, false);
}

async function dawn(c: Ctx, q: Extract<SeqSpec, { id: 'dawn' }>): Promise<void> {
  const { t, s, a } = c;
  s.cloth.look('dawn', 2600, q.deaths.length ? { lamp: 0.7, cold: 0.25 } : {});
  if (q.variant === 'quiet') {
    a.cue('dawnQuiet');
    if (q.quiet === 'candles') {
      living(s).forEach((id, i) => t.later(160 * i, () => s.candle(id, 'flare')));
      s.plate('Every candle still burns.', `Day ${q.day}`, 2800);
    } else {
      s.plate('Nobody died last night.', `Day ${q.day}`, 2800);
      s.settle(1600);
    }
    await t.wait(3000);
  } else {
    a.cue('dawnDeath');
    const short = q.deaths.length > 1;
    if (short) {
      s.plate(`${q.deaths.length} candles went out in the night.`, `Day ${q.day}`, 2000);
      await t.wait(900);
    }
    for (const d of q.deaths) {
      await stageDeath(c, d, short);
      await revealDeath(c, d, short);
      s.clearOver();
    }
  }
  await spiritNotes(c, q.notes);
}

async function death(c: Ctx, q: Extract<SeqSpec, { id: 'death' }>): Promise<void> {
  await stageDeath(c, q.death, false);
  await revealDeath(c, q.death, false);
}

async function spiritNotes({ t, s, a }: Ctx, notes: readonly Note[]): Promise<void> {
  for (const n of notes) {
    s.clearOver();
    s.spirit(n.text, n.tone);
    a.cue('whisper', { gain: 0.8 });
    await t.wait(2300);
  }
}

// --- night ----------------------------------------------------------------------------

async function nightfall(
  { t, s, a }: Ctx,
  q: Extract<SeqSpec, { id: 'nightfall' }>,
): Promise<void> {
  const view = s.view;
  if (!view) return;
  const look = !view.you.alive
    ? 'nightDead'
    : view.you.faction === 'mafia'
      ? 'nightSyndicate'
      : 'night';
  const variant = ['lamps', 'fog', 'lantern'].indexOf(q.variant);
  const alive = living(s).sort((x, y) => s.markOf(x) - s.markOf(y));
  if (q.first) {
    s.film.card({
      kicker: 'Night 1',
      title: 'Nightfall',
      body: 'Lamps out. Do your work in the dark.',
    });
    a.cue('cut');
    await t.wait(1500);
    s.film.clear();
  }
  a.cue('nightfall', { variant });
  if (q.variant === 'lamps') {
    s.cloth.look(look, 2800);
    const step = Math.min(220, 2000 / Math.max(1, alive.length));
    alive.forEach((id, i) => {
      t.later(step * i, () => {
        s.candle(id, 'dim');
        s.shadeOf(id)?.go({ dim: 0 }, 500);
      });
    });
    await t.wait(Math.max(2600, step * alive.length + 900));
    return;
  }
  if (q.variant === 'fog') {
    s.cloth.look(look, 2000, { fog: 1 });
    for (const id of alive) {
      const sh = s.shadeOf(id);
      if (!sh) continue;
      const x = s.markOf(id);
      const ms = sh.walkTo(x < 50 ? -16 : 116, { speed: 30 + ((x * 7) % 13) });
      t.later(ms, () => sh.walk(false));
    }
    await t.wait(2800);
    s.cloth.to({ fog: 0.3 }, 2000);
    return;
  }
  // The watchman's lantern crosses and the town follows it out.
  const lantern = t.extra(-12, 'm', 1);
  lantern.act('lantern', 0);
  const ms = lantern.walkTo(112, { speed: 30, act: 'lantern' });
  s.cloth.look(look, ms, { gz: 0 });
  const box = s.box();
  const stage = s.el.getBoundingClientRect();
  const follow = window.setInterval(() => {
    const [gx, gy] = lantern.point(box, 0.82, 0.5);
    const y = (box.top - stage.top + gy * box.height) / stage.height;
    s.cloth.to({ gx, gy: 1 - y, gz: 0.85 }, 0);
  }, 50);
  t.later(ms, () => window.clearInterval(follow));
  alive.forEach((id) => {
    const sh = s.shadeOf(id);
    if (!sh) return;
    const x = s.markOf(id);
    t.later((x / 100) * ms * 0.8, () => {
      const w = sh.walkTo(116, { speed: 30 });
      t.later(w, () => sh.walk(false));
    });
  });
  try {
    await t.wait(Math.min(ms, 4200));
  } finally {
    window.clearInterval(follow);
    s.cloth.to({ gz: 0 }, 600);
  }
}

async function notes(c: Ctx, q: Extract<SeqSpec, { id: 'notes' }>): Promise<void> {
  await spiritNotes(c, q.notes);
}

// --- the end ----------------------------------------------------------------------------

async function finale({ t, s, a }: Ctx, q: Extract<SeqSpec, { id: 'finale' }>): Promise<void> {
  const view = s.view;
  if (!view) return;
  const winners = new Set(view.result?.winners ?? []);
  const alive = living(s);
  a.setScene('end', { end: q.outcome, won: q.won });
  a.cue(q.won ? 'win' : 'lose');
  const titles = {
    town: { title: 'The town prevails', tone: 'town' as const, body: 'Dawn floods the cloth.' },
    mafia: {
      title: 'The Syndicate prevails',
      tone: 'mafia' as const,
      body: 'The scrim burns, and the shadows bow.',
    },
    cutthroat: {
      title: 'The Cutthroat stands alone',
      tone: 'neutral' as const,
      body: 'Every candle but one is out.',
    },
    draw: { title: 'A draw', tone: 'paper' as const, body: 'The lamp gutters out.' },
  }[q.outcome];
  s.cloth.look(q.outcome, 2600);
  if (q.outcome === 'town') {
    alive.forEach((id, i) => {
      t.later(140 * i, () => {
        s.shadeOf(id)?.act('vote', 300);
        s.candle(id, 'flare');
      });
    });
  } else if (q.outcome === 'mafia') {
    const crew = alive.filter((id) => winners.has(id));
    for (const id of alive) if (!winners.has(id)) s.shadeOf(id)?.go({ dim: 0.15 }, 900);
    crew.forEach((id, i) => {
      const sh = s.shadeOf(id);
      if (!sh) return;
      const x = 50 + (i - (crew.length - 1) / 2) * 10;
      const ms = sh.walkTo(x, { speed: 16 });
      t.later(ms, () => {
        sh.walk(false);
        sh.act('bow', 400);
      });
    });
  } else if (q.outcome === 'cutthroat') {
    for (const id of alive) {
      if (winners.has(id)) {
        const sh = s.shadeOf(id);
        if (sh) {
          const ms = sh.walkTo(50, { speed: 10 });
          t.later(ms, () => {
            sh.walk(false);
            sh.act('cloak', 400);
          });
        }
      } else s.candle(id, 'dim');
    }
  } else {
    for (const id of alive) s.candle(id, 'dim');
  }
  await t.wait(2600);
  s.film.card({
    kicker: q.won ? 'You win' : 'You lose',
    title: titles.title,
    body: titles.body,
    tone: titles.tone,
  });
  a.cue('cut');
  await t.wait(2800);
  if (q.won && view.you.neutralWin && q.outcome !== 'cutthroat') {
    s.film.clear();
    s.spirit('Take a bow', 'neutral', 'Your own wish came true.');
    s.shadeOf(view.you.id)?.act('bow', 300);
    await t.wait(2200);
  }
}

// --- the curtain call: what really happened -----------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const KILL_CUE: Partial<Record<NightAction['kind'], CueName>> = {
  kill: 'deathMafia',
  stab: 'deathCutthroat',
  shoot: 'deathReckoner',
};

/** One ability, staged: the actor crosses to the target's mark and the outcome plays out. */
async function visit({ t, s, a }: Ctx, x: NightAction, kicker: string): Promise<void> {
  const actor = s.shadeOf(x.actor);
  if (!actor) return;
  const self = x.actor === x.target;
  const target = self ? undefined : s.shadeOf(x.target);
  const ax = s.markOf(x.actor);
  const tx = s.markOf(x.target);
  for (const p of s.view?.players ?? []) {
    if (p.id !== x.actor && p.id !== x.target) s.shadeOf(p.id)?.go({ dim: 0 }, 250);
  }
  s.plate(
    describeAction(x, (id) => s.nameOf(id)),
    kicker,
    3000,
  );
  s.cloth.to({ hx: clamp(tx / 100, 0.15, 0.85), hy: 0.6, hr: 0.36, lamp: 0.58 }, 600);
  actor.go({ x: ax, z: 0, dim: 0 }, 0);
  actor.act('idle', 0);
  actor.face(tx >= ax ? 1 : -1);
  actor.go({ dim: 1 }, 300);
  if (target) {
    target.go({ x: tx, z: 0, dim: 0 }, 0);
    target.act('sit', 0);
    target.face(ax >= tx ? 1 : -1);
    target.go({ dim: 0.5 }, 300);
  }
  if (self || x.outcome === 'ordered') {
    // A Patron gives the order from home; armor goes on at home.
    actor.act(self ? NIGHT_ACT[x.kind] : 'accuse', 300);
    a.cue('whisper', { pan: s.pan(x.actor), gain: 0.5 });
    await t.wait(1300);
    return;
  }
  const blocked = x.outcome === 'blocked';
  const side = ax < tx ? -1 : 1;
  const stop = blocked ? ax + (tx - ax) * 0.4 : clamp(tx + side * (NIGHT_GAP[x.kind] ?? 6), 4, 96);
  const sneak = x.kind === 'kill' || x.kind === 'stab' || x.kind === 'frame' || x.kind === 'embalm';
  const ms = actor.walkTo(stop, {
    speed: Math.max(40, Math.abs(stop - ax) / 0.7),
    act: sneak ? 'creep' : 'walk',
  });
  await t.wait(Math.max(300, ms));
  actor.walk(false);
  actor.face(tx >= stop ? 1 : -1);
  actor.act(blocked ? 'recoil' : NIGHT_ACT[x.kind], 200);
  const pan = s.pan(x.target);
  if (blocked) a.cue('unknock', { pan });
  else if (x.outcome === 'killed') {
    const cue = KILL_CUE[x.kind];
    if (cue) a.cue(cue, { pan, gain: 0.6 });
    if (x.kind === 'shoot') s.cloth.flash(0.35, 400);
    s.candle(x.target, 'out');
    target?.act('fall', 160);
    t.later(450, () => target?.act('lie', 200));
  } else if (x.outcome === 'survived' || x.outcome === 'intercepted') {
    target?.act('recoil', 200);
    a.cue('knock', { pan, gain: 0.6 });
  } else if (x.outcome === 'saved' || x.outcome === 'fought') {
    s.candle(x.target, 'flare');
    a.cue('claim', { pan, gain: 0.5 });
  } else a.cue('whisper', { pan, gain: 0.5 });
  await t.wait(900);
  actor.go({ dim: 0 }, 300);
  target?.go({ dim: 0 }, 300);
}

async function replay(c: Ctx, q: Extract<SeqSpec, { id: 'replay' }>): Promise<void> {
  const { t, s, a } = c;
  const view = s.view;
  if (!view) return;
  const hideAll = (ms: number) => {
    for (const p of view.players) s.shadeOf(p.id)?.go({ dim: 0 }, ms);
  };
  a.setScene('night');
  try {
    s.film.card({
      kicker: 'The curtain call',
      title: 'What really happened',
      body: 'Every night, replayed in shadow. Click or press Esc to stop.',
    });
    a.cue('cut');
    hideAll(300);
    await t.wait(1800);
    s.film.clear();
    for (const n of q.nights) {
      // Candles burn as they did that night: out only for those already gone.
      for (const p of view.players) {
        const gone = view.graveyard.some(
          (g) => g.id === p.id && (g.day < n.night || (g.day === n.night && g.time === 'day')),
        );
        s.setLit(p.id, !gone);
      }
      s.cloth.look('night', 700, { fog: 0.15 });
      s.plate(
        n.actions.length ? 'The lamps go out.' : 'Everyone stayed home.',
        `Night ${n.night}`,
        1500,
      );
      a.cue('creep', { gain: 0.6 });
      await t.wait(1000);
      for (const [i, x] of n.actions.entries()) {
        await visit(c, x, `Night ${n.night} · ${i + 1} of ${n.actions.length}`);
      }
      hideAll(300);
      s.cloth.to({ hx: 0.5, hr: 0.5 }, 600);
      s.plate(
        deathsLine(n, (id) => s.nameOf(id)),
        `Night ${n.night}`,
        2000,
      );
      if (n.deaths.length) a.cue('candleOut', { gain: 0.7 });
      await t.wait(1600);
    }
  } finally {
    s.repaint();
    a.setScene('end', { end: q.outcome, won: q.won });
  }
}

type Run = (c: Ctx, q: never) => Promise<void>;

export const SEQUENCES: Record<SeqSpec['id'], Run> = {
  deal,
  dayOpen,
  trial,
  verdict,
  magistrate,
  execution,
  nightfall,
  dawn,
  death,
  notes,
  finale,
  replay,
};

export function runSequence(t: Take, s: Stage, a: GameAudio, q: SeqSpec): Promise<void> {
  const run = SEQUENCES[q.id] as (c: Ctx, q: SeqSpec) => Promise<void>;
  return run({ t, s, a }, q);
}
