// Voice chat between the two players of a private room (both must switch it on). The server
// only relays WebRTC signalling — offer, answer, ICE candidates; the audio itself goes peer to
// peer, or through a TURN relay when a direct path is impossible (or to hide addresses).
import { createHmac } from 'node:crypto';

export interface VoiceOptions {
  stun?: string[]; // e.g. stun:stun.l.google.com:19302
  turn?: string[]; // e.g. turn:turn.example.pl:3478?transport=udp
  turnSecret?: string; // coturn static-auth-secret (use-auth-secret): credentials expire after `ttl`
  ttl?: number; // seconds
}

export const MAX_SIGNAL = 16_000; // bytes per message
export const MAX_SIGNALS = 300; // per match: an offer, an answer and a few dozen candidates are plenty

/** ICE servers for one call; TURN credentials follow the coturn REST scheme (expiry:user, HMAC-SHA1). */
export function iceServers(o: VoiceOptions = {}, now = Date.now()) {
  const list: { urls: string[]; username?: string; credential?: string }[] = [];
  if (o.stun?.length) list.push({ urls: o.stun });
  if (o.turn?.length && o.turnSecret) {
    const username = `${Math.floor(now / 1000) + (o.ttl ?? 3600)}:kickabout`;
    list.push({ urls: o.turn, username, credential: createHmac('sha1', o.turnSecret).update(username).digest('base64') });
  }
  return list;
}

export function voiceFromEnv(env = process.env): VoiceOptions {
  const list = (v?: string) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  return { stun: list(env.STUN_URLS ?? 'stun:stun.l.google.com:19302'), turn: list(env.TURN_URLS), turnSecret: env.TURN_SECRET || undefined };
}
