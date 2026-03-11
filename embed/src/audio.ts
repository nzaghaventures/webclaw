/**
 * WebClaw Audio Handler
 * Manages microphone capture with Voice Activity Detection (VAD)
 * and audio playback via Web Audio API.
 * Seamless mode: mic is always on, VAD detects when user speaks.
 */

export type AudioState = 'idle' | 'listening' | 'speaking' | 'playing';

export interface AudioHandlerOptions {
  /** VAD energy threshold (0-1). Lower = more sensitive. Default 0.01 */
  vadThreshold?: number;
  /** Milliseconds of silence before stopping speech. Default 1500 */
  vadSilenceTimeout?: number;
  /** Whether to use seamless (always-on) mode. Default true */
  seamless?: boolean;
  /** Sample rate for capture. Default 16000 */
  captureSampleRate?: number;
  /** Sample rate for playback. Default 24000 */
  playbackSampleRate?: number;
}

const DEFAULT_OPTS: Required<AudioHandlerOptions> = {
  vadThreshold: 0.01,
  vadSilenceTimeout: 1500,
  seamless: true,
  captureSampleRate: 16000,
  playbackSampleRate: 24000,
};

export class AudioHandler {
  private audioContext: AudioContext | null = null;
  private playbackContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserData: Uint8Array | null = null;
  private onAudioData: ((data: ArrayBuffer) => void) | null = null;
  private playbackQueue: Float32Array[] = [];
  private isPlaying = false;
  private opts: Required<AudioHandlerOptions>;

  // VAD state
  private _state: AudioState = 'idle';
  private isSpeaking = false;
  private silenceStart: number = 0;
  private energyHistory: number[] = [];
  private vadCheckInterval: number = 0;

  // Callbacks
  private onStateChange: ((state: AudioState) => void) | null = null;
  private onSpeechStart: (() => void) | null = null;
  private onSpeechEnd: (() => void) | null = null;
  private onAmplitude: ((amplitude: number) => void) | null = null;

  // Playback audio node for lip-sync
  private lastPlaybackSource: AudioBufferSourceNode | null = null;
  private playbackAnalyser: AnalyserNode | null = null;

  constructor(options?: AudioHandlerOptions) {
    this.opts = { ...DEFAULT_OPTS, ...options };
  }

  get state(): AudioState { return this._state; }

  on(event: 'stateChange', cb: (state: AudioState) => void): void;
  on(event: 'speechStart', cb: () => void): void;
  on(event: 'speechEnd', cb: () => void): void;
  on(event: 'amplitude', cb: (amplitude: number) => void): void;
  on(event: string, cb: (...args: any[]) => void): void {
    switch (event) {
      case 'stateChange': this.onStateChange = cb; break;
      case 'speechStart': this.onSpeechStart = cb; break;
      case 'speechEnd': this.onSpeechEnd = cb; break;
      case 'amplitude': this.onAmplitude = cb; break;
    }
  }

  getPlaybackAnalyser(): AnalyserNode | null {
    return this.playbackAnalyser;
  }

  private setState(state: AudioState): void {
    if (this._state !== state) {
      this._state = state;
      this.onStateChange?.(state);
    }
  }

  /**
   * Start seamless capture - mic is always on, VAD handles the rest.
   * Audio data is only sent when speech is detected.
   */
  async startSeamless(onData: (data: ArrayBuffer) => void): Promise<void> {
    this.onAudioData = onData;
    this.audioContext = new AudioContext({ sampleRate: this.opts.captureSampleRate });

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: this.opts.captureSampleRate,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const source = this.audioContext.createMediaStreamSource(this.mediaStream);

    // Create analyser for VAD energy detection
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyserData = new Uint8Array(this.analyser.frequencyBinCount);
    source.connect(this.analyser);

    // Processor to get raw PCM
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);

      // Calculate RMS energy for VAD
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) {
        sum += inputData[i] * inputData[i];
      }
      const rms = Math.sqrt(sum / inputData.length);
      this.onAmplitude?.(rms);

      // VAD logic
      this.processVAD(rms);

      // Only send audio when speech detected (or always in non-seamless mode)
      if (this.isSpeaking || !this.opts.seamless) {
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        this.onAudioData?.(pcm16.buffer);
      }
    };

    source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);

    this.setState('listening');
  }

  /**
   * Legacy: Start capture without VAD (push-to-talk mode)
   */
  async startCapture(onData: (data: ArrayBuffer) => void): Promise<void> {
    if (this.opts.seamless) {
      return this.startSeamless(onData);
    }

    this.onAudioData = onData;
    this.audioContext = new AudioContext({ sampleRate: this.opts.captureSampleRate });

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: this.opts.captureSampleRate,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    const source = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);
      const pcm16 = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      this.onAudioData?.(pcm16.buffer);
    };

    source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
    this.setState('speaking');
  }

  private processVAD(rms: number): void {
    const now = Date.now();

    // Maintain energy history for adaptive threshold
    this.energyHistory.push(rms);
    if (this.energyHistory.length > 50) this.energyHistory.shift();

    const threshold = this.opts.vadThreshold;

    if (rms > threshold) {
      if (!this.isSpeaking) {
        this.isSpeaking = true;
        this.setState('speaking');
        this.onSpeechStart?.();
      }
      this.silenceStart = now;
    } else {
      if (this.isSpeaking && (now - this.silenceStart) > this.opts.vadSilenceTimeout) {
        this.isSpeaking = false;
        this.setState('listening');
        this.onSpeechEnd?.();
      }
    }
  }

  stopCapture(): void {
    this.processor?.disconnect();
    this.mediaStream?.getTracks().forEach(t => t.stop());
    this.processor = null;
    this.mediaStream = null;
    this.isSpeaking = false;
    if (this.vadCheckInterval) {
      clearInterval(this.vadCheckInterval);
      this.vadCheckInterval = 0;
    }
    this.setState('idle');
  }

  /**
   * Queue audio data for playback.
   * Expects base64-encoded PCM16 at playback sample rate (Gemini output format).
   */
  playAudio(base64Data: string): void {
    if (!this.playbackContext) {
      this.playbackContext = new AudioContext({ sampleRate: this.opts.playbackSampleRate });

      // Create playback analyser for lip-sync
      this.playbackAnalyser = this.playbackContext.createAnalyser();
      this.playbackAnalyser.fftSize = 256;
      this.playbackAnalyser.connect(this.playbackContext.destination);
    }

    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 0x7FFF;
    }

    this.playbackQueue.push(float32);
    if (!this.isPlaying) {
      this.processPlaybackQueue();
    }
  }

  private processPlaybackQueue(): void {
    if (this.playbackQueue.length === 0) {
      this.isPlaying = false;
      if (this.mediaStream) {
        this.setState('listening');
      } else {
        this.setState('idle');
      }
      return;
    }

    this.isPlaying = true;
    this.setState('playing');
    const data = this.playbackQueue.shift()!;
    const ctx = this.playbackContext!;
    const buffer = ctx.createBuffer(1, data.length, this.opts.playbackSampleRate);
    buffer.getChannelData(0).set(data);

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Connect through analyser for lip-sync
    if (this.playbackAnalyser) {
      source.connect(this.playbackAnalyser);
    } else {
      source.connect(ctx.destination);
    }

    this.lastPlaybackSource = source;
    source.onended = () => this.processPlaybackQueue();
    source.start();
  }

  /** Stop all playback immediately (barge-in) */
  stopPlayback(): void {
    this.lastPlaybackSource?.stop();
    this.lastPlaybackSource = null;
    this.playbackQueue = [];
    this.isPlaying = false;
    if (this.mediaStream) {
      this.setState('listening');
    }
  }

  /** Check if mic is currently available */
  get isCapturing(): boolean {
    return this.mediaStream !== null;
  }

  destroy(): void {
    this.stopCapture();
    this.stopPlayback();
    this.audioContext?.close();
    this.playbackContext?.close();
    this.audioContext = null;
    this.playbackContext = null;
    this.playbackQueue = [];
  }
}
