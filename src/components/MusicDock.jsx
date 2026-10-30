import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LuX, LuPlay } from 'react-icons/lu';
import { useTimer } from '../state/timer.jsx';
import { TRACKS, loadYouTube } from '../lib/tracks.js';

// One YouTube player for the whole app. It is never moved in the DOM (that would reload it):
// on the Pomodoro page it is laid over the empty slot of the music card, elsewhere it floats in a corner.
export default function MusicDock() {
  const tm = useTimer();
  const { music, musicActive, ytFailed, markYtFailed, setMusic } = tm;
  const track = TRACKS[music.kind] || TRACKS.none;
  const wantYt = !!(track.yt && !ytFailed[music.kind]);
  const visible = musicActive && wantYt;
  const box = useRef(null); const host = useRef(null); const player = useRef(null); const loaded = useRef(null);
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState(false);            // browser refused to start playback without a tap
  const [slot, setSlot] = useState(null);

  // create the player the first time a YouTube track is needed
  useEffect(() => {
    if (!wantYt || player.current) return;
    let cancelled = false;
    loadYouTube().then((YT) => {
      if (cancelled || player.current) return;
      const el = document.createElement('div'); host.current.appendChild(el);     // YouTube replaces this element with its iframe
      player.current = new YT.Player(el, {
        width: '100%', height: '100%', videoId: track.yt,
        playerVars: { autoplay: 0, controls: 1, rel: 0, playsinline: 1, modestbranding: 1 },
        events: {
          onReady: () => { loaded.current = track.yt; setReady(true); },
          onStateChange: (e) => {
            if (e.data === 0) { e.target.seekTo(0, true); e.target.playVideo(); }        // loop
            if (e.data === 1) setBlocked(false);
          },
          onError: () => markYtFailed(currentKind.current),
        },
      });
    }).catch(() => markYtFailed(music.kind));
    return () => { cancelled = true; };
  }, [wantYt]); // eslint-disable-line react-hooks/exhaustive-deps
  const currentKind = useRef(music.kind); currentKind.current = music.kind;

  // play / pause / switch track / volume
  useEffect(() => {
    const p = player.current; if (!ready || !p) return;
    try {
      p.setVolume(Math.round((music.volume ?? 0.6) * 100));
      if (visible) {
        if (loaded.current !== track.yt) { loaded.current = track.yt; p.loadVideoById(track.yt); }
        else p.playVideo();
        const id = setTimeout(() => { try { if (p.getPlayerState() !== 1 && p.getPlayerState() !== 3) setBlocked(true); } catch { /* ignore */ } }, 2500);
        return () => clearTimeout(id);
      }
      p.pauseVideo();
    } catch { /* player not ready */ }
    return undefined;
  }, [ready, visible, track.yt, music.volume]);

  // follow the slot in the Pomodoro music card while it is on screen
  useLayoutEffect(() => {
    if (!visible) return undefined;
    let raf = 0;
    const tick = () => {
      const el = document.getElementById('music-slot');
      const r = el && el.getBoundingClientRect();
      const next = r && r.width > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
      setSlot((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  const style = !visible ? { display: 'none' } : slot ? { top: slot.top, left: slot.left, width: slot.width, height: slot.height } : null;
  return (
    <div ref={box} className={`music-dock ${visible ? 'on' : ''} ${slot ? 'docked' : 'floating'}`} style={style || undefined} aria-label="Background music player">
      <div className="music-dock-video"><div ref={host} /></div>
      {visible && !slot && (
        <div className="music-dock-bar">
          <span>{track.label}</span>
          <button type="button" className="icon-btn" aria-label="Turn the music off" onClick={() => setMusic({ kind: 'none' })}><LuX /></button>
        </div>
      )}
      {visible && blocked && (
        <button type="button" className="music-dock-play" onClick={() => { try { player.current.playVideo(); } catch { /* ignore */ } setBlocked(false); }}>
          <LuPlay aria-hidden /> Tap to play the music</button>
      )}
    </div>
  );
}
