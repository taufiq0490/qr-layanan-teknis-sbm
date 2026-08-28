/**
 * Audio Notifier Engine - SBM ITB Layanan Teknis
 * Menggunakan Web Audio API native (100% andal tanpa file eksternal)
 */

class SoundNotifierEngine {
  constructor() {
    this.audioCtx = null;
    this.soundType = localStorage.getItem('sbm_sound_type') || 'dingdong';
    this.volume = parseFloat(localStorage.getItem('sbm_sound_volume') || '0.8');
    this.isMuted = localStorage.getItem('sbm_sound_muted') === 'true';
    this.loopEnabled = localStorage.getItem('sbm_sound_loop') === 'true';
    this.loopIntervalId = null;
    this.isLooping = false;
    this.isSpeechEnabled = localStorage.getItem('sbm_speech_enabled') !== 'false';

    // Desktop notification tracking
    this.originalTitle = document.title;
    this.titleBlinkInterval = null;
    this.swRegistration = null;

    // Inisialisasi Service Worker untuk background Web Desktop Notifications
    this.initServiceWorker();

    // Setup auto-unlock on first user interaction
    this.initAutoUnlock();
  }

  // Inisialisasi Service Worker
  initServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => {
          this.swRegistration = reg;
        })
        .catch((err) => {
          console.warn('Service worker registration note:', err);
        });
    }
  }

  // Inisialisasi AudioContext dengan aman
  getAudioContext() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().then(() => {
        this.isAudioUnlocked = true;
        this.updateUnlockBannerUI(false);
      }).catch(() => {});
    } else if (this.audioCtx && this.audioCtx.state === 'running') {
      this.isAudioUnlocked = true;
    }
    return this.audioCtx;
  }

  // Explicit user-gesture unlock
  async unlockAudio() {
    try {
      const ctx = this.getAudioContext();
      if (ctx) {
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
        // Warm up audio buffer with silent oscillator
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.05);

        this.isAudioUnlocked = (ctx.state === 'running');
        this.updateUnlockBannerUI(!this.isAudioUnlocked);
        return this.isAudioUnlocked;
      }
    } catch (e) {
      console.warn('Audio unlock error:', e);
    }
    return false;
  }

  // Listener untuk membuka kunci browser autoplay policy pada interaksi pertama
  initAutoUnlock() {
    const unlock = () => {
      this.unlockAudio();
    };

    ['click', 'touchstart', 'keydown', 'pointerdown'].forEach(evt => {
      document.addEventListener(evt, unlock, { passive: true, once: false });
    });
  }

  // Helper untuk pengumuman suara bahasa Indonesia
  speakAnnouncement(text) {
    if (this.isMuted || !this.isSpeechEnabled) return;
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel(); // Batalkan antrean ucapan lama
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'id-ID';
        utterance.rate = 1.05;
        utterance.pitch = 1.0;
        utterance.volume = Math.min(1.0, this.volume * 1.2);
        window.speechSynthesis.speak(utterance);
      } catch (e) {
        console.warn('Speech synthesis error:', e);
      }
    }
  }

  // Helper untuk membuat Master Gain dengan kontrol volume
  createMasterGain(ctx) {
    const masterGain = ctx.createGain();
    const effectiveVolume = this.isMuted ? 0 : this.volume;
    masterGain.gain.setValueAtTime(effectiveVolume, ctx.currentTime);
    masterGain.connect(ctx.destination);
    return masterGain;
  }

  /* ==========================================================
     SYNTHESIZER NADA NOTIFIKASI
     ========================================================== */

  // 1. Ding Dong Ruang Kelas (G5 -> E5 chime dengan resonansi bel merdu)
  playDingDong(ctx, masterGain) {
    const now = ctx.currentTime;

    // Nada Pertama: G5 (783.99 Hz)
    const osc1 = ctx.createOscillator();
    const osc1Harmonic = ctx.createOscillator();
    const gain1 = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(783.99, now);
    osc1Harmonic.type = 'triangle';
    osc1Harmonic.frequency.setValueAtTime(783.99 * 2, now); // Overtone

    gain1.gain.setValueAtTime(0.7, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.9);

    osc1.connect(gain1);
    osc1Harmonic.connect(gain1);
    gain1.connect(masterGain);

    osc1.start(now);
    osc1Harmonic.start(now);
    osc1.stop(now + 0.9);
    osc1Harmonic.stop(now + 0.9);

    // Nada Kedua: E5 (659.25 Hz) berdentang setelah 0.35 detik
    const osc2 = ctx.createOscillator();
    const osc2Harmonic = ctx.createOscillator();
    const gain2 = ctx.createGain();

    const t2 = now + 0.35;
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(659.25, t2);
    osc2Harmonic.type = 'triangle';
    osc2Harmonic.frequency.setValueAtTime(659.25 * 2, t2);

    gain2.gain.setValueAtTime(0, now);
    gain2.gain.setValueAtTime(0.8, t2);
    gain2.gain.exponentialRampToValueAtTime(0.001, t2 + 1.4);

    osc2.connect(gain2);
    osc2Harmonic.connect(gain2);
    gain2.connect(masterGain);

    osc2.start(t2);
    osc2Harmonic.start(t2);
    osc2.stop(t2 + 1.4);
    osc2Harmonic.stop(t2 + 1.4);
  }

  // 2. Sirene Tanggap Cepat / Emergency (Alternating Dual Pitch 3x Pulse)
  playEmergencySiren(ctx, masterGain) {
    const now = ctx.currentTime;
    const tones = [
      { freq: 880, start: 0.0, dur: 0.18 },
      { freq: 659, start: 0.18, dur: 0.18 },
      { freq: 880, start: 0.36, dur: 0.18 },
      { freq: 659, start: 0.54, dur: 0.18 },
      { freq: 988, start: 0.72, dur: 0.35 }
    ];

    tones.forEach(t => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(t.freq, now + t.start);

      // Low pass filter untuk menghaluskan nada sawtooth agar tidak menusuk telinga
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2200, now + t.start);

      gain.gain.setValueAtTime(0, now);
      gain.gain.setValueAtTime(0.45, now + t.start);
      gain.gain.exponentialRampToValueAtTime(0.01, now + t.start + t.dur);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);

      osc.start(now + t.start);
      osc.stop(now + t.start + t.dur);
    });
  }

  // 3. Melodi Marimba Modern (C5 -> E5 -> G5 -> C6)
  playMarimba(ctx, masterGain) {
    const now = ctx.currentTime;
    const notes = [
      { freq: 523.25, time: 0.00 }, // C5
      { freq: 659.25, time: 0.12 }, // E5
      { freq: 783.99, time: 0.24 }, // G5
      { freq: 1046.50, time: 0.36 } // C6
    ];

    notes.forEach((n, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = now + n.time;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(n.freq, t);

      // Tambahkan vibrato / warm resonance
      const decay = idx === notes.length - 1 ? 0.9 : 0.4;
      gain.gain.setValueAtTime(0, now);
      gain.gain.setValueAtTime(0.6, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + decay);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(t);
      osc.stop(t + decay);
    });
  }

  // 4. Bel Elektronik / Digital Intercom (Dua nada tinggi jernih)
  playElectronic(ctx, masterGain) {
    const now = ctx.currentTime;
    const beeps = [
      { freq: 1046.5, start: 0.0, dur: 0.15 },
      { freq: 1318.5, start: 0.15, dur: 0.35 }
    ];

    beeps.forEach(b => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = now + b.start;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(b.freq, t);

      gain.gain.setValueAtTime(0.55, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + b.dur);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(t);
      osc.stop(t + b.dur);
    });
  }

  // 5. Radar Ping / Akustik Perhatian
  playRadar(ctx, masterGain) {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.exponentialRampToValueAtTime(1174.66, now + 0.1); // Sweep ke D6

    gain.gain.setValueAtTime(0.65, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(now);
    osc.stop(now + 1.2);
  }

  /* ==========================================================
     NADA TAMBAHAN UNTUK CALLER & PROSES TIKET
     ========================================================== */

  // Nada Konfirmasi Panggilan Terkirim (Ruang Pemanggil)
  playCallSentSound() {
    if (this.isMuted) return;
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const master = this.createMasterGain(ctx);
      const now = ctx.currentTime;

      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t = now + (i * 0.1);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.4, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t);
        osc.stop(t + 0.35);
      });
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  }

  // Nada Notifikasi Staf Meluncur / Diproses
  playStaffDispatchedSound() {
    if (this.isMuted) return;
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const master = this.createMasterGain(ctx);
      const now = ctx.currentTime;

      [659.25, 880].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t = now + (i * 0.16);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.5, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t);
        osc.stop(t + 0.6);
      });
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  }

  // Nada Selesai Ditangani
  playCompletedSound() {
    if (this.isMuted) return;
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const master = this.createMasterGain(ctx);
      const now = ctx.currentTime;

      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t = now + (i * 0.12);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.4, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t);
        osc.stop(t + 0.5);
      });
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  }

  /* ==========================================================
     TRIGGER PANGGILAN MASUK (ADMIN & DASHBOARD)
     ========================================================== */

  // Memutar nada terpilih saat ada tiket baru
  playIncomingCallSound(customType = null) {
    if (this.isMuted) return;
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        this.updateUnlockBannerUI(true);
        ctx.resume().then(() => {
          this._executePlaySound(ctx, customType);
        }).catch(() => {});
      } else {
        this._executePlaySound(ctx, customType);
      }
    } catch (e) {
      console.warn('Gagal memutar audio notifikasi:', e);
    }
  }

  _executePlaySound(ctx, customType) {
    if (this.isMuted) return;
    try {
      const master = this.createMasterGain(ctx);
      const type = customType || this.soundType;

      switch (type) {
        case 'emergency':
          this.playEmergencySiren(ctx, master);
          break;
        case 'marimba':
          this.playMarimba(ctx, master);
          break;
        case 'electronic':
          this.playElectronic(ctx, master);
          break;
        case 'radar':
          this.playRadar(ctx, master);
          break;
        case 'dingdong':
        default:
          this.playDingDong(ctx, master);
          break;
      }
    } catch (e) {
      console.warn('Playback error:', e);
    }
  }

  // Mulai Alarm Berulang (Jika loopEnabled aktif dan ada panggilan belum ditangani)
  startContinuousAlert(ticketCount = 1) {
    if (!this.loopEnabled || this.isMuted) return;
    if (this.isLooping) return;

    this.isLooping = true;
    this.playIncomingCallSound();

    this.loopIntervalId = setInterval(() => {
      if (this.isLooping && !this.isMuted) {
        this.playIncomingCallSound();
      }
    }, 4500); // Putar setiap 4.5 detik
  }

  // Hentikan Alarm Berulang
  stopContinuousAlert() {
    this.isLooping = false;
    if (this.loopIntervalId) {
      clearInterval(this.loopIntervalId);
      this.loopIntervalId = null;
    }
    this.stopTitleBlink();
  }

  /* ==========================================================
     NOTIFIKASI DESKTOP & JUDUL TAB BERKEDIP
     ========================================================== */

  // Cek Status Izin Notifikasi Desktop
  getNotificationPermissionStatus() {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission; // 'granted', 'denied', or 'default'
  }

  // Minta Izin Notifikasi Desktop (Kompatibel dengan semua browser modern & lawas)
  async requestNotificationPermission() {
    if (!('Notification' in window)) {
      alert('Browser Anda tidak mendukung Web Desktop Notification.');
      return false;
    }
    if (Notification.permission === 'granted') {
      return true;
    }
    if (Notification.permission === 'denied') {
      return false;
    }

    try {
      let result;
      // Mendukung Promise dan Callback versi Safari / WebKit lama
      const permissionPromise = Notification.requestPermission((status) => {
        if (status) result = status;
      });
      if (permissionPromise && typeof permissionPromise.then === 'function') {
        result = await permissionPromise;
      }
      return result === 'granted' || Notification.permission === 'granted';
    } catch (e) {
      console.warn('requestPermission error:', e);
      return Notification.permission === 'granted';
    }
  }

  // Tampilkan Notifikasi Desktop Browser / Windows Action Center
  async showDesktopNotification(title, body, customOptions = {}) {
    if (!('Notification' in window)) return;

    // Jika status masih default dan user sedang berinteraksi, minta izin secara otomatis
    if (Notification.permission === 'default') {
      try {
        await this.requestNotificationPermission();
      } catch (e) {}
    }

    if (Notification.permission !== 'granted') {
      return;
    }

    const iconUrl = window.location.origin + '/images/logo-sbm-itb.png';
    const notifOptions = {
      body: body || '',
      icon: iconUrl,
      badge: iconUrl,
      tag: customOptions.tag || 'sbm-ticket-alert',
      renotify: true,
      requireInteraction: true, // Notifikasi tetap ada di layar sampai staf merespons
      silent: false,
      vibrate: [300, 100, 300, 100, 300],
      data: {
        url: window.location.origin + '/admin',
        timestamp: Date.now(),
        ...(customOptions.data || {})
      },
      ...customOptions
    };

    // 1. Prioritaskan Service Worker showNotification (Paling andal di background OS Windows)
    try {
      if (this.swRegistration && this.swRegistration.showNotification) {
        await this.swRegistration.showNotification(title, notifOptions);
        return;
      } else if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        const reg = await navigator.serviceWorker.ready;
        if (reg && reg.showNotification) {
          await reg.showNotification(title, notifOptions);
          return;
        }
      }
    } catch (swErr) {
      console.warn('SW notification fallback note:', swErr);
    }

    // 2. Fallback ke standard Notification constructor
    try {
      const notif = new Notification(title, notifOptions);
      notif.onclick = (event) => {
        event.preventDefault();
        window.focus();
        if (window.parent) window.parent.focus();
        notif.close();
      };
    } catch (e) {
      console.warn('Desktop notification error:', e);
    }
  }

  // Uji Coba Notifikasi Desktop OS Langsung
  async testDesktopNotification() {
    const status = this.getNotificationPermissionStatus();
    if (status === 'unsupported') {
      alert('⚠️ Browser Anda tidak mendukung Web Desktop Notification.');
      return;
    }
    if (status === 'denied') {
      alert('⚠️ Izin Notifikasi Desktop Diblokir oleh Browser.\n\nCara Mengaktifkan:\n1. Klik ikon Gembok / Pengaturan di sebelah kiri URL browser (' + window.location.host + ').\n2. Cari menu "Notifications" / "Notifikasi", lalu ubah menjadi "Allow" / "Izinkan".\n3. Refresh dashboard.');
      return;
    }

    const granted = await this.requestNotificationPermission();
    if (granted) {
      this.showDesktopNotification(
        '🔔 Uji Coba: Notifikasi Desktop SBM ITB',
        'Notifikasi pop-up desktop komputer Anda telah AKTIF dan berfungsi sempurna.',
        { tag: 'sbm-test-alert' }
      );
      this.playIncomingCallSound();
    } else {
      alert('⚠️ Izin notifikasi belum diberikan pada browser.');
    }
  }

  // Berkedip di judul Tab browser untuk menarik perhatian saat buka tab lain
  startTitleBlink(message = '🚨 PANGGILAN BARU MASUK!') {
    if (this.titleBlinkInterval) clearInterval(this.titleBlinkInterval);
    let isOriginal = false;
    this.titleBlinkInterval = setInterval(() => {
      document.title = isOriginal ? this.originalTitle : message;
      isOriginal = !isOriginal;
    }, 900);

    const onFocus = () => {
      this.stopTitleBlink();
      window.removeEventListener('focus', onFocus);
    };
    window.addEventListener('focus', onFocus);
  }

  stopTitleBlink() {
    if (this.titleBlinkInterval) {
      clearInterval(this.titleBlinkInterval);
      this.titleBlinkInterval = null;
    }
    document.title = this.originalTitle;
  }

  /* ==========================================================
     PENGATURAN PREFERENSI
     ========================================================== */

  setSoundType(type) {
    this.soundType = type;
    localStorage.setItem('sbm_sound_type', type);
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, parseFloat(vol)));
    localStorage.setItem('sbm_sound_volume', this.volume.toString());
  }

  setMuted(muted) {
    this.isMuted = !!muted;
    localStorage.setItem('sbm_sound_muted', this.isMuted.toString());
    if (this.isMuted) {
      this.stopContinuousAlert();
    }
  }

  setLoopEnabled(enabled) {
    this.loopEnabled = !!enabled;
    localStorage.setItem('sbm_sound_loop', this.loopEnabled.toString());
    if (!this.loopEnabled) {
      this.stopContinuousAlert();
    }
  }

  testSound(type = null) {
    const ctx = this.getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().then(() => {
        this.playIncomingCallSound(type || this.soundType);
      });
    } else {
      this.playIncomingCallSound(type || this.soundType);
    }
  }

  // Banner UI helper jika autoplay ditolak browser
  updateUnlockBannerUI(show) {
    const banner = document.getElementById('audioUnlockBanner');
    if (banner) {
      banner.style.display = show ? 'flex' : 'none';
    }
  }
}

// Export singleton instance global
window.SoundNotifier = new SoundNotifierEngine();
