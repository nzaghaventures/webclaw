/**
 * WebClaw Audio Handler
 * Manages microphone capture and audio playback via Web Audio API.
 */

export class AudioHandler {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private onAudioData: ((data: ArrayBuffer) => void) | null = null;
  private playbackQueue: Float32Array[] = [];
  private isPlaying = false;

  async startCapture(onData: (data: ArrayBuffer) => void): Promise<void> {
    this.onAudioData = onData;
    this.audioContext = new AudioContext({ sampleRate: 16000 });

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    const source = this.audioContext.createMediaStreamSource(this.mediaStream);
    // Use ScriptProcessorNode for raw PCM access (AudioWorklet is better but more complex)
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);
      // Convert Float32 to Int16 PCM
      const pcm16 = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      this.onAudioData?.(pcm16.buffer);
    };

    source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  stopCapture(): void {
    this.processor?.disconnect();
    this.mediaStream?.getTracks().forEach(t => t.stop());
    this.processor = null;
    this.mediaStream = null;
  }

  /**
   * Queue audio data for playback.
   * Expects base64-encoded PCM16 at 24kHz (Gemini output format).
   */
  playAudio(base64Data: string): void {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: 24000 });
    }

    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    // Convert Int16 PCM to Float32
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
      return;
    }

    this.isPlaying = true;
    const data = this.playbackQueue.shift()!;
    const ctx = this.audioContext!;
    const buffer = ctx.createBuffer(1, data.length, 24000);
    buffer.getChannelData(0).set(data);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => this.processPlaybackQueue();
    source.start();
  }

  destroy(): void {
    this.stopCapture();
    this.audioContext?.close();
    this.audioContext = null;
    this.playbackQueue = [];
  }
}
