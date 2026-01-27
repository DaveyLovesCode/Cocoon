/**
 * Reusable video player with HLS.js support.
 * Platform-agnostic - can be used by Twitter, Reddit, etc.
 * Uses Tailwind classes for styling.
 */

// SVG icons
export const ICON_MUTED = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.63 3.63a.996.996 0 000 1.41L7.29 8.7 7 9H4c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1h3l3.29 3.29c.63.63 1.71.18 1.71-.71v-4.17l4.18 4.18c-.49.37-1.02.68-1.6.91-.36.15-.58.53-.58.92 0 .72.73 1.18 1.39.91.8-.33 1.55-.77 2.22-1.31l1.34 1.34a.996.996 0 101.41-1.41L5.05 3.63c-.39-.39-1.02-.39-1.42 0zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53c.56-1.17.88-2.48.88-3.87 0-3.83-2.4-7.11-5.78-8.4-.59-.23-1.22.23-1.22.86v.19c0 .38.25.71.61.85C17.18 6.54 19 9.06 19 12zm-8.71-6.29l-.17.17L12 7.76V6.41c0-.89-1.08-1.33-1.71-.7zM16.5 12A4.5 4.5 0 0014 7.97v1.79l2.48 2.48c.01-.08.02-.16.02-.24z"/></svg>`;
export const ICON_UNMUTED = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
export const ICON_PLAY = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
export const ICON_PAUSE = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
export const ICON_FULLSCREEN = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>`;
export const ICON_EXIT_FULLSCREEN = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>`;

// Track which video is currently unmuted (only one at a time globally)
let currentUnmutedVideo: HTMLVideoElement | null = null;

// Track if user has interacted with audio (for sticky unmute feature)
let userHasInteractedWithAudio = false;

export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Generate HTML for video player controls using Tailwind classes.
 * Insert this inside a container element.
 */
export function getVideoPlayerHtml(posterUrl: string): string {
  return `
    <video class="w-full max-h-[500px] block bg-black focus:outline-none" poster="${posterUrl}" playsinline loop muted></video>

    <!-- Loading indicator -->
    <div class="video-loading absolute inset-0 flex items-center justify-center bg-black/40 z-25 pointer-events-none">
      <div class="video-loading-spinner"></div>
    </div>

    <!-- Center state indicator -->
    <div class="video-state-indicator absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 bg-black/75 rounded-full flex items-center justify-center text-white opacity-0 pointer-events-none transition-opacity z-20 scale-50">
      ${ICON_PLAY}
    </div>

    <!-- Volume control -->
    <div class="video-volume absolute bottom-2 right-3 flex flex-col items-center z-[15] transition-all duration-200">
      <div class="video-volume-slider relative w-9 h-0 opacity-0 overflow-hidden bg-black/60 rounded-[18px] flex justify-center items-center transition-all duration-150">
        <div class="relative w-1 h-full bg-white/30 rounded-sm">
          <div class="video-volume-fill absolute bottom-0 left-0 right-0 bg-white rounded-sm h-full"></div>
        </div>
        <input type="range" class="volume-input-vertical absolute w-14 h-6 left-1/2 top-1/2 m-0 p-0 cursor-pointer focus:outline-none" min="0" max="1" step="0.01" value="1">
      </div>
      <button type="button" class="video-mute-btn appearance-none border-0 bg-black/60 w-9 h-9 rounded-full flex items-center justify-center text-white cursor-pointer transition-colors duration-150 hover:bg-black/80 active:scale-[0.92]">
        ${ICON_MUTED}
      </button>
    </div>

    <!-- Controls bar -->
    <div class="video-controls absolute bottom-0 left-0 right-0 px-3 pt-6 pb-2.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 translate-y-1 transition-all duration-200 z-10">
      <div class="video-progress relative h-1 bg-white/25 rounded-sm cursor-pointer mb-2 hover:h-1.5">
        <div class="video-progress-buffered absolute top-0 left-0 h-full bg-white/35 rounded-sm pointer-events-none w-0"></div>
        <div class="video-progress-played absolute top-0 left-0 h-full bg-white rounded-sm pointer-events-none w-0"></div>
        <input type="range" class="seek-input absolute top-0 left-0 w-full h-full m-0 p-0 opacity-0 cursor-pointer appearance-none bg-transparent hover:opacity-100" min="0" max="100" step="0.1" value="0">
      </div>
      <div class="flex items-center gap-2.5">
        <button type="button" class="video-play-btn appearance-none border-0 bg-transparent w-8 h-8 rounded-full flex items-center justify-center text-white cursor-pointer transition-all duration-100 hover:bg-white/20 active:scale-[0.92]">
          ${ICON_PAUSE}
        </button>
        <span class="video-time text-xs font-medium text-white/90 tabular-nums tracking-wide">0:00 / 0:00</span>
      </div>
    </div>

    <!-- Fullscreen button (top-right, interactive mode only) -->
    <button type="button" class="video-fullscreen-btn absolute top-3 right-3 appearance-none border-0 bg-black/60 w-9 h-9 rounded-full flex items-center justify-center text-white cursor-pointer transition-all duration-200 hover:bg-black/80 active:scale-[0.92] opacity-0 z-[15]">
      ${ICON_FULLSCREEN}
    </button>
  `;
}

/**
 * Minimal CSS for things Tailwind can't handle (data-attribute selectors, complex hover states).
 * Most styling is now done via Tailwind classes in the HTML.
 */
export function getVideoPlayerStyles(): string {
  return `
    /* Container base */
    .cocoon-video-player-container {
      position: relative;
      width: 100%;
      background: #000;
      border-radius: 10px;
      overflow: hidden;
      cursor: pointer;
    }

    /* Loading indicator */
    .video-loading {
      opacity: 1;
      transition: opacity 0.2s ease-out;
    }
    .cocoon-video-player-container[data-loading="false"] .video-loading {
      opacity: 0;
    }

    /* Pulsing ring spinner */
    .video-loading-spinner {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: 3px solid rgba(255, 255, 255, 0.15);
      border-top-color: rgba(255, 255, 255, 0.9);
      animation: cocoon-video-spin 0.8s ease-in-out infinite;
    }

    @keyframes cocoon-video-spin {
      to { transform: rotate(360deg); }
    }

    /* State indicator animation */
    .video-state-indicator.visible {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
    .video-state-indicator.visible { animation: cocoon-indicator-pop 0.4s ease-out forwards; }
    .video-state-indicator svg { width: 28px; height: 28px; }

    /* Volume slider expand on hover (interactive mode only) */
    .cocoon-video-player-container[data-mode="interactive"] .video-volume:hover .video-volume-slider {
      height: 80px;
      padding: 12px 0;
      margin-bottom: 4px;
      opacity: 1;
    }

    /* Control button icons */
    .video-mute-btn svg, .video-play-btn svg, .video-fullscreen-btn svg { width: 20px; height: 20px; }

    /* Controls bar visible on hover (interactive mode only) */
    .cocoon-video-player-container[data-mode="interactive"]:hover .video-controls {
      opacity: 1;
      transform: translateY(0);
    }

    /* Volume control: in interactive mode, hide until hover (follows controls bar) */
    .cocoon-video-player-container[data-mode="interactive"] .video-volume {
      opacity: 0;
      transform: translateY(4px);
    }
    .cocoon-video-player-container[data-mode="interactive"]:hover .video-volume {
      opacity: 1;
      transform: translateY(0);
    }

    /* Fullscreen button: only visible on hover in interactive mode */
    .cocoon-video-player-container[data-mode="interactive"]:hover .video-fullscreen-btn {
      opacity: 1;
    }

    /* Progress bar hover reveal seek thumb */
    .video-progress:hover .seek-input { opacity: 1; }

    /* Fullscreen mode */
    .cocoon-video-player-container:fullscreen {
      width: 100vw;
      height: 100vh;
      border-radius: 0;
    }
    .cocoon-video-player-container:fullscreen video {
      max-height: 100vh;
      object-fit: contain;
    }
  `;
}

export interface VideoPlayerOptions {
  autoUnmuteAfterInteraction?: boolean; // When true, videos auto-unmute after user has interacted with any video
}

/**
 * Set up video with two-mode interaction:
 * - Initial mode: click unmutes and enters interactive mode
 * - Interactive mode: click toggles play/pause
 */
export function setupVideoPlayer(video: HTMLVideoElement, videoUrl: string, Hls: any, options?: VideoPlayerOptions): void {
  const autoUnmuteAfterInteraction = options?.autoUnmuteAfterInteraction === true;
  const container = video.closest('.cocoon-video-player-container') as HTMLElement;
  if (!container) return;

  const stateIndicator = container.querySelector('.video-state-indicator') as HTMLElement;
  const playBtn = container.querySelector('.video-play-btn') as HTMLElement;
  const muteBtn = container.querySelector('.video-mute-btn') as HTMLElement;
  const fullscreenBtn = container.querySelector('.video-fullscreen-btn') as HTMLElement;
  const volumeSlider = container.querySelector('.volume-input-vertical') as HTMLInputElement;
  const volumeFill = container.querySelector('.video-volume-fill') as HTMLElement;
  const progressPlayed = container.querySelector('.video-progress-played') as HTMLElement;
  const progressBuffered = container.querySelector('.video-progress-buffered') as HTMLElement;
  const seekInput = container.querySelector('.seek-input') as HTMLInputElement;
  const timeDisplay = container.querySelector('.video-time') as HTMLElement;

  // Initialize HLS with adaptive bitrate (ABR)
  if (Hls.isSupported()) {
    const hls = new Hls({
      enableWorker: true,
      startLevel: -1, // Let ABR choose based on network conditions
      capLevelToPlayerSize: true,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
    });
    hls.loadSource(videoUrl);
    hls.attachMedia(video);
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = videoUrl;
  }

  // Loading state management
  container.dataset.loading = 'true';

  function hideLoading() {
    container.dataset.loading = 'false';
  }

  function showLoading() {
    container.dataset.loading = 'true';
  }

  video.addEventListener('canplay', hideLoading);
  video.addEventListener('playing', hideLoading);
  video.addEventListener('waiting', showLoading);
  video.addEventListener('seeking', showLoading);
  video.addEventListener('seeked', hideLoading);

  let isInteractiveMode = false;
  let stateIndicatorTimeout: ReturnType<typeof setTimeout> | null = null;
  let volumeBeforeMute = 1;

  function updateVolumeUI() {
    const vol = video.muted ? 0 : video.volume;
    if (volumeFill) volumeFill.style.height = `${vol * 100}%`;
    if (volumeSlider) volumeSlider.value = String(video.muted ? 0 : video.volume);
  }

  function updateMuteUI() {
    const muted = video.muted || video.volume === 0;
    container.dataset.muted = muted ? 'true' : 'false';
    if (muteBtn) muteBtn.innerHTML = muted ? ICON_MUTED : ICON_UNMUTED;
    updateVolumeUI();
  }

  function updatePlayUI() {
    const isPlaying = !video.paused;
    container.dataset.playing = isPlaying ? 'true' : 'false';
    if (playBtn) playBtn.innerHTML = isPlaying ? ICON_PAUSE : ICON_PLAY;
  }

  function showStateIndicator(icon: string) {
    if (!stateIndicator) return;
    stateIndicator.innerHTML = icon;
    stateIndicator.classList.remove('visible');
    void stateIndicator.offsetWidth;
    stateIndicator.classList.add('visible');
    if (stateIndicatorTimeout) clearTimeout(stateIndicatorTimeout);
    stateIndicatorTimeout = setTimeout(() => stateIndicator.classList.remove('visible'), 450);
  }

  function enterInteractiveMode() {
    if (isInteractiveMode) return;
    isInteractiveMode = true;
    container.dataset.mode = 'interactive';
  }

  function unmute() {
    if (currentUnmutedVideo && currentUnmutedVideo !== video) {
      currentUnmutedVideo.muted = true;
      const prevContainer = currentUnmutedVideo.closest('.cocoon-video-player-container') as HTMLElement;
      if (prevContainer) prevContainer.dataset.muted = 'true';
    }
    video.muted = false;
    if (video.volume === 0) video.volume = volumeBeforeMute > 0 ? volumeBeforeMute : 1;
    currentUnmutedVideo = video;
    userHasInteractedWithAudio = true;
    updateMuteUI();
  }

  function mute() {
    if (video.volume > 0) volumeBeforeMute = video.volume;
    video.muted = true;
    if (currentUnmutedVideo === video) currentUnmutedVideo = null;
    updateMuteUI();
  }

  if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
      e.stopPropagation();
      const vol = parseFloat(volumeSlider.value);
      video.volume = vol;
      if (vol > 0) {
        video.muted = false;
        volumeBeforeMute = vol;
        currentUnmutedVideo = video;
      } else {
        video.muted = true;
        if (currentUnmutedVideo === video) currentUnmutedVideo = null;
      }
      updateMuteUI();
    });
    volumeSlider.addEventListener('click', (e) => e.stopPropagation());
  }

  function togglePlayPause() {
    if (video.paused) {
      video.play().catch(() => {});
      showStateIndicator(ICON_PLAY);
    } else {
      video.pause();
      showStateIndicator(ICON_PAUSE);
    }
  }

  container.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('.video-controls') || target.closest('a')) return;
    e.stopPropagation();

    if (!isInteractiveMode) {
      // First click always unmutes (standard behavior)
      unmute();
      enterInteractiveMode();
    } else {
      togglePlayPause();
    }
  });

  if (playBtn) {
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePlayPause();
    });
  }

  if (muteBtn) {
    muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      video.muted ? unmute() : mute();
    });
  }

  if (fullscreenBtn) {
    function updateFullscreenUI() {
      const isFullscreen = document.fullscreenElement === container;
      fullscreenBtn.innerHTML = isFullscreen ? ICON_EXIT_FULLSCREEN : ICON_FULLSCREEN;
    }

    fullscreenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (document.fullscreenElement === container) {
        document.exitFullscreen();
      } else {
        container.requestFullscreen();
      }
    });

    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement === container || document.fullscreenElement === null) {
        updateFullscreenUI();
      }
    });
  }

  if (seekInput) {
    let isSeeking = false;

    seekInput.addEventListener('input', () => {
      isSeeking = true;
      const seekTime = (parseFloat(seekInput.value) / 100) * video.duration;
      if (progressPlayed) progressPlayed.style.width = `${seekInput.value}%`;
      video.currentTime = seekTime;
    });

    seekInput.addEventListener('change', () => { isSeeking = false; });

    video.addEventListener('timeupdate', () => {
      if (isSeeking || !isFinite(video.duration)) return;
      const progress = (video.currentTime / video.duration) * 100;
      if (progressPlayed) progressPlayed.style.width = `${progress}%`;
      if (seekInput) seekInput.value = String(progress);
      if (timeDisplay) timeDisplay.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
    });

    video.addEventListener('progress', () => {
      if (!progressBuffered || !isFinite(video.duration)) return;
      if (video.buffered.length > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        progressBuffered.style.width = `${(bufferedEnd / video.duration) * 100}%`;
      }
    });
  }

  video.addEventListener('play', updatePlayUI);
  video.addEventListener('pause', updatePlayUI);

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          video.play().catch(() => {});
          // Auto-unmute if user has interacted with audio and setting is enabled
          if (autoUnmuteAfterInteraction && userHasInteractedWithAudio && video.muted) {
            unmute();
            enterInteractiveMode();
          }
        } else {
          video.pause();
        }
      }
    },
    { threshold: 0.5 }
  );
  observer.observe(video);

  updateMuteUI();
  updatePlayUI();
}
