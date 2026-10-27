/** Art for the stage: pose silhouettes, faces, and how seats are cast. */

const POSE_URLS = byName(
  import.meta.glob('../assets/poses/*.webp', { eager: true, query: '?url', import: 'default' }),
);
const FACE_URLS = byName(
  import.meta.glob('../assets/faces/*.webp', { eager: true, query: '?url', import: 'default' }),
);
const HAND_URLS = byName(
  import.meta.glob('../assets/hand/*.webp', { eager: true, query: '?url', import: 'default' }),
);

/** The Mourner's hand: reaching (far behind the cloth) and pressed flat against it. */
export const HAND = { reach: HAND_URLS.reach ?? '', press: HAND_URLS.press ?? '' };

function byName(files: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, url] of Object.entries(files)) {
    const name = path
      .split('/')
      .pop()
      ?.replace(/\.webp$/, '');
    if (name && typeof url === 'string') out[name] = url;
  }
  return out;
}

export type Pose =
  | 'stand'
  | 'standw'
  | 'point'
  | 'recoil'
  | 'whisper'
  | 'kneel'
  | 'fall'
  | 'vote'
  | 'grieve'
  | 'dance'
  | 'lantern'
  | 'lie'
  | 'aim'
  | 'bow'
  | 'candle'
  | 'cloak'
  | 'creep'
  | 'guard'
  | 'heal'
  | 'knock'
  | 'lunge'
  | 'sit'
  | 'struggle'
  | 'walk';

/**
 * Per-pose metrics measured from the alpha of each silhouette. The source images draw people
 * at different scales, so `k` (standing height divided by image width) keeps every pose at the
 * same human size; `ax`/`by` are the feet anchor; `ar` is height/width; `f` is the way the
 * figure faces in the image (1 right, -1 left).
 */
export interface PoseInfo {
  k: number;
  ar: number;
  ax: number;
  by: number;
  f: 1 | -1;
}

export const POSE: Record<Pose, PoseInfo> = {
  stand: { k: 1.375, ar: 1.5, ax: 0.48, by: 0.948, f: 1 },
  standw: { k: 1.4, ar: 1.5, ax: 0.48, by: 0.967, f: 1 },
  point: { k: 1.125, ar: 768 / 720, ax: 0.35, by: 0.947, f: 1 },
  recoil: { k: 1.25, ar: 1.2, ax: 0.53, by: 0.941, f: -1 },
  whisper: { k: 1.13, ar: 1.2, ax: 0.5, by: 0.955, f: 1 },
  kneel: { k: 1.33, ar: 768 / 720, ax: 0.5, by: 0.917, f: 1 },
  fall: { k: 1.47, ar: 1.5, ax: 0.5, by: 0.93, f: 1 },
  vote: { k: 1.18, ar: 1.5, ax: 0.42, by: 0.969, f: 1 },
  grieve: { k: 1.25, ar: 1.2, ax: 0.5, by: 0.978, f: 1 },
  dance: { k: 1.25, ar: 863 / 720, ax: 0.53, by: 0.94, f: -1 },
  lantern: { k: 0.97, ar: 758 / 720, ax: 0.5, by: 0.951, f: 1 },
  lie: { k: 0.89, ar: 480 / 720, ax: 0.5, by: 0.825, f: 1 },
  aim: { k: 1.12, ar: 1.2, ax: 0.34, by: 0.968, f: 1 },
  bow: { k: 1.42, ar: 768 / 720, ax: 0.44, by: 0.924, f: 1 },
  candle: { k: 1.32, ar: 1.5, ax: 0.41, by: 0.944, f: 1 },
  cloak: { k: 1.38, ar: 1.5, ax: 0.53, by: 0.97, f: 1 },
  creep: { k: 1.3, ar: 1.2, ax: 0.48, by: 0.911, f: 1 },
  guard: { k: 1.32, ar: 1.5, ax: 0.51, by: 0.919, f: 1 },
  heal: { k: 0.88, ar: 480 / 720, ax: 0.55, by: 0.835, f: -1 },
  knock: { k: 1.13, ar: 1.2, ax: 0.43, by: 0.966, f: 1 },
  lunge: { k: 1.18, ar: 758 / 720, ax: 0.48, by: 0.894, f: 1 },
  sit: { k: 1.42, ar: 1.2, ax: 0.51, by: 0.897, f: 1 },
  struggle: { k: 1.45, ar: 1.5, ax: 0.35, by: 0.97, f: -1 },
  walk: { k: 1.39, ar: 1.5, ax: 0.54, by: 0.954, f: 1 },
};

export function poseUrl(p: Pose): string {
  return POSE_URLS[p] ?? '';
}

/** What a body is doing; each maps to a pose that suits the figure. */
export type Act =
  | 'idle'
  | 'talk'
  | 'accuse'
  | 'vote'
  | 'recoil'
  | 'grieve'
  | 'walk'
  | 'lantern'
  | 'fall'
  | 'lie'
  | 'struggle'
  | 'bow'
  | 'sit'
  | 'candle'
  | 'cloak'
  | 'creep'
  | 'guard'
  | 'heal'
  | 'knock'
  | 'lunge'
  | 'aim'
  | 'kneel'
  | 'whisper'
  | 'dance';

export type Figure = 'm' | 'w';

const ACT: Record<Act, Pose | Record<Figure, Pose>> = {
  idle: { m: 'stand', w: 'standw' },
  talk: { m: 'stand', w: 'standw' },
  accuse: 'point',
  vote: { m: 'knock', w: 'vote' },
  recoil: 'recoil',
  grieve: { m: 'kneel', w: 'grieve' },
  walk: { m: 'stand', w: 'walk' },
  lantern: 'lantern',
  fall: 'fall',
  lie: 'lie',
  struggle: { m: 'recoil', w: 'struggle' },
  bow: 'bow',
  sit: 'sit',
  candle: { m: 'lantern', w: 'candle' },
  cloak: 'cloak',
  creep: 'creep',
  guard: 'guard',
  heal: 'heal',
  knock: 'knock',
  lunge: 'lunge',
  aim: 'aim',
  kneel: { m: 'kneel', w: 'grieve' },
  whisper: 'whisper',
  dance: 'dance',
};

export function poseFor(act: Act, fig: Figure): Pose {
  const p = ACT[act];
  return typeof p === 'string' ? p : p[fig];
}

export type Expression = 'neutral' | 'afraid' | 'speak' | 'closed';

export interface Face {
  id: string;
  fig: Figure;
  /** Face centre (between the eyes and the mouth) in image fractions. */
  cx: number;
  cy: number;
}

/** The company: fifteen silent-film faces, one per seat. */
export const FACES: readonly Face[] = [
  { id: 'anton', fig: 'm', cx: 0.49, cy: 0.565 },
  { id: 'ilse', fig: 'w', cx: 0.5, cy: 0.525 },
  { id: 'vale', fig: 'm', cx: 0.51, cy: 0.555 },
  { id: 'kestrel', fig: 'w', cx: 0.51, cy: 0.58 },
  { id: 'bram', fig: 'm', cx: 0.47, cy: 0.475 },
  { id: 'mira', fig: 'w', cx: 0.49, cy: 0.575 },
  { id: 'teodor', fig: 'm', cx: 0.5, cy: 0.545 },
  { id: 'orsola', fig: 'w', cx: 0.49, cy: 0.555 },
  { id: 'f11', fig: 'm', cx: 0.52, cy: 0.43 },
  { id: 'juniper', fig: 'w', cx: 0.5, cy: 0.58 },
  { id: 'f13', fig: 'm', cx: 0.52, cy: 0.44 },
  { id: 'f12', fig: 'w', cx: 0.5, cy: 0.47 },
  { id: 'f15', fig: 'm', cx: 0.52, cy: 0.41 },
  { id: 'f14', fig: 'w', cx: 0.53, cy: 0.49 },
  { id: 'f10', fig: 'w', cx: 0.5, cy: 0.5 },
];

export function faceUrl(id: string, x: Expression): string {
  return FACE_URLS[`${id}-${x}`] ?? FACE_URLS[`${id}-neutral`] ?? '';
}

/** Every art URL, for warming the cache while the lobby fills. */
export function allArtUrls(): string[] {
  return [...Object.values(POSE_URLS), ...Object.values(FACE_URLS), ...Object.values(HAND_URLS)];
}

/** Small string hash (FNV-1a) for seeding. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deal a face to each seat. The deal is shuffled by `key` (the room's game), so every
 * player in a room sees the same casting, and a rematch recasts.
 */
export function castFaces(seats: number, key: string): Face[] {
  const order = FACES.map((f, i) => ({ f, r: rng(hash(`${key}:${i}`))() }));
  order.sort((a, b) => a.r - b.r);
  return Array.from({ length: seats }, (_, i) => (order[i % order.length] as { f: Face }).f);
}
