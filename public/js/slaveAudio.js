/* Slave's sounds are synthesized locally: no downloads, autoplay dependency or shared game music. */
(function (global) {
  'use strict';
  const read = key => { try { return localStorage.getItem(key) !== 'off'; } catch (_) { return true; } };
  const save = (key, value) => { try { localStorage.setItem(key, value ? 'on' : 'off'); } catch (_) {} };
  class SlaveAudio {
    constructor(onChange) {
      this.enabled = read('slaveSound');
      this.music = read('slaveMusic');
      this.onChange = onChange;
      this.context = null;
      this.pendingTurn = null;
      this.turnKey = null;
      this.pendingDeal = true;
      this.unlocked = false;
      this.timer = null;
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.stopMusic();
          if (this.context?.state === 'running') this.context.suspend().catch(() => {});
        } else if (this.unlocked && this.enabled) this.unlock();
      });
      global.addEventListener('pagehide', () => this.stopMusic());
    }
    get ready() { return this.enabled && this.context?.state === 'running'; }
    async unlock() {
      if (!this.enabled || document.hidden) return false;
      try {
        if (!this.context) {
          const Context = global.AudioContext || global.webkitAudioContext;
          if (!Context) throw new Error('Web Audio unavailable');
          this.context = new Context();
          this.master = this.context.createGain();
          this.master.gain.value = .65;
          this.master.connect(this.context.destination);
          this.musicGain = this.context.createGain();
          this.musicGain.gain.value = this.music ? .28 : 0;
          this.musicGain.connect(this.master);
          const length = this.context.sampleRate * .15;
          this.noise = this.context.createBuffer(1, length, this.context.sampleRate);
          const samples = this.noise.getChannelData(0);
          for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
          this.context.onstatechange = () => this.onChange?.();
        }
        if (this.context.state !== 'running') await this.context.resume();
        this.unlocked = this.ready;
        if (!this.ready) return false;
        // A turn received before the first gesture must still be heard after unlock.
        if (this.pendingDeal) { this.pendingDeal = false; this.cue('deal'); }
        if (this.pendingTurn) { this.pendingTurn = null; this.cue('turn'); }
        this.startMusic();
        this.onChange?.();
        return true;
      } catch (_) {
        this.onChange?.();
        return false;
      }
    }
    setEnabled(value) {
      this.enabled = value;
      save('slaveSound', value);
      if (this.master) this.master.gain.setTargetAtTime(value ? .65 : 0, this.context.currentTime, .015);
      if (!value) this.stopMusic();
      this.onChange?.();
    }
    setMusic(value) {
      this.music = value;
      save('slaveMusic', value);
      if (this.musicGain) this.musicGain.gain.setTargetAtTime(value ? .28 : 0, this.context.currentTime, .04);
      if (value) this.startMusic(); else this.stopMusic();
      this.onChange?.();
    }
    turn(active, key) {
      if (!active) { this.pendingTurn = null; this.turnKey = null; return; }
      if (this.turnKey === key) return;
      this.turnKey = key;
      this.pendingTurn = key;
      if (this.ready) { this.pendingTurn = null; this.cue('turn'); }
    }
    tone(frequency, delay, duration, volume, type = 'sine', bus) {
      const ctx = this.context, at = ctx.currentTime + delay;
      const oscillator = ctx.createOscillator(), gain = ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(.0001, at);
      gain.gain.exponentialRampToValueAtTime(volume, at + .012);
      gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
      oscillator.connect(gain);
      gain.connect(bus || this.master);
      oscillator.start(at);
      oscillator.stop(at + duration + .02);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }
    paper(delay = 0, volume = .18) {
      const ctx = this.context, at = ctx.currentTime + delay;
      const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
      source.buffer = this.noise;
      filter.type = 'bandpass'; filter.frequency.value = 1700; filter.Q.value = .7;
      gain.gain.setValueAtTime(volume, at);
      gain.gain.exponentialRampToValueAtTime(.0001, at + .12);
      source.connect(filter); filter.connect(gain); gain.connect(this.master);
      source.start(at); source.stop(at + .13);
      source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    }
    cue(name) {
      if (!this.ready || document.hidden) return;
      switch (name) {
        case 'deal': for (let i = 0; i < 5; i++) this.paper(i * .065, .15); break;
        case 'select': this.tone(760, 0, .045, .07, 'triangle'); break;
        case 'play': this.paper(); this.tone(155, 0, .12, .18, 'triangle'); break;
        case 'pass': this.tone(260, 0, .12, .09); this.tone(196, .07, .13, .07); break;
        case 'clear': this.paper(0, .1); this.paper(.07, .07); break;
        case 'turn': this.tone(659.25, .08, .25, .19); this.tone(987.77, .22, .4, .16); break;
        case 'warning': this.tone(523.25, 0, .09, .1); break;
        case 'exchange': this.paper(); this.paper(.12); this.tone(523.25, .18, .3, .12); break;
        case 'win': [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, i * .1, .6, .16)); break;
        case 'end': [392, 523.25, 659.25].forEach((f, i) => this.tone(f, i * .12, .45, .12)); break;
        case 'preview': this.tone(523.25, 0, .16, .15); this.tone(783.99, .12, .25, .15); break;
      }
    }
    startMusic() {
      if (!this.ready || !this.music || document.hidden || this.timer) return;
      this.note = 0; this.nextNote = this.context.currentTime + .4;
      const pattern = [130.81, 261.63, 329.63, 392, 110, 220, 261.63, 329.63, 87.31, 174.61, 261.63, 349.23, 98, 196, 293.66, 392];
      const schedule = () => {
        if (!this.ready || document.hidden) return;
        // Start fresh after a backgrounded tab instead of scheduling a burst of missed notes.
        if (this.nextNote < this.context.currentTime) this.nextNote = this.context.currentTime + .05;
        while (this.nextNote < this.context.currentTime + .3) {
          this.tone(pattern[this.note++ % pattern.length], this.nextNote - this.context.currentTime, .65, .12, 'triangle', this.musicGain);
          this.nextNote += .43;
        }
      };
      schedule(); this.timer = setInterval(schedule, 150);
    }
    stopMusic() { clearInterval(this.timer); this.timer = null; }
  }
  global.SlaveAudio = SlaveAudio;
})(window);
