// Voice chat in a private online room: WebRTC audio straight between the two players (or
// through TURN). The game server only passes the signalling along (Net.signal / onSignal),
// and the match never waits for the voice: it runs on its own connection.
export type VoiceState = 'connecting' | 'connected' | 'failed' | 'closed';
type Signal = { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

export class Voice {
  state: VoiceState = 'connecting';
  muted = false; // my microphone
  deaf = false; // the other player's voice
  micError = false; // no microphone access: I still hear the other player
  private pc: RTCPeerConnection;
  private local: MediaStream | null = null;
  private audio: HTMLAudioElement;
  private ready: Promise<void>;
  private queued: RTCIceCandidateInit[] = [];
  private send: (d: Signal) => void;

  constructor(send: (d: Signal) => void, cfg: { iceServers: RTCIceServer[]; initiator: boolean }) {
    this.send = send;
    this.pc = new RTCPeerConnection({ iceServers: cfg.iceServers });
    this.audio = Object.assign(document.createElement('audio'), { autoplay: true });
    this.pc.onicecandidate = (e) => { if (e.candidate) this.send({ candidate: e.candidate.toJSON() }); };
    this.pc.ontrack = (e) => {
      this.audio.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      this.audio.play().catch(() => {}); // autoplay is allowed: the player tapped to get here
    };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      this.state = s === 'connected' ? 'connected' : s === 'failed' ? 'failed' : s === 'closed' ? 'closed' : 'connecting';
    };
    this.ready = this.microphone().then(async () => {
      if (!cfg.initiator) return;
      await this.pc.setLocalDescription(await this.pc.createOffer());
      this.send({ sdp: this.pc.localDescription!.toJSON() });
    });
  }

  private async microphone() {
    try {
      this.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      for (const t of this.local.getAudioTracks()) this.pc.addTrack(t, this.local);
    } catch {
      this.micError = true;
      this.pc.addTransceiver('audio', { direction: 'recvonly' });
    }
  }

  /** Signalling from the other player, relayed by the game server. */
  async receive(d: Signal) {
    await this.ready;
    try {
      if (d.sdp) {
        await this.pc.setRemoteDescription(d.sdp);
        if (d.sdp.type === 'offer') {
          await this.pc.setLocalDescription(await this.pc.createAnswer());
          this.send({ sdp: this.pc.localDescription!.toJSON() });
        }
        for (const c of this.queued.splice(0)) await this.pc.addIceCandidate(c);
      } else if (d.candidate) {
        if (this.pc.remoteDescription) await this.pc.addIceCandidate(d.candidate);
        else this.queued.push(d.candidate);
      }
    } catch { /* a bad or late candidate: ICE copes with the rest */ }
  }

  toggleMute() {
    this.muted = !this.muted;
    for (const t of this.local?.getAudioTracks() ?? []) t.enabled = !this.muted;
  }

  toggleDeaf() { this.deaf = !this.deaf; this.audio.muted = this.deaf; }

  /** Bytes of the other player's audio received so far (tests and the connection check). */
  async received(): Promise<number> {
    let n = 0;
    (await this.pc.getStats()).forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'audio') n += r.bytesReceived ?? 0; });
    return n;
  }

  close() {
    for (const t of this.local?.getTracks() ?? []) t.stop();
    this.pc.close();
    this.audio.srcObject = null;
    this.state = 'closed';
  }
}
