// Developer page for the WebRTC signaling pilot. Playwright drives it through
// `window.__pilot`; humans can open two tabs with the same room to try it.

type Role = 'host' | 'client';
type Payload = { kind: string; [key: string]: string | number | boolean | null };

interface PilotState {
  transport: string;
  role: Role;
  room: string;
  status: 'starting' | 'waiting' | 'connected' | 'error';
  errors: string[];
  signalingReadyAt: number | null;
  connectedAt: number | null;
  peers: string[];
  received: { at: number; from: string; data: Payload }[];
}

interface Link {
  sendTo(peerId: string, data: Payload): void;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

const params = new URLSearchParams(location.search);
const state: PilotState = {
  transport: params.get('transport') ?? 'peerjs',
  role: params.get('role') === 'host' ? 'host' : 'client',
  room: params.get('room') ?? 'demo',
  status: 'starting',
  errors: [],
  signalingReadyAt: null,
  connectedAt: null,
  peers: [],
  received: [],
};

let link: Link | null = null;
let hostId: string | null = null;

const out = document.getElementById('out');
function render(): void {
  if (out) out.textContent = JSON.stringify(state, null, 2);
}

function now(): number {
  return Math.round(performance.now());
}

function onData(from: string, data: Payload): void {
  state.received.push({ at: now(), from, data });
  if (state.role === 'client' && data.kind === 'hello' && data.role === 'host' && !hostId) {
    hostId = from;
    state.connectedAt = now();
    state.status = 'connected';
  }
  if (state.role === 'host' && data.kind === 'hello' && data.role === 'client') {
    if (!state.peers.includes(from)) state.peers.push(from);
    state.status = 'connected';
  }
  if (data.kind === 'ping' && link) link.sendTo(from, { kind: 'pong', seq: data.seq ?? 0 });
  render();
}

function fail(message: string): void {
  state.errors.push(message);
  if (state.status !== 'connected') state.status = 'error';
  render();
}

async function startPeerJs(): Promise<void> {
  const { Peer } = await import('peerjs');
  type Conn = import('peerjs').DataConnection;
  const conns = new Map<string, Conn>();
  const hostPeerId = `vesper-pilot-${state.room}`;
  const peer =
    state.role === 'host'
      ? new Peer(hostPeerId, { config: { iceServers: ICE_SERVERS }, debug: 1 })
      : new Peer({ config: { iceServers: ICE_SERVERS }, debug: 1 });

  const wire = (conn: Conn): void => {
    conn.on('open', () => {
      conns.set(conn.peer, conn);
      conn.send({ kind: 'hello', role: state.role });
    });
    conn.on('data', (d) => onData(conn.peer, d as Payload));
    conn.on('close', () => conns.delete(conn.peer));
    conn.on('error', (e) => fail(`conn: ${e.type}`));
  };

  link = { sendTo: (id, data) => conns.get(id)?.send(data) };
  peer.on('error', (e) => fail(`peer: ${e.type}`));
  peer.on('open', () => {
    state.signalingReadyAt = now();
    state.status = 'waiting';
    render();
    if (state.role === 'client') {
      wire(peer.connect(hostPeerId, { reliable: true, serialization: 'json' }));
    }
  });
  if (state.role === 'host') peer.on('connection', wire);
}

async function startTrystero(): Promise<void> {
  const strategy = state.transport.replace('trystero-', '');
  const mod =
    strategy === 'mqtt'
      ? await import('@trystero-p2p/mqtt')
      : strategy === 'torrent'
        ? await import('@trystero-p2p/torrent')
        : await import('trystero');
  const room = mod.joinRoom(
    { appId: 'vesper-pilot', rtcConfig: { iceServers: ICE_SERVERS } },
    state.room,
    { onJoinError: (d) => fail(`join: ${d.error}`) },
  );
  state.signalingReadyAt = now();
  state.status = 'waiting';
  const msg = room.makeAction<Payload>('msg');
  link = { sendTo: (id, data) => void msg.send(data, { target: id }) };
  msg.onMessage = (data, ctx) => onData(ctx.peerId, data);
  room.onPeerJoin = (id) => void msg.send({ kind: 'hello', role: state.role }, { target: id });
  room.onPeerLeave = (id) => {
    state.peers = state.peers.filter((p) => p !== id);
    render();
  };
}

const api = {
  state,
  sendTo: (peerId: string, data: Payload) => link?.sendTo(peerId, data),
  sendToHost: (data: Payload) => (hostId ? link?.sendTo(hostId, data) : undefined),
};
(window as unknown as { __pilot: typeof api }).__pilot = api;

render();
(state.transport === 'peerjs' ? startPeerJs() : startTrystero()).catch((e: unknown) =>
  fail(`start: ${e instanceof Error ? e.message : String(e)}`),
);
