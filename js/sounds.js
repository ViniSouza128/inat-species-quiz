// =============================================================================
// SOUNDS — efeitos sonoros sintetizados via Web Audio API
// =============================================================================
// Porte fiel de client/src/utils/soundEffects.ts. Sintetiza cada efeito
// em runtime para evitar assets externos.
//
// Pipeline:
//   Oscillator/Buffer → BiquadFilter → GainNode (envelope) →
//                       MasterGain → DynamicsCompressor → destination
// =============================================================================

let ctx = null;
let enabled = true;
let masterGain = null;
let compressor = null;
// Volume linear (0..1) controlado pelo slider em Configurações. Multiplica
// o ganho base do masterGain. `setUiVolume` também desativa `enabled`
// quando o volume cai para 0 (mudo).
let uiVolume = 0.6;
const MASTER_BASE_GAIN = 0.62;

/** Cria/retoma o AudioContext. Compatível com Safari (webkitAudioContext). */
function getContext() {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => undefined);
  }
  return ctx;
}

/** Cadeia de saída lazy: master → compressor → destination. */
function getOutput(audio) {
  if (!masterGain) {
    masterGain = audio.createGain();
    masterGain.gain.value = MASTER_BASE_GAIN * uiVolume;
  }
  if (!compressor) {
    compressor = audio.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 18;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.16;
    masterGain.connect(compressor);
    compressor.connect(audio.destination);
  }
  return masterGain;
}

/** Envelope ADSR-light. Attack curto, hold breve, release exponencial. */
function envelope(gain, audio, at, duration, peak) {
  const attack = Math.min(0.018, duration * 0.22);
  const hold = Math.min(0.035, duration * 0.22);
  const releaseStart = at + attack + hold;
  const end = at + duration;
  gain.gain.cancelScheduledValues(at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(peak, at + attack);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.42), Math.min(end - 0.012, releaseStart));
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
}

function playTone(audio, output, start, event) {
  const osc = audio.createOscillator();
  const filter = audio.createBiquadFilter();
  const gain = audio.createGain();
  const at = start + event.at;
  const duration = Math.max(0.018, event.duration);
  const end = at + duration;

  osc.type = event.type ?? 'sine';
  osc.frequency.setValueAtTime(event.freq, at);
  if (event.slideTo) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, event.slideTo), end);
  }
  if (typeof event.detuneTo === 'number') {
    osc.detune.setValueAtTime(0, at);
    osc.detune.linearRampToValueAtTime(event.detuneTo, end);
  }
  filter.type = event.filterType ?? 'lowpass';
  filter.frequency.setValueAtTime(event.filterFreq ?? 4200, at);
  filter.Q.value = event.q ?? 0.7;

  envelope(gain, audio, at, duration, event.gain);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(output);
  osc.start(at);
  osc.stop(end + 0.025);
}

function playNoise(audio, output, start, event) {
  const sampleCount = Math.max(1, Math.floor(audio.sampleRate * event.duration));
  const buffer = audio.createBuffer(1, sampleCount, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < sampleCount; i += 1) {
    const fade = 1 - i / sampleCount;
    data[i] = (Math.random() * 2 - 1) * fade;
  }
  const source = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const gain = audio.createGain();
  const at = start + event.at;
  const duration = Math.max(0.012, event.duration);

  source.buffer = buffer;
  filter.type = event.filterType ?? 'bandpass';
  filter.frequency.setValueAtTime(event.filterFreq, at);
  filter.Q.value = event.q ?? 6;
  envelope(gain, audio, at, duration, event.gain);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(output);
  source.start(at);
  source.stop(at + duration + 0.025);
}

function playSequence(sequence) {
  if (!enabled) return;
  const audio = getContext();
  if (!audio) return;
  const output = getOutput(audio);
  const start = audio.currentTime + 0.012;
  for (const event of sequence) {
    if (event.kind === 'noise') playNoise(audio, output, start, event);
    else playTone(audio, output, start, event);
  }
}

/** Mapa de cada efeito → sequência de events. */
function soundMap(kind) {
  switch (kind) {
    case 'correct':
      return [
        { at: 0, freq: 523.25, duration: 0.12, gain: 0.038, type: 'triangle', filterFreq: 3600 },
        { at: 0.055, freq: 659.25, duration: 0.15, gain: 0.034, type: 'triangle', filterFreq: 4300 },
        { at: 0.12, freq: 783.99, duration: 0.18, gain: 0.036, type: 'sine', filterFreq: 4800 },
        { at: 0.17, freq: 1174.66, duration: 0.22, gain: 0.015, type: 'sine', filterFreq: 5600 }
      ];
    case 'wrong':
      return [
        { kind: 'noise', at: 0, duration: 0.045, gain: 0.018, filterFreq: 520, filterType: 'bandpass', q: 8 },
        { at: 0.015, freq: 246.94, slideTo: 185, duration: 0.16, gain: 0.036, type: 'triangle', filterFreq: 1900 },
        { at: 0.11, freq: 164.81, duration: 0.15, gain: 0.028, type: 'sine', filterFreq: 1300 }
      ];
    case 'advance':
      return [
        { kind: 'noise', at: 0, duration: 0.026, gain: 0.009, filterFreq: 1800, filterType: 'bandpass', q: 7 },
        { at: 0.018, freq: 392, slideTo: 587.33, duration: 0.11, gain: 0.024, type: 'triangle', filterFreq: 3600 }
      ];
    case 'hint':
      return [
        { at: 0, freq: 783.99, duration: 0.08, gain: 0.021, type: 'sine', filterFreq: 5200 },
        { at: 0.052, freq: 987.77, duration: 0.12, gain: 0.019, type: 'triangle', filterFreq: 5400 },
        { at: 0.12, freq: 1318.51, duration: 0.18, gain: 0.012, type: 'sine', filterFreq: 6200 }
      ];
    case 'timeout':
      return [
        { kind: 'noise', at: 0, duration: 0.05, gain: 0.018, filterFreq: 420, filterType: 'bandpass', q: 6 },
        { at: 0, freq: 293.66, slideTo: 220, duration: 0.16, gain: 0.034, type: 'triangle', filterFreq: 1600 },
        { at: 0.135, freq: 220, slideTo: 146.83, duration: 0.23, gain: 0.032, type: 'triangle', filterFreq: 1200 }
      ];
    case 'timerWarning':
      return [
        { kind: 'noise', at: 0, duration: 0.018, gain: 0.011, filterFreq: 2450, filterType: 'bandpass', q: 10 },
        { at: 0.005, freq: 880, duration: 0.055, gain: 0.017, type: 'sine', filterFreq: 3600 },
        { at: 0.072, freq: 880, duration: 0.05, gain: 0.013, type: 'sine', filterFreq: 3600 }
      ];
    case 'timerFinal':
      return [
        { kind: 'noise', at: 0, duration: 0.022, gain: 0.014, filterFreq: 2850, filterType: 'bandpass', q: 10 },
        { at: 0.004, freq: 1046.5, duration: 0.09, gain: 0.021, type: 'sine', filterFreq: 4200 },
        { at: 0.105, freq: 784, duration: 0.08, gain: 0.015, type: 'triangle', filterFreq: 3400 }
      ];
    case 'tap':
      // Click curtíssimo e suave (~30ms) — feedback para qualquer botão.
      return [
        { at: 0, freq: 880, duration: 0.035, gain: 0.012, type: 'triangle', filterFreq: 3800 }
      ];
    case 'volumeSample':
      // Tom de referência (A4) para o slider de volume sentir o nível.
      return [
        { at: 0, freq: 440, duration: 0.18, gain: 0.052, type: 'sine', filterFreq: 3200 }
      ];
    default:
      return [];
  }
}

function vibrateForSound(kind) {
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  if (kind === 'correct') navigator.vibrate(18);
  if (kind === 'wrong' || kind === 'timeout') navigator.vibrate([24, 28, 24]);
  if (kind === 'timerFinal') navigator.vibrate(16);
}

export function setUiSoundEnabled(next) {
  enabled = Boolean(next);
}

/** Ajusta o volume global da UI (0..100). 0 = mudo. Atualiza imediatamente
 *  o masterGain.gain se o contexto já existir. */
export function setUiVolume(volume0to100) {
  const clamped = Math.max(0, Math.min(100, Number(volume0to100) || 0));
  uiVolume = clamped / 100;
  enabled = clamped > 0;
  if (masterGain) {
    masterGain.gain.value = MASTER_BASE_GAIN * uiVolume;
  }
}

/** Aquece o AudioContext (precisa ser chamado em resposta a interação). */
export function primeUiAudio() {
  void getContext();
}

/** Toca um som da UI + dispara vibração se aplicável. */
export function playUiSound(kind) {
  vibrateForSound(kind);
  playSequence(soundMap(kind));
}
