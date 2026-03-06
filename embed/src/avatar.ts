/**
 * WebClaw Avatar - Lip-syncing animated agent face
 * Uses Canvas 2D for lightweight, dependency-free animation.
 */

export type AvatarState = 'idle' | 'listening' | 'speaking' | 'thinking' | 'acting';

export class Avatar {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private state: AvatarState = 'idle';
  private animFrame: number = 0;
  private mouthOpenness: number = 0;
  private targetMouthOpenness: number = 0;
  private eyeBlinkTimer: number = 0;
  private isBlinking: boolean = false;
  private pulsePhase: number = 0;
  private bounceY: number = 0;
  private color: string;
  private size: number;

  // Audio analysis for lip sync
  private analyser: AnalyserNode | null = null;
  private analyserData: Uint8Array | null = null;

  constructor(canvas: HTMLCanvasElement, color: string = '#4285f4', size: number = 64) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.color = color;
    this.size = size;
    canvas.width = size;
    canvas.height = size;
    this.startAnimation();
  }

  setState(state: AvatarState): void {
    this.state = state;
  }

  /** Connect to an AudioContext for real lip-sync from audio output */
  connectAudio(audioContext: AudioContext, sourceNode: AudioNode): void {
    this.analyser = audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyserData = new Uint8Array(this.analyser.frequencyBinCount);
    sourceNode.connect(this.analyser);
  }

  /** Feed amplitude directly (0-1) for simple lip sync without analyser */
  setMouthTarget(openness: number): void {
    this.targetMouthOpenness = Math.max(0, Math.min(1, openness));
  }

  private startAnimation(): void {
    const animate = () => {
      this.update();
      this.draw();
      this.animFrame = requestAnimationFrame(animate);
    };
    animate();
  }

  private update(): void {
    // Smooth mouth movement
    const speed = 0.3;
    this.mouthOpenness += (this.targetMouthOpenness - this.mouthOpenness) * speed;

    // Audio-driven mouth
    if (this.analyser && this.analyserData && this.state === 'speaking') {
      this.analyser.getByteFrequencyData(this.analyserData);
      // Average low frequencies for speech
      let sum = 0;
      const count = Math.min(16, this.analyserData.length);
      for (let i = 0; i < count; i++) sum += this.analyserData[i];
      this.targetMouthOpenness = (sum / count / 255) * 1.5;
    }

    // Simulated mouth movement when speaking without analyser
    if (this.state === 'speaking' && !this.analyser) {
      this.targetMouthOpenness = 0.3 + Math.sin(Date.now() * 0.015) * 0.3 + Math.sin(Date.now() * 0.023) * 0.2;
    } else if (this.state !== 'speaking') {
      this.targetMouthOpenness = 0;
    }

    // Eye blinking
    this.eyeBlinkTimer++;
    if (!this.isBlinking && Math.random() < 0.005) {
      this.isBlinking = true;
      this.eyeBlinkTimer = 0;
    }
    if (this.isBlinking && this.eyeBlinkTimer > 8) {
      this.isBlinking = false;
    }

    // Pulse phase (for listening/thinking states)
    this.pulsePhase += 0.05;

    // Gentle bounce
    if (this.state === 'speaking') {
      this.bounceY = Math.sin(Date.now() * 0.003) * 1.5;
    } else if (this.state === 'listening') {
      this.bounceY = Math.sin(Date.now() * 0.002) * 1;
    } else {
      this.bounceY *= 0.95;
    }
  }

  private draw(): void {
    const ctx = this.ctx;
    const s = this.size;
    const cx = s / 2;
    const cy = s / 2 + this.bounceY;
    const r = s * 0.38;

    ctx.clearRect(0, 0, s, s);

    // Glow ring for active states
    if (this.state === 'listening' || this.state === 'speaking') {
      const glowAlpha = 0.15 + Math.sin(this.pulsePhase) * 0.1;
      const glowR = r + 6 + Math.sin(this.pulsePhase) * 3;
      ctx.beginPath();
      ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
      ctx.fillStyle = this.state === 'listening'
        ? `rgba(66, 133, 244, ${glowAlpha})`
        : `rgba(52, 168, 83, ${glowAlpha})`;
      ctx.fill();
    }

    // Thinking spinner
    if (this.state === 'thinking') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.pulsePhase * 2);
      ctx.beginPath();
      ctx.arc(0, 0, r + 4, 0, Math.PI * 1.2);
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    // Head circle
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.fill();

    // Eyes
    const eyeY = cy - r * 0.15;
    const eyeSpacing = r * 0.35;
    const eyeR = r * 0.12;
    const eyeHeight = this.isBlinking ? eyeR * 0.15 : eyeR;

    ctx.fillStyle = 'white';
    // Left eye
    ctx.beginPath();
    ctx.ellipse(cx - eyeSpacing, eyeY, eyeR, eyeHeight, 0, 0, Math.PI * 2);
    ctx.fill();
    // Right eye
    ctx.beginPath();
    ctx.ellipse(cx + eyeSpacing, eyeY, eyeR, eyeHeight, 0, 0, Math.PI * 2);
    ctx.fill();

    // Pupils (with slight movement)
    if (!this.isBlinking) {
      const pupilR = eyeR * 0.5;
      const pupilOffsetX = Math.sin(Date.now() * 0.001) * eyeR * 0.2;
      ctx.fillStyle = '#1a1a2e';
      ctx.beginPath();
      ctx.arc(cx - eyeSpacing + pupilOffsetX, eyeY, pupilR, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + eyeSpacing + pupilOffsetX, eyeY, pupilR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Mouth
    const mouthY = cy + r * 0.25;
    const mouthWidth = r * 0.5;
    const mouthOpen = this.mouthOpenness * r * 0.35;

    ctx.fillStyle = 'white';
    if (mouthOpen > 1) {
      // Open mouth (speaking)
      ctx.beginPath();
      ctx.ellipse(cx, mouthY, mouthWidth, mouthOpen, 0, 0, Math.PI * 2);
      ctx.fill();
      // Dark inside
      if (mouthOpen > 3) {
        ctx.fillStyle = darken(this.color, 0.4);
        ctx.beginPath();
        ctx.ellipse(cx, mouthY, mouthWidth * 0.7, mouthOpen * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Closed mouth (smile)
      ctx.beginPath();
      ctx.arc(cx, mouthY - r * 0.05, mouthWidth, 0.1, Math.PI - 0.1);
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Action indicator (lightning bolt)
    if (this.state === 'acting') {
      ctx.font = `${s * 0.25}px serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fbbc04';
      ctx.fillText('⚡', cx + r * 0.8, cy - r * 0.6);
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.animFrame);
    this.analyser?.disconnect();
  }
}

function darken(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, (num >> 16) - Math.round(255 * amount));
  const g = Math.max(0, ((num >> 8) & 0xFF) - Math.round(255 * amount));
  const b = Math.max(0, (num & 0xFF) - Math.round(255 * amount));
  return `rgb(${r},${g},${b})`;
}
