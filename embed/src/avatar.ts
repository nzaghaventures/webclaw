/**
 * WebClaw Avatar - Character-based animated agent
 * Draws a teardrop/flame-shaped character with stick limbs,
 * expressive eyes, and lip-sync animation.
 * Inspired by the OpenClaw mascot design.
 * Uses Canvas 2D for lightweight, dependency-free animation.
 */

export type AvatarState = 'idle' | 'listening' | 'speaking' | 'thinking' | 'acting';

export interface AvatarOptions {
  bodyColor?: string;
  eyeColor?: string;
  limbColor?: string;
  showLimbs?: boolean;
  showSpeechBubble?: boolean;
  speechBubbleText?: string;
}

const DEFAULT_OPTIONS: AvatarOptions = {
  bodyColor: '#FF4D4D',
  eyeColor: '#1a1a2e',
  limbColor: '#3D2B1F',
  showLimbs: true,
  showSpeechBubble: false,
  speechBubbleText: '',
};

// Glow colors by state
const GLOW_COLORS: Record<AvatarState, string> = {
  idle: '#FF4D4D',
  listening: '#00E5CC',
  speaking: '#FF7A7A',
  thinking: '#FFB800',
  acting: '#FF6B35',
};

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
  private breatheScale: number = 1;
  private size: number;
  private opts: AvatarOptions;
  private lastFrameTime: number = performance.now();

  // Limb animation
  private armSwing: number = 0;
  private legSwing: number = 0;
  private wavePhase: number = 0;
  private isWaving: boolean = false;
  private waveTimer: number = 0;

  // Expression
  private eyebrowRaise: number = 0;
  private targetEyebrowRaise: number = 0;
  private pupilX: number = 0;
  private pupilY: number = 0;

  // Speech bubble
  private bubbleOpacity: number = 0;
  private targetBubbleOpacity: number = 0;

  // Audio analysis for lip sync
  private analyser: AnalyserNode | null = null;
  private analyserData: Uint8Array | null = null;

  constructor(canvas: HTMLCanvasElement, color: string = '#FF4D4D', size: number = 64, options?: Partial<AvatarOptions>) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.size = size;
    this.opts = { ...DEFAULT_OPTIONS, bodyColor: color, ...options };
    canvas.width = size;
    canvas.height = size;
    this.startAnimation();
  }

  setState(state: AvatarState): void {
    const prev = this.state;
    this.state = state;

    // Trigger wave on transition to idle from speaking
    if (state === 'idle' && prev === 'speaking' && !this.isWaving) {
      this.isWaving = true;
      this.waveTimer = 0;
    }

    // Eyebrow reactions
    if (state === 'listening') {
      this.targetEyebrowRaise = 0.3;
    } else if (state === 'thinking') {
      this.targetEyebrowRaise = 0.5;
    } else {
      this.targetEyebrowRaise = 0;
    }
  }

  setOptions(opts: Partial<AvatarOptions>): void {
    this.opts = { ...this.opts, ...opts };
  }

  showBubble(text: string): void {
    this.opts.speechBubbleText = text;
    this.opts.showSpeechBubble = true;
    this.targetBubbleOpacity = 1;
    // Auto-hide after 4 seconds
    setTimeout(() => this.hideBubble(), 4000);
  }

  hideBubble(): void {
    this.targetBubbleOpacity = 0;
    setTimeout(() => {
      if (this.bubbleOpacity < 0.05) {
        this.opts.showSpeechBubble = false;
      }
    }, 300);
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
      this.animFrame = requestAnimationFrame(animate);
      this.update();
      this.draw();
    };
    this.animFrame = requestAnimationFrame(animate);
  }

  private update(): void {
    const now = performance.now();
    const dt = (now - this.lastFrameTime) / 16.67;
    this.lastFrameTime = now;

    // Mouth smoothing
    const mouthSpeed = Math.pow(0.7, dt);
    this.mouthOpenness = this.mouthOpenness * mouthSpeed + this.targetMouthOpenness * (1 - mouthSpeed);

    // Audio-driven mouth
    if (this.analyser && this.analyserData && this.state === 'speaking') {
      this.analyser.getByteFrequencyData(this.analyserData as Uint8Array<ArrayBuffer>);
      let sum = 0;
      const count = Math.min(16, this.analyserData.length);
      for (let i = 0; i < count; i++) sum += this.analyserData[i];
      this.targetMouthOpenness = (sum / count / 255) * 1.5;
    }

    // Simulated mouth when speaking without analyser
    if (this.state === 'speaking' && !this.analyser) {
      this.targetMouthOpenness = 0.3 + Math.sin(now * 0.015) * 0.3 + Math.sin(now * 0.023) * 0.2;
    } else if (this.state !== 'speaking') {
      this.targetMouthOpenness = 0;
    }

    // Blinking
    this.eyeBlinkTimer++;
    if (!this.isBlinking && Math.random() < 0.005) {
      this.isBlinking = true;
      this.eyeBlinkTimer = 0;
    }
    if (this.isBlinking && this.eyeBlinkTimer > 8) {
      this.isBlinking = false;
    }

    // Pulse phase
    this.pulsePhase += 0.05 * dt;

    // Bounce
    if (this.state === 'speaking') {
      this.bounceY = Math.sin(now * 0.004) * 2;
    } else if (this.state === 'listening') {
      this.bounceY = Math.sin(now * 0.002) * 1.2;
    } else if (this.state === 'acting') {
      this.bounceY = Math.sin(now * 0.006) * 3;
    } else {
      this.bounceY *= 0.95;
    }

    // Breathing
    if (this.state === 'idle') {
      this.breatheScale = 1 + Math.sin(now * 0.0008) * 0.02;
    } else {
      this.breatheScale = 1;
    }

    // Arm swing
    if (this.state === 'speaking') {
      this.armSwing = Math.sin(now * 0.003) * 0.15;
    } else if (this.state === 'acting') {
      this.armSwing = Math.sin(now * 0.008) * 0.3;
    } else {
      this.armSwing *= 0.9;
    }

    // Leg swing
    if (this.state === 'acting') {
      this.legSwing = Math.sin(now * 0.006) * 0.2;
    } else {
      this.legSwing *= 0.9;
    }

    // Waving
    if (this.isWaving) {
      this.wavePhase += 0.15 * dt;
      this.waveTimer += dt;
      if (this.waveTimer > 40) {
        this.isWaving = false;
        this.wavePhase = 0;
      }
    }

    // Eyebrow smoothing
    this.eyebrowRaise += (this.targetEyebrowRaise - this.eyebrowRaise) * 0.1;

    // Pupil movement (look around gently)
    this.pupilX = Math.sin(now * 0.001) * 0.3;
    this.pupilY = Math.sin(now * 0.0007) * 0.15;

    // Bubble opacity
    this.bubbleOpacity += (this.targetBubbleOpacity - this.bubbleOpacity) * 0.15;
  }

  private draw(): void {
    const ctx = this.ctx;
    const s = this.size;
    ctx.clearRect(0, 0, s, s);

    // Draw circular background for chathead/FAB mode
    const bgGrad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    bgGrad.addColorStop(0, darken(this.opts.bodyColor!, 0.25));
    bgGrad.addColorStop(0.85, darken(this.opts.bodyColor!, 0.35));
    bgGrad.addColorStop(1, darken(this.opts.bodyColor!, 0.45));
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
    ctx.fillStyle = bgGrad;
    ctx.fill();

    const showLimbs = this.opts.showLimbs && s >= 80;

    // Layout: character occupies ~60% of canvas height for body, rest for limbs
    const bodyH = showLimbs ? s * 0.52 : s * 0.55;
    const bodyW = bodyH * 0.7;
    const bodyCX = s / 2;
    const bodyCY = showLimbs ? s * 0.38 : s * 0.48;
    const bodyTop = bodyCY - bodyH / 2 + this.bounceY;

    // Apply breathing scale
    ctx.save();
    ctx.translate(bodyCX, bodyCY + this.bounceY);
    ctx.scale(this.breatheScale, this.breatheScale);
    ctx.translate(-bodyCX, -(bodyCY + this.bounceY));

    // === Glow ring ===
    if (this.state !== 'idle') {
      const glowColor = GLOW_COLORS[this.state];
      const glowAlpha = 0.2 + Math.sin(this.pulsePhase) * 0.1;
      const glowR = Math.max(bodyW, bodyH) * 0.6 + 4 + Math.sin(this.pulsePhase) * 3;
      ctx.beginPath();
      ctx.arc(bodyCX, bodyCY + this.bounceY, glowR, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(glowColor, glowAlpha);
      ctx.fill();
    }

    // === Thinking spinner ===
    if (this.state === 'thinking') {
      ctx.save();
      ctx.translate(bodyCX, bodyCY + this.bounceY);
      ctx.rotate(this.pulsePhase * 2);
      const spinR = Math.max(bodyW, bodyH) * 0.6 + 6;
      ctx.beginPath();
      ctx.arc(0, 0, spinR, 0, Math.PI * 1.2);
      ctx.strokeStyle = GLOW_COLORS.thinking;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }

    // === Limbs (draw behind body) ===
    if (showLimbs) {
      this.drawLimbs(ctx, bodyCX, bodyCY + this.bounceY, bodyW, bodyH);
    }

    // === Body (teardrop/flame shape) ===
    this.drawBody(ctx, bodyCX, bodyCY + this.bounceY, bodyW, bodyH);

    // === Face ===
    this.drawFace(ctx, bodyCX, bodyCY + this.bounceY, bodyW, bodyH);

    ctx.restore();

    // === Speech bubble ===
    if (this.opts.showSpeechBubble && this.bubbleOpacity > 0.01 && s >= 100) {
      this.drawSpeechBubble(ctx, bodyCX, bodyTop - 8);
    }

    // === Action lightning ===
    if (this.state === 'acting') {
      ctx.font = `${s * 0.18}px serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#FFB800';
      ctx.fillText('⚡', bodyCX + bodyW * 0.6, bodyTop + 4);
    }
  }

  private drawBody(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number): void {
    const color = this.opts.bodyColor!;

    // Teardrop: rounded bottom, pointed top
    // Using bezier curves to create a teardrop/flame shape
    const top = cy - h * 0.5;
    const bottom = cy + h * 0.4;
    const peakY = top;
    const baseR = w * 0.48;

    ctx.beginPath();
    // Start from the peak (top point)
    ctx.moveTo(cx, peakY);

    // Right side curve (peak → right bulge → bottom)
    ctx.bezierCurveTo(
      cx + w * 0.12, top + h * 0.15,    // control 1: slight right near top
      cx + baseR + w * 0.08, cy - h * 0.05,  // control 2: widest point
      cx + baseR, bottom - h * 0.08       // end: right of bottom
    );

    // Bottom curve (right → center bottom → left)
    ctx.bezierCurveTo(
      cx + baseR * 0.8, bottom + h * 0.02,
      cx + baseR * 0.3, bottom + h * 0.05,
      cx, bottom + h * 0.03
    );
    ctx.bezierCurveTo(
      cx - baseR * 0.3, bottom + h * 0.05,
      cx - baseR * 0.8, bottom + h * 0.02,
      cx - baseR, bottom - h * 0.08
    );

    // Left side curve (bottom left → left bulge → peak)
    ctx.bezierCurveTo(
      cx - baseR - w * 0.08, cy - h * 0.05,
      cx - w * 0.12, top + h * 0.15,
      cx, peakY
    );

    ctx.closePath();

    // Gradient fill
    const grad = ctx.createLinearGradient(cx, peakY, cx, bottom);
    grad.addColorStop(0, lighten(color, 0.15));
    grad.addColorStop(0.5, color);
    grad.addColorStop(1, darken(color, 0.15));
    ctx.fillStyle = grad;
    ctx.fill();

    // Subtle highlight on upper-left
    ctx.save();
    ctx.clip();
    const hlGrad = ctx.createRadialGradient(
      cx - w * 0.15, cy - h * 0.2, 0,
      cx - w * 0.15, cy - h * 0.2, w * 0.5
    );
    hlGrad.addColorStop(0, 'rgba(255,255,255,0.25)');
    hlGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hlGrad;
    ctx.fillRect(cx - w, cy - h, w * 2, h * 2);
    ctx.restore();
  }

  private drawFace(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number): void {
    const faceY = cy + h * 0.02;

    // === Eyes ===
    const eyeSpacing = w * 0.22;
    const eyeY = faceY - h * 0.08;
    const eyeW = w * 0.13;
    const eyeH = this.isBlinking ? eyeW * 0.12 : eyeW * 0.95;

    // Eyebrows
    if (this.eyebrowRaise > 0.01) {
      const browY = eyeY - eyeH - w * 0.04;
      const browLen = eyeW * 1.3;
      ctx.strokeStyle = this.opts.eyeColor!;
      ctx.lineWidth = Math.max(1, w * 0.03);
      ctx.lineCap = 'round';

      // Left brow
      ctx.beginPath();
      ctx.moveTo(cx - eyeSpacing - browLen / 2, browY + this.eyebrowRaise * 2);
      ctx.lineTo(cx - eyeSpacing + browLen / 2, browY - this.eyebrowRaise * 3);
      ctx.stroke();

      // Right brow
      ctx.beginPath();
      ctx.moveTo(cx + eyeSpacing - browLen / 2, browY - this.eyebrowRaise * 3);
      ctx.lineTo(cx + eyeSpacing + browLen / 2, browY + this.eyebrowRaise * 2);
      ctx.stroke();
    }

    // Eye whites
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.ellipse(cx - eyeSpacing, eyeY, eyeW, eyeH, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + eyeSpacing, eyeY, eyeW, eyeH, 0, 0, Math.PI * 2);
    ctx.fill();

    // Pupils
    if (!this.isBlinking) {
      const pupilR = eyeW * 0.5;
      const px = this.pupilX * eyeW * 0.3;
      const py = this.pupilY * eyeH * 0.2;

      ctx.fillStyle = this.opts.eyeColor!;
      ctx.beginPath();
      ctx.arc(cx - eyeSpacing + px, eyeY + py, pupilR, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + eyeSpacing + px, eyeY + py, pupilR, 0, Math.PI * 2);
      ctx.fill();

      // Eye shine
      const shineR = pupilR * 0.35;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.arc(cx - eyeSpacing + px + pupilR * 0.25, eyeY + py - pupilR * 0.25, shineR, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + eyeSpacing + px + pupilR * 0.25, eyeY + py - pupilR * 0.25, shineR, 0, Math.PI * 2);
      ctx.fill();
    }

    // === Mouth ===
    const mouthY = faceY + h * 0.12;
    const mouthW = w * 0.2;
    const mouthOpen = this.mouthOpenness * h * 0.12;

    if (mouthOpen > 1) {
      // Open mouth
      ctx.fillStyle = darken(this.opts.bodyColor!, 0.35);
      ctx.beginPath();
      ctx.ellipse(cx, mouthY, mouthW, Math.max(mouthOpen, 2), 0, 0, Math.PI * 2);
      ctx.fill();

      // Tongue hint
      if (mouthOpen > 4) {
        ctx.fillStyle = '#E57373';
        ctx.beginPath();
        ctx.ellipse(cx, mouthY + mouthOpen * 0.3, mouthW * 0.5, mouthOpen * 0.3, 0, 0, Math.PI);
        ctx.fill();
      }
    } else {
      // Smile
      ctx.beginPath();
      ctx.arc(cx, mouthY - h * 0.02, mouthW, 0.15, Math.PI - 0.15);
      ctx.strokeStyle = darken(this.opts.bodyColor!, 0.3);
      ctx.lineWidth = Math.max(1.5, w * 0.03);
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Cheek blush (when speaking or listening)
    if (this.state === 'speaking' || this.state === 'listening') {
      const blushAlpha = 0.15 + Math.sin(this.pulsePhase * 0.5) * 0.05;
      ctx.fillStyle = `rgba(255,150,150,${blushAlpha})`;
      const blushR = w * 0.1;
      ctx.beginPath();
      ctx.ellipse(cx - eyeSpacing - w * 0.06, mouthY - h * 0.02, blushR, blushR * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + eyeSpacing + w * 0.06, mouthY - h * 0.02, blushR, blushR * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawLimbs(ctx: CanvasRenderingContext2D, cx: number, cy: number, bw: number, bh: number): void {
    const limbColor = this.opts.limbColor!;
    const lw = Math.max(1.5, bw * 0.06);
    ctx.strokeStyle = limbColor;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const bodyBottom = cy + bh * 0.35;
    const bodyLeft = cx - bw * 0.42;
    const bodyRight = cx + bw * 0.42;
    const armY = cy + bh * 0.05;

    // === Left arm ===
    ctx.beginPath();
    ctx.moveTo(bodyLeft, armY);
    if (this.isWaving) {
      // Waving animation
      const wave = Math.sin(this.wavePhase) * 0.4;
      const handX = bodyLeft - bw * 0.35;
      const handY = armY - bh * 0.3 + wave * bh * 0.15;
      ctx.quadraticCurveTo(bodyLeft - bw * 0.2, armY - bh * 0.1, handX, handY);
      // Hand
      ctx.moveTo(handX - lw * 1.5, handY - lw);
      ctx.lineTo(handX + lw * 1.5, handY + lw);
    } else {
      const swing = this.armSwing;
      const elbowX = bodyLeft - bw * 0.2;
      const elbowY = armY + bh * 0.15 + swing * bh * 0.1;
      const handX = elbowX - bw * 0.05;
      const handY = elbowY + bh * 0.12;
      ctx.quadraticCurveTo(elbowX, elbowY, handX, handY);
    }
    ctx.stroke();

    // === Right arm ===
    ctx.beginPath();
    ctx.moveTo(bodyRight, armY);
    const rSwing = -this.armSwing;
    // "Hand on hip" pose from the screenshot
    const rElbowX = bodyRight + bw * 0.25;
    const rElbowY = armY + bh * 0.08 + rSwing * bh * 0.1;
    const rHandX = bodyRight + bw * 0.12;
    const rHandY = bodyBottom - bh * 0.05;
    ctx.quadraticCurveTo(rElbowX, rElbowY, rHandX, rHandY);
    ctx.stroke();

    // === Legs ===
    const legOriginY = bodyBottom + bh * 0.02;
    const legLen = bh * 0.28;

    // Left leg
    ctx.beginPath();
    const lLegX = cx - bw * 0.15;
    const lFootX = lLegX - bw * 0.08 + this.legSwing * bw * 0.15;
    const lFootY = legOriginY + legLen;
    ctx.moveTo(lLegX, legOriginY);
    ctx.quadraticCurveTo(lLegX - bw * 0.03, legOriginY + legLen * 0.5, lFootX, lFootY);
    // Foot
    ctx.lineTo(lFootX + bw * 0.1, lFootY);
    ctx.stroke();

    // Right leg
    ctx.beginPath();
    const rLegX = cx + bw * 0.15;
    const rFootX = rLegX + bw * 0.08 - this.legSwing * bw * 0.15;
    const rFootY = legOriginY + legLen;
    ctx.moveTo(rLegX, legOriginY);
    ctx.quadraticCurveTo(rLegX + bw * 0.03, legOriginY + legLen * 0.5, rFootX, rFootY);
    // Foot
    ctx.lineTo(rFootX - bw * 0.1, rFootY);
    ctx.stroke();
  }

  private drawSpeechBubble(ctx: CanvasRenderingContext2D, cx: number, topY: number): void {
    const text = this.opts.speechBubbleText || '';
    if (!text) return;

    const fontSize = Math.max(10, this.size * 0.1);
    ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    const metrics = ctx.measureText(text);
    const textW = metrics.width;
    const padX = fontSize * 0.6;
    const padY = fontSize * 0.4;
    const bubbleW = textW + padX * 2;
    const bubbleH = fontSize + padY * 2;
    const bubbleX = cx - bubbleW / 2;
    const bubbleY = topY - bubbleH - 8;
    const tailSize = 6;

    ctx.globalAlpha = this.bubbleOpacity;

    // Bubble background
    ctx.fillStyle = 'white';
    ctx.shadowColor = 'rgba(0,0,0,0.12)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    roundRect(ctx, bubbleX, bubbleY, bubbleW, bubbleH, 8);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    // Tail
    ctx.beginPath();
    ctx.moveTo(cx - tailSize, bubbleY + bubbleH);
    ctx.lineTo(cx, bubbleY + bubbleH + tailSize);
    ctx.lineTo(cx + tailSize, bubbleY + bubbleH);
    ctx.closePath();
    ctx.fill();

    // Text
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, bubbleY + bubbleH / 2);

    ctx.globalAlpha = 1;
  }

  destroy(): void {
    cancelAnimationFrame(this.animFrame);
    this.analyser?.disconnect();
  }

  dispose(): void {
    this.destroy();
  }
}

// === Utility functions ===

function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.max(0, r - Math.round(255 * amount))},${Math.max(0, g - Math.round(255 * amount))},${Math.max(0, b - Math.round(255 * amount))})`;
}

function lighten(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.min(255, r + Math.round(255 * amount))},${Math.min(255, g + Math.round(255 * amount))},${Math.min(255, b + Math.round(255 * amount))})`;
}

function hexToRgb(hex: string): [number, number, number] {
  const num = parseInt(hex.replace('#', ''), 16);
  return [(num >> 16) & 0xFF, (num >> 8) & 0xFF, num & 0xFF];
}

function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
