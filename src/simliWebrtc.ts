import {
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client';

export interface SimliSessionData {
  session_token: string;
  iceServers: RTCIceServer[];
}

export interface SimliEngineCallbacks {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onSpeaking?: () => void;
  onSilent?: () => void;
  onError?: (err: string) => void;
}

const createAudioWorkletCode = (bufferSize: number) => `
class SimliAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(${bufferSize});
    this.bufferIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const inputChannel = input && input[0];
    if (inputChannel) {
      for (let i = 0; i < inputChannel.length; i++) {
        this.buffer[this.bufferIndex] = Math.max(
          -32768,
          Math.min(32767, Math.round(inputChannel[i] * 32767))
        );
        this.bufferIndex++;
        if (this.bufferIndex === this.buffer.length) {
          this.port.postMessage({
            type: 'audioData',
            data: this.buffer.slice(0, this.bufferIndex)
          });
          this.bufferIndex = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('simli-audio-processor', SimliAudioProcessor);
`;

export class SimliWebRTCClient {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private lkRoom: Room | null = null;
  private audioContext: AudioContext | null = null;
  private audioWorklet: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private warmupTimer: number | null = null;
  private videoElement: HTMLVideoElement;
  private audioElement: HTMLAudioElement;
  private callbacks: SimliEngineCallbacks;
  private isStopped = false;

  constructor(
    videoElement: HTMLVideoElement,
    audioElement: HTMLAudioElement,
    callbacks: SimliEngineCallbacks = {}
  ) {
    this.videoElement = videoElement;
    this.audioElement = audioElement;
    this.callbacks = callbacks;
  }

  async connect(
    sessionData: SimliSessionData,
    mode: 'p2p' | 'livekit' = 'p2p'
  ): Promise<void> {
    this.isStopped = false;
    if (mode === 'livekit') {
      await this.connectLiveKit(sessionData.session_token);
    } else {
      await this.connectP2P(sessionData.session_token, sessionData.iceServers);
    }
  }

  private startWarmupSilence(): void {
    this.sendInitialSilence();
    if (this.warmupTimer) {
      window.clearInterval(this.warmupTimer);
    }
    let count = 0;
    this.warmupTimer = window.setInterval(() => {
      if (this.isStopped || count >= 6) {
        if (this.warmupTimer) {
          window.clearInterval(this.warmupTimer);
          this.warmupTimer = null;
        }
        return;
      }
      this.sendInitialSilence();
      count += 1;
    }, 350);
  }

  private async connectP2P(
    sessionToken: string,
    iceServers: RTCIceServer[]
  ): Promise<void> {
    const pc = new RTCPeerConnection({
      iceServers:
        iceServers && iceServers.length > 0
          ? iceServers
          : [{ urls: ['stun:stun.l.google.com:19302'] }],
    });
    this.pc = pc;

    pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.addTransceiver('video', { direction: 'recvonly' });

    pc.addEventListener('track', (evt) => {
      if (evt.track.kind === 'video') {
        this.videoElement.srcObject = evt.streams[0];
        this.videoElement.play().catch(() => {});
        this.callbacks.onConnected?.();
      } else if (evt.track.kind === 'audio') {
        this.audioElement.srcObject = evt.streams[0];
        this.audioElement.play().catch(() => {});
      }
    });

    let iceCount = 0;
    let prevIceCount = 0;
    pc.onicecandidate = (evt) => {
      if (evt.candidate !== null) {
        iceCount += 1;
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await new Promise<void>((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      const timeout = setTimeout(() => resolve(), 3500);
      const check = () => {
        if (
          pc.iceGatheringState === 'complete' ||
          (iceCount > 0 && iceCount === prevIceCount)
        ) {
          clearTimeout(timeout);
          resolve();
        } else {
          prevIceCount = iceCount;
          setTimeout(check, 150);
        }
      };
      setTimeout(check, 150);
    });

    const wsUrl = new URL('wss://api.simli.ai/compose/webrtc/p2p');
    wsUrl.searchParams.set('session_token', sessionToken);
    wsUrl.searchParams.set('enableSFU', 'true');

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl.toString());
      this.ws = ws;

      const timer = setTimeout(() => {
        reject(new Error('Délai de connexion WebSocket Simli dépassé.'));
      }, 12000);

      ws.onopen = () => {
        clearTimeout(timer);
        if (pc.localDescription) {
          ws.send(JSON.stringify(pc.localDescription));
        }
        resolve();
      };

      ws.onmessage = async (event) => {
        const raw = String(event.data);
        const firstToken = raw.toUpperCase().split(' ')[0];

        if (firstToken === 'ACK') {
          this.startWarmupSilence();
        } else if (firstToken === 'SPEAK') {
          this.callbacks.onSpeaking?.();
        } else if (firstToken === 'SILENT') {
          this.callbacks.onSilent?.();
        } else if (
          firstToken === 'CLOSING' ||
          firstToken === 'ERROR' ||
          firstToken === 'ERROR:' ||
          firstToken === 'RATE'
        ) {
          this.callbacks.onError?.(raw);
          this.stop();
        } else if (raw.includes('sdp') || raw.includes('answer')) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed.sdp && parsed.type === 'answer') {
              await pc.setRemoteDescription(new RTCSessionDescription(parsed));
              this.startWarmupSilence();
            }
          } catch {
            // Ignore non-JSON message
          }
        }
      };

      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Erreur de connexion WebSocket Simli.'));
      };

      ws.onclose = () => {
        if (!this.isStopped) {
          this.callbacks.onDisconnected?.();
        }
      };
    });
  }

  private async connectLiveKit(sessionToken: string): Promise<void> {
    const room = new Room({ adaptiveStream: false, dynacast: true });
    this.lkRoom = room;

    room.on(
      RoomEvent.TrackSubscribed,
      (
        track: RemoteTrack,
        _pub: RemoteTrackPublication,
        _participant: RemoteParticipant
      ) => {
        if (track.kind === Track.Kind.Video) {
          track.attach(this.videoElement);
          this.videoElement.play().catch(() => {});
          this.callbacks.onConnected?.();
        } else if (track.kind === Track.Kind.Audio) {
          track.attach(this.audioElement);
          this.audioElement.play().catch(() => {});
        }
      }
    );

    room.on(RoomEvent.Disconnected, () => {
      if (!this.isStopped) {
        this.callbacks.onDisconnected?.();
      }
    });

    const wsUrl = new URL('wss://api.simli.ai/compose/webrtc/livekit');
    wsUrl.searchParams.set('session_token', sessionToken);

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl.toString());
      this.ws = ws;

      ws.onopen = () => {
        resolve();
      };

      ws.onmessage = async (event) => {
        const raw = String(event.data);
        if (raw.includes('livekit_url') && raw.includes('livekit_token')) {
          try {
            const info = JSON.parse(raw);
            await room.connect(info.livekit_url, info.livekit_token);
            this.startWarmupSilence();
          } catch (err) {
            this.callbacks.onError?.(
              err instanceof Error ? err.message : 'Erreur LiveKit Simli'
            );
          }
        }
      };

      ws.onerror = () => {
        reject(new Error('Erreur WebSocket LiveKit Simli'));
      };
    });
  }

  async attachMicrophoneTrack(audioTrack: MediaStreamTrack): Promise<void> {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new AudioCtx({ sampleRate: 16000 });
    this.audioContext = ctx;

    const source = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
    this.sourceNode = source;

    const blob = new Blob([createAudioWorkletCode(3000)], {
      type: 'application/javascript',
    });
    const workletUrl = URL.createObjectURL(blob);
    await ctx.audioWorklet.addModule(workletUrl);

    const workletNode = new AudioWorkletNode(ctx, 'simli-audio-processor');
    this.audioWorklet = workletNode;
    source.connect(workletNode);

    workletNode.port.onmessage = (event) => {
      if (
        event.data?.type === 'audioData' &&
        this.ws &&
        this.ws.readyState === WebSocket.OPEN
      ) {
        const pcmBuffer: ArrayBuffer = event.data.data.buffer;
        this.ws.send(new Uint8Array(pcmBuffer));
      }
    };

    this.sendInitialSilence();
  }

  sendInitialSilence(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const silence = new Uint8Array(6400);
      this.ws.send(silence);
    }
  }

  sendRawPcm16(pcmBytes: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(pcmBytes);
    }
  }

  stop(): void {
    this.isStopped = true;
    if (this.warmupTimer) {
      window.clearInterval(this.warmupTimer);
      this.warmupTimer = null;
    }
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send('DONE');
      }
      this.ws?.close();
    } catch {
      // Ignore
    }
    this.ws = null;

    try {
      this.audioWorklet?.disconnect();
      this.sourceNode?.disconnect();
      this.audioContext?.close();
    } catch {
      // Ignore
    }
    this.audioWorklet = null;
    this.sourceNode = null;
    this.audioContext = null;

    try {
      this.pc?.close();
    } catch {
      // Ignore
    }
    this.pc = null;

    try {
      this.lkRoom?.disconnect();
    } catch {
      // Ignore
    }
    this.lkRoom = null;
  }
}
