# Year 2 curriculum built from the folder "2/-Deuxième année" (Google Drive export).
# Order = file numbering inside each folder; "Diapo" folders hold slide copies of the same courses
# (not separate lessons); the video and a misplaced psychiatry document are left out.
import os, re, json, unicodedata
ROOT = '/home/claude/work/y2/zip/2--Deuxi#U00e8me ann#U00e9e'
def dec(s): return unicodedata.normalize('NFC', re.sub(r'#U([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), s))
FIX = {  # spelling fixes of file names (typos only; wording unchanged)
  'Postate': 'Prostate', 'UNINES': 'URINES', 'sytstèmes': 'systèmes', 'Expriénces': 'Expériences',
  'vielle-sommeil': 'veille-sommeil', 'muquese': 'muqueuse', 'remodlage': 'remodelage', 'parte2': 'partie 2',
  'partie1': 'partie 1', 'partie3': 'partie 3', 'hypothalamohypophysaires': 'hypothalamo-hypophysaires',
  'Duodenum': 'Duodénum', 'Régulation': 'Régulation', 'Regulation': 'Régulation', 'regulation': 'régulation',
}
def clean(fn):
    t = dec(os.path.splitext(fn)[0]).strip()
    t = re.sub(r'\.pptx?\s*$', '', t).strip()
    t = re.sub(r'\s+pptx$', '', t)
    m = re.match(r'^\s*(\d+(?:[._]\d+)?)\s*[-–]?\s*(.*)$', t)
    num = None
    if m: num, t = m.group(1).replace('_', '.'), m.group(2)
    t = re.sub(r'\s*\(خلفية بيضاء\s*\)', '', t)
    t = re.sub(r'(\w)_(\w)', r"\1'\2", t)          # l_appareil -> l'appareil
    t = t.strip(' _-')
    for a, b in FIX.items(): t = t.replace(a, b)
    t = re.sub(r'\s+', ' ', t).strip()
    if t.isupper() and len(t) > 4: t = t.capitalize()
    return num, t[0].upper() + t[1:]
POST = {'Biophys.cardio': 'Biophysique cardio-vasculaire', 'POUVOIR CONCENTRATION Et DILUTION DES URINES': 'Pouvoir de concentration et de dilution des urines',
  'Système a basse pression': 'Système à basse pression', 'Hormones-hypothalamo-hypophysaires-partie 1': 'Hormones hypothalamo-hypophysaires (partie 1)',
  'Hormones-hypothalamo-hypophysaires partie 2': 'Hormones hypothalamo-hypophysaires (partie 2)', 'Hormones-hypothalamo-hypophysaires-partie 3': 'Hormones hypothalamo-hypophysaires (partie 3)',
  'Trachée et segmentation bronchique(Trachea and bronchial segmentation)': 'Trachée et segmentation bronchique (Trachea and bronchial segmentation)',
  "L'electrophysiologie cardiaque": "L'électrophysiologie cardiaque", 'Replication': 'Réplication', 'Oligoélement': 'Oligoéléments'}
def numkey(n): return tuple(int(x) for x in re.split(r'[.]', n)) if n else (999,)
def files(d):
    out = []
    for f in os.listdir(d):
        p = os.path.join(d, f)
        if os.path.isfile(p) and f.lower().endswith(('.pdf', '.pptx', '.ppt', '.docx', '.doc')):
            n, t = clean(f); out.append((n, POST.get(t, t)))
    seen, res = set(), []
    for n, t in sorted(out, key=lambda x: (numkey(x[0]), x[1])):
        k = (n, t.lower())
        if k in seen: continue       # same course in two formats (pdf + pptx)
        seen.add(k); res.append((n, t))
    return res
DISC = {'Anatomie': ('icons/p07_01.webp', 'art/hero_p25.webp'), 'Biochimie': ('icons/p23_03.webp', 'art/hero_p31.webp'),
        'Biophysique': ('icons/p07_03.webp', 'art/hero_p35.webp'), 'Histologie': ('icons/p23_07.webp', 'art/hero_p40.webp'),
        'Physiologie': ('icons/p23_08.webp', 'art/hero_p41.webp')}
UNIT_HERO = {1: 'art/hero_p41.webp', 2: 'art/hero_p08.webp', 3: 'art/hero_p25.webp', 4: 'art/hero_p23.webp', 5: 'art/hero_p41.webp'}
def lessons(items, extra=()):
    ls = [{'number': (f"{int(n):02d}" if n and '.' not in n else n), 'title': t} for n, t in items]
    for n in range(len(ls)):
        if not ls[n]['number']: ls[n]['number'] = f"{n+1:02d}"
    return ls + list(extra)
units = []
udir = os.path.join(ROOT, '1 - Unit#U00e9s')
for uf in sorted(os.listdir(udir), key=lambda s: int(re.search(r'(\d+)', dec(s)).group(1))):
    name = dec(uf).strip(); k = int(re.search(r'(\d+)', name).group(1))
    sub = re.sub(r"^.*?\d+\s*_\s*", '', name).strip(); sub = re.sub(r'(\w)_(\w)', r"\1'\2", sub)
    sub = sub[0].upper() + sub[1:]
    children = []
    for df in sorted(os.listdir(os.path.join(udir, uf)), key=lambda s: list(DISC).index(dec(s).strip().replace('Phisyologie', 'Physiologie'))):
        disc = dec(df).strip().replace('Phisyologie', 'Physiologie')
        d = os.path.join(udir, uf, df)
        cours = os.path.join(d, 'Cours') if os.path.isdir(os.path.join(d, 'Cours')) else d
        extra = []
        td = os.path.join(d, 'Td')
        if os.path.isdir(td):
            extra = [{'number': 'TD', 'title': f'TD — {t}'} for _, t in files(td)]
        icon, hero = DISC[disc]
        children.append({'title': disc, 'icon': icon, 'hero': hero, 'lessons': lessons(files(cours), extra), 'children': []})
    units.append({'title': f'Unité {k:02d} — {sub}', 'icon': f'badge:{k:02d}', 'hero': UNIT_HERO[k], 'lessons': [], 'children': children})
mdir = os.path.join(ROOT, '2 - Modules')
gen = [x for x in files(os.path.join(mdir, '1-G#U00e9n#U00e9tique', 'Cours')) if 'Examen clinique' not in x[1]]
imm = files(os.path.join(mdir, '2-Immunologie '))
mods = [{'title': 'Génétique', 'icon': 'icons/p07_02.webp', 'hero': 'art/hero_p31.webp', 'lessons': lessons(gen), 'children': []},
        {'title': 'Immunologie', 'icon': 'icons/p23_06.webp', 'hero': 'art/hero_p39.webp', 'lessons': lessons(imm), 'children': []}]
cur = [{'semester': 'U', 'modules': units}, {'semester': 'M', 'modules': mods}]
json.dump(cur, open('/home/claude/app/supabase/curriculum_year2.json', 'w'), ensure_ascii=False, indent=1)
tot = 0
for s in cur:
    for m in s['modules']:
        print('#', m['title'])
        for c in m['children'] or [m]:
            if c is not m: print('  ##', c['title'])
            for l in c['lessons']: print('     ', l['number'], l['title']); tot += 1
print('TOTAL', tot)
