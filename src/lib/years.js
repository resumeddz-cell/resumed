// Academic years that have content, and how each one is split ("sections": semesters for Year 1,
// units / annual modules for Year 2, exactly as in the source material).
export const YEARS = {
  1: {
    label: '1ère année de médecine', short: 'Year 1',
    sections: [
      { id: 'S1', tab: 'Semester 1 (S1)', short: 'S1', title: '1ère année — Semestre 1 (S1)', hero: 'art/hero_p07.webp', noun: 'Semester' },
      { id: 'S2', tab: 'Semester 2 (S2)', short: 'S2', title: '1ère année — Semestre 2 (S2)', hero: 'art/hero_p23.webp', noun: 'Semester' },
    ],
  },
  2: {
    label: '2ème année de médecine', short: 'Year 2',
    sections: [
      { id: 'U', tab: 'Unités', short: 'Unités', title: '2ème année — Unités', hero: 'art/hero_p41.webp', noun: 'Units' },
      { id: 'M', tab: 'Modules', short: 'Modules', title: '2ème année — Modules', hero: 'art/hero_p39.webp', noun: 'Modules' },
    ],
  },
  3: {
    label: '3ème année de médecine', short: 'Year 3',
    sections: [
      { id: 'U', tab: 'Unités', short: 'Unités', title: '3ème année — Unités', hero: 'art/hero_p41.webp', noun: 'Units' },
      { id: 'M', tab: 'Modules', short: 'Modules', title: '3ème année — Modules', hero: 'art/hero_p40.webp', noun: 'Modules' },
    ],
  },
};
export const AVAILABLE_YEARS = Object.keys(YEARS).map(Number);
export const yearOf = (y) => YEARS[y] || YEARS[1];
export const sectionsOf = (y) => yearOf(y).sections;
// the same section id (U, M) exists in several years, so pass the year when it is known
export function sectionInfo(id, year) {
  const own = YEARS[year] && YEARS[year].sections.find((x) => x.id === id);
  if (own) return { ...own, year: Number(year) };
  for (const y of AVAILABLE_YEARS) { const s = YEARS[y].sections.find((x) => x.id === id); if (s) return { ...s, year: y }; }
  return { id, tab: id || '', short: id || '', title: id || '', hero: null, noun: 'Section', year: 1 };
}
// a section valid for the given year (falls back to the year's first section)
export function validSection(year, id) {
  const secs = sectionsOf(year);
  return secs.some((s) => s.id === id) ? id : secs[0].id;
}
