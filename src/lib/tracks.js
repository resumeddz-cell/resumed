// Background music choices. YouTube tracks are played with YouTube's own embedded player (visible,
// as YouTube requires); "Pluie" and the fallbacks are synthesised in the browser (lib/audio.js).
export const TRACKS = {
  none: { label: 'None' },
  piano1: { label: 'Piano 1', yt: 'rmxWd8SZB0k', synth: 'piano', icon: 'piano' },
  piano2: { label: 'Piano 2', yt: 'IstQsnuU8TY', synth: 'piano', icon: 'piano' },
  flute: { label: 'Flûte', yt: '6AxJX0eYKa0', synth: 'violin', icon: 'flute' },
  violin: { label: 'Violon', yt: 'BfdGBBSQ2fU', synth: 'violin', icon: 'violin' },
  guitar: { label: 'Guitare', yt: 'FjHGZj2IjBk', synth: 'guitar', icon: 'guitar' },
  rain: { label: 'Pluie', synth: 'rain', icon: 'rain' },
};
export const TRACK_ORDER = ['none', 'piano1', 'piano2', 'flute', 'violin', 'guitar', 'rain'];
const LEGACY = { piano: 'piano1' };
export const normalizeKind = (k) => (TRACKS[k] ? k : LEGACY[k] || 'none');

let ytPromise = null;
export function loadYouTube() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (!ytPromise) {
    ytPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) try { prev(); } catch { /* ignore */ } resolve(window.YT); };
      const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; s.async = true;
      s.onerror = () => { ytPromise = null; reject(new Error('YouTube could not be loaded')); };
      document.head.appendChild(s);
    });
  }
  return ytPromise;
}
