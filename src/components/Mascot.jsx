import React from 'react';

// The mascot exactly as drawn in the PDF (no redrawn or puppeted parts).
// The welcome pose can float very gently; it stays still for people who prefer reduced motion.
export function WavingMascot({ className = '', float = false }) {
  return (
    <img src="assets/mascot/mascot_wave.webp" alt="The Resumed mascot waving hello"
         className={`mascot-still ${float ? 'm-float' : ''} ${className}`} />
  );
}

export function StudyingMascot({ className = '' }) {
  return <img src="assets/mascot/study_base.webp" alt="The Resumed mascot studying at her desk" className={`mascot-still ${className}`} />;
}
