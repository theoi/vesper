/** Porcelain masks drawn in SVG. Every player wears a different one. */

let uid = 0;

const FACE = 'M50 5 C77 5 92 22 92 47 C92 79 73 110 50 125 C27 110 8 79 8 47 C8 22 23 5 50 5 Z';
// The fracture line shared by the crack drawing and the two falling halves.
const CRACK = [
  [50, 3],
  [46, 24],
  [54, 41],
  [47, 58],
  [55, 77],
  [48, 96],
  [53, 112],
  [50, 128],
] as const;
const crackPath = 'M' + CRACK.map(([x, y]) => `${x} ${y}`).join(' L');

export interface MaskOptions {
  variant: number;
  eyesClosed?: boolean;
  cracked?: boolean;
  half?: 'left' | 'right';
  glowEyes?: boolean;
}

const eyeHole = (cx: number, tilt: number, dir: 1 | -1) =>
  `M${cx - 12} ${52 + tilt * dir * 0.3} Q${cx} ${40 + tilt} ${cx + 12} ${52 - tilt * dir * 0.3} Q${cx} ${60 + tilt * 0.2} ${cx - 12} ${52 + tilt * dir * 0.3} Z`;

function ornament(v: number, id: string): string {
  switch (v % 9) {
    case 0:
      return `<path d="${FACE}" fill="url(#${id}g)" clip-path="url(#${id}lh)" opacity=".92"/>
        <g stroke="#fff3c4" stroke-width=".35" opacity=".5" clip-path="url(#${id}lh)">
          <path d="M14 30 L46 34 M10 62 L46 58 M18 92 L46 88 M24 18 L44 22"/></g>`;
    case 1:
      return `<path d="M68 63 C71 68 72 71 68 75 C64 71 65 68 68 63Z" fill="url(#${id}g)"/>
        <path d="M50 15 L52 21 L58 21 L53 25 L55 31 L50 27 L45 31 L47 25 L42 21 L48 21Z" fill="url(#${id}g)"/>`;
    case 2:
      return `<path d="M42 16 A10 10 0 1 0 58 16 A8 8 0 1 1 42 16Z" fill="#1f2c4d" opacity=".85"/>
        <path d="M22 50 L12 38 M78 50 L88 38 M30 62 L24 78 M70 62 L76 78" stroke="#1f2c4d" stroke-width="1.2" stroke-linecap="round"/>`;
    case 3:
      return [0, 1, 2, 3, 4]
        .map((i) => {
          const x = 64 + (i % 2) * 10;
          const y = 64 + i * 7;
          return `<path d="M${x} ${y - 6} L${x + 5} ${y} L${x} ${y + 6} L${x - 5} ${y}Z" fill="${i % 2 ? '#1b1214' : '#8c1c2c'}"/>`;
        })
        .join('');
    case 4:
      return `<g stroke="#3b2a22" stroke-width=".5" opacity=".75">${[0, 1, 2, 3, 4]
        .map((i) => `<path d="M28 ${14 + i * 3} Q50 ${10 + i * 3} 72 ${14 + i * 3}" fill="none"/>`)
        .join(
          '',
        )}</g><ellipse cx="58" cy="18.5" rx="2.6" ry="1.9" fill="#3b2a22" transform="rotate(-20 58 18.5)"/>
        <path d="M60.3 17.8 L60.3 8" stroke="#3b2a22" stroke-width=".7"/>`;
    case 5:
      return `<g fill="none" stroke="url(#${id}g)" stroke-width="1.4" stroke-linecap="round">
        <path d="M17 54 C14 38 30 32 38 40 C42 44 38 48 35 46"/><path d="M83 54 C86 38 70 32 62 40 C58 44 62 48 65 46"/>
        <path d="M24 66 C30 74 40 72 40 66"/><path d="M76 66 C70 74 60 72 60 66"/></g>`;
    case 6:
      return `<path d="M9 45 Q50 33 91 45 L89 61 Q50 52 11 61 Z" fill="#1d1418" opacity=".92"/>`;
    case 7:
      return Array.from({ length: 22 }, (_, i) => {
        const a = (i / 22) * Math.PI * 2;
        return `<circle cx="${50 + Math.sin(a) * 37}" cy="${62 - Math.cos(a) * 52}" r=".9" fill="url(#${id}g)"/>`;
      }).join('');
    default:
      return `<g fill="url(#${id}g)">${[-3, -2, -1, 0, 1, 2, 3]
        .map(
          (i) =>
            `<path d="M${50 + i * 7} 14 L${50 + i * 7 - 2} 6 L${50 + i * 7 + 2} 6Z" transform="rotate(${i * 9} 50 40)"/>`,
        )
        .join(
          '',
        )}</g><circle cx="30" cy="76" r="8" fill="url(#${id}r)"/><circle cx="70" cy="76" r="8" fill="url(#${id}r)"/>`;
  }
}

export function maskSVG(o: MaskOptions): string {
  const id = `mk${uid++}`;
  const v = o.variant;
  const tilt = [0, 4, -3, 6, -5, 2, 8, -2, 3][v % 9] ?? 0;
  const eyes = o.eyesClosed
    ? ''
    : `<path d="${eyeHole(32, tilt, 1)}" fill="black"/><path d="${eyeHole(68, tilt, -1)}" fill="black"/>`;
  const leftPoly = `0 0 ${CRACK.map(([x, y]) => `${x} ${y}`).join(' ')} 0 130`;
  const rightPoly = `100 0 ${CRACK.map(([x, y]) => `${x} ${y}`).join(' ')} 100 130`;
  const clip = o.half ? `clip-path="url(#${id}${o.half === 'left' ? 'cl' : 'cr'})"` : '';
  const closed = o.eyesClosed
    ? `<g fill="none" stroke="#3b2a22" stroke-width="1.3" stroke-linecap="round"><path d="M21 53 Q32 59 43 53"/><path d="M57 53 Q68 59 79 53"/>
       <path d="M24 55 L22 58 M29 57 L28 60.5 M35 57 L35.5 60.5 M40 55 L42 58 M60 55 L58 58 M65 57 L64.5 60.5 M71 57 L72 60.5 M76 55 L78 58" stroke-width=".7"/></g>`
    : `<g fill="none" stroke="url(#${id}g)" stroke-width=".9"><path d="${eyeHole(32, tilt, 1)}"/><path d="${eyeHole(68, tilt, -1)}"/></g>`;
  const glow = o.glowEyes
    ? `<g class="eye-glow"><ellipse cx="32" cy="${51 + tilt * 0.2}" rx="7" ry="3.4" fill="#ff3b2f"/><ellipse cx="68" cy="${51 + tilt * 0.2}" rx="7" ry="3.4" fill="#ff3b2f"/></g>`
    : '';
  return `<svg viewBox="0 0 100 130" xmlns="http://www.w3.org/2000/svg" class="mask-svg" aria-hidden="true">
  <defs>
    <radialGradient id="${id}p" cx="44%" cy="34%" r="70%">
      <stop offset="0" stop-color="#fffaf2"/><stop offset=".55" stop-color="#efe5d5"/><stop offset="1" stop-color="#c8b9a2"/>
    </radialGradient>
    <linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f7e6a6"/><stop offset=".45" stop-color="#c9a24a"/><stop offset=".7" stop-color="#8a6a2a"/><stop offset="1" stop-color="#ecd38c"/>
    </linearGradient>
    <radialGradient id="${id}r"><stop offset="0" stop-color="#d9606a" stop-opacity=".55"/><stop offset="1" stop-color="#d9606a" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}s" cx="50%" cy="45%" r="62%"><stop offset=".6" stop-color="#3a2020" stop-opacity="0"/><stop offset="1" stop-color="#3a2020" stop-opacity=".35"/></radialGradient>
    <clipPath id="${id}lh"><rect x="0" y="0" width="50" height="130"/></clipPath>
    <clipPath id="${id}cl"><polygon points="${leftPoly}"/></clipPath>
    <clipPath id="${id}cr"><polygon points="${rightPoly}"/></clipPath>
    <mask id="${id}m"><path d="${FACE}" fill="white"/>${eyes}</mask>
  </defs>
  <g ${clip}>
    ${glow}
    <g mask="url(#${id}m)">
      <path d="${FACE}" fill="url(#${id}p)"/>
      ${ornament(v, id)}
      <path d="${FACE}" fill="url(#${id}s)"/>
      <g fill="none" stroke="#3b2a22" stroke-width="1.1" stroke-linecap="round" opacity=".8">
        <path d="M20 ${41 - tilt * 0.3} Q32 ${33 + tilt * 0.5} 44 ${40}"/><path d="M56 40 Q68 ${33 + tilt * 0.5} 80 ${41 - tilt * 0.3}"/>
      </g>
      ${v % 9 === 7 ? '' : '<path d="M43 99 Q46.5 96 50 97.6 Q53.5 96 57 99 Q50 104 43 99Z" fill="#8c1c2c"/><path d="M43 99 Q50 100.5 57 99" stroke="#4a0d18" stroke-width=".5" fill="none"/>'}
      <path class="night-shade" d="${FACE}" fill="#070a18"/>
    </g>
    ${closed}
    <path d="${FACE}" fill="none" stroke="url(#${id}g)" stroke-width="1.7"/>
    ${o.cracked ? `<path class="crack" d="${crackPath}" pathLength="1" fill="none" stroke="#2a1616" stroke-width="1.1" stroke-linejoin="bevel"/><path class="crack" d="M47 58 L34 64 L28 74 M55 77 L68 82 L74 94 M46 24 L36 18" pathLength="1" fill="none" stroke="#2a1616" stroke-width=".7"/>` : ''}
  </g>
</svg>`;
}
