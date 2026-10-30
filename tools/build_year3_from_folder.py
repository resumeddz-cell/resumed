# Year 3 curriculum built from the folders "Unités" and "Modules" (3ème année, Constantine).
# Order = file numbering in each folder. Left out: "X. Diapo" / "00. Diapo" (slide copies), "X. Résumé",
# programme/planning files, and second copies of the same course (NN.b, NN_, pdf+pptx).
import os, re, json, unicodedata, difflib
U = '/home/claude/work/y3/u/Unit#U00e9s'; M = '/home/claude/work/y3/m/Modules'
def dec(s): return unicodedata.normalize('NFC', re.sub(r'#U([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), s))
FIX = {'Candidosee': 'Candidoses', 'Migrains': 'Migrans', 'GENERALIES': 'GÉNÉRALITÉS', 'Splénomegalie': 'Splénomégalie',
       'Hemorragie': 'Hémorragie', 'dúodénale': 'duodénale', 'Signes fonctionnelles': 'Signes fonctionnels',
       'Troubles hydro-électrique': 'Troubles hydro-électrolytiques', 'Observation medicale': 'Observation médicale',
       'Mecanismes moleculaires': 'Mécanismes moléculaires', 'bacterienne': 'bactérienne', 'Nematodes et nematodoses': 'Nématodes et nématodoses',
       'Role du': 'Rôle du', 'Anato bactérienne': 'anatomie bactérienne', 'Dlr thoracique_vomique': 'Douleur thoracique, vomique', 'Dlr thoracique': 'Douleur thoracique',
       'thermoregulation': 'thermorégulation', 'Sd Larva': 'Syndrome de Larva', 'reflexes': 'réflexes', 'ATHEROSCLEROSE': 'Athérosclérose',
       'Thrombo-embolique': 'Maladie thrombo-embolique', 'IC aiguë': 'Insuffisance cardiaque aiguë', 'IR aigue': 'Insuffisance respiratoire aiguë',
       'Médicament du SNS': 'Médicaments du SNS', 'Médicament du SNPS': 'Médicaments du SNPS', 'Bactérie aérobie': 'Bactéries aérobies', 'Bactérie anaérobie': 'Bactéries anaérobies'}
WHOLE = {'HTA': 'HTA', 'OAP': 'Œdème aigu du poumon (OAP)', 'SCA': 'Syndrome coronarien aigu (SCA)', 'ECG': "L'ECG",
         'IRM': "Imagerie par résonance magnétique (IRM)", 'HIC': 'Hypertension intracrânienne (HIC)', 'IRa': 'Insuffisance rénale aiguë (IRA)',
         'OIA': 'Occlusion intestinale aiguë (OIA)', 'HTP': 'Hypertension portale (HTP)', 'HSA I': 'HSA I', 'LB': 'LB',
         'Abord et examen clinique(1)': 'Abord et examen clinique', 'Exploration des proteines plasmatiques': 'Exploration des protéines plasmatiques',
         'Exploration de la digestion et de l\'absorption.pdf': "Exploration de la digestion et de l'absorption",
         'Exploration de LCR (LCS)': 'Exploration du LCR (LCS)', 'Explorations en neurologie': 'Explorations en neurologie',
         'Uro imagerie': 'Uro-imagerie', 'Mammo-imagerie': 'Mammo-imagerie', 'Neuro imagerie': 'Neuro-imagerie',
         'Imagerie hypothal-hypophysaire': 'Imagerie hypothalamo-hypophysaire', 'Exploration CardioVasculaire': 'Exploration cardiovasculaire',
         'Dyskalémie': 'Dyskaliémies', 'Dysmagnésémie': 'Dysmagnésémies'}
EXT = ('.pdf', '.pptx', '.ppt', '.docx', '.doc')
def split(fn):
    t = dec(fn).strip()
    for e in EXT:
        if t.lower().endswith(e): t = t[:-len(e)]; break
    t = re.sub(r'\.pdf_?$', '', t)
    m = re.match(r'^\s*(\d+)(?:([._])(\d+|[a-z]))?\s*[._]?\s*[-–.]?\s*(.*)$', t)
    if not m: return None, None, t
    major, sep, sub, rest = m.group(1), m.group(2), m.group(3), m.group(4)
    return int(major), (sub if sep == '_' and sub and sub.isdigit() else (sub or '')), rest
def tidy(t):
    t = t.strip(' _-.')
    t = re.sub(r"(\w)_(\w)", r"\1'\2", t)
    t = t.replace('_', ' ').replace('’', "'")
    t = re.sub(r'\s*\((1|Diapo|Diapo blanc)\)\s*$', '', t)
    t = re.sub(r'\s+', ' ', t).strip(' -')
    if t in WHOLE: t = WHOLE[t]
    for a, b in FIX.items(): t = t.replace(a, b)
    if t.isupper() and len(t) > 5 and not re.match(r'^[A-Z]{2,4}( [IVX]+)?$', t): t = t.capitalize()
    t = t.replace("Douleur thoracique'vomique-dysphonie", 'Douleur thoracique, vomique, dysphonie').replace('rayon x', 'rayons X').replace(' -Les ', ' : les ')
    return t[0].upper() + t[1:]
def lessons_in(d):
    items = []
    for f in os.listdir(d):
        p = os.path.join(d, f)
        if not os.path.isfile(p) or f.endswith('.eml') or f.endswith('.jpg'): continue
        maj, sub, rest = split(f)
        items.append((maj if maj is not None else 0, sub or '', tidy(rest), 'diapo' in rest.lower()))
    items.sort(key=lambda x: (x[0], x[1]))
    out = []
    for maj, sub, t, isdiapo in items:
        prev = [o for o in out if o['maj'] == maj]
        if prev and maj and isdiapo: continue
        if prev and maj and sub.isalpha() and not any(o.get('sub') == 'a' for o in prev): continue   # NN.b = another copy of NN
        if prev and maj:
            if sub.isdigit():                                    # NN_1 / NN_2 = parts of one course
                if not prev[0].get('part'): prev[0]['part'] = '1'; prev[0]['title'] += ' (1)'
                out.append({'maj': maj, 'title': f'{t} ({sub})', 'part': sub}); continue
            if any(difflib.SequenceMatcher(None, o['title'].lower(), t.lower()).ratio() > 0.55 or 'diapo' in t.lower() for o in prev):
                continue                                         # second copy of the same course
        out.append({'maj': maj, 'title': t, 'sub': sub})
    res = []
    for i, o in enumerate(out):
        if not o['maj']: num = f'{i+1:02d}'
        elif o.get('part'): num = f"{o['maj']:02d}.{o['part']}"
        elif o.get('sub') and any(x['maj'] == o['maj'] and x is not o for x in out): num = f"{o['maj']:02d}.{o['sub']}"
        else: num = f"{o['maj']:02d}"
        res.append({'number': num, 'title': o['title']})
    return res
SKIP = re.compile(r'^(x\.|00\.|programme)', re.I)
def subdirs(d): return sorted([x for x in os.listdir(d) if os.path.isdir(os.path.join(d, x)) and not SKIP.match(dec(x).strip())], key=lambda s: dec(s).strip())
DISC = {'Psychologie médicale': ('badge:Ψ', 'art/hero_p24.webp'), 'Sémiologie': ('icons/p23_08.webp', 'art/hero_p41.webp'),
        'Physiopathologie': ('badge:PhP', 'art/hero_p39.webp'), 'Radiologie': ('badge:Rx', 'art/hero_p35.webp'), 'Biochimie': ('icons/p23_03.webp', 'art/hero_p31.webp')}
ORDER = list(DISC)
def discname(s):
    s = dec(s).strip()
    return {'Physiopath': 'Physiopathologie', 'Radio': 'Radiologie', 'Psychologie médical': 'Psychologie médicale'}.get(s, s)
def groupname(s): return re.sub(r'^\d+\s*-\s*', '', dec(s).strip()).strip()
units = []
UH = {1: 'art/hero_p41.webp', 2: 'art/hero_p25.webp', 3: 'art/hero_p23.webp', 4: 'art/hero_p08.webp'}
for uf in sorted(os.listdir(U), key=lambda s: int(re.search(r'\d+', dec(s)).group())):
    name = dec(uf).strip(); k = int(re.search(r'\d+', name).group()); sub = re.sub(r'^.*?\d+\s*_\s*', '', name).strip()
    children = []
    for df in sorted(subdirs(os.path.join(U, uf)), key=lambda s: ORDER.index(discname(s))):
        disc = discname(df); d = os.path.join(U, uf, df); icon, hero = DISC[disc]
        groups = subdirs(d)
        node = {'title': disc, 'icon': icon, 'hero': hero, 'lessons': lessons_in(d) if not groups else [], 'children': []}
        if groups:
            assert not lessons_in(d), d
            node['children'] = [{'title': groupname(g), 'icon': icon, 'hero': hero, 'lessons': lessons_in(os.path.join(d, g)), 'children': []} for g in groups]
        children.append(node)
    units.append({'title': f'Unité {k:02d} — {sub}', 'icon': f'badge:{k:02d}', 'hero': UH[k], 'lessons': [], 'children': children})
def mdir(n): return os.path.join(M, next(x for x in os.listdir(M) if dec(x).startswith(n)))
micro = mdir('3-')
parasito = lessons_in(mdir('5-'))
nonoff = [x for x in os.listdir(mdir('5-')) if 'Non officiel' in dec(x)]
for l in lessons_in(os.path.join(mdir('5-'), nonoff[0])): parasito.append(l)
parasito.sort(key=lambda l: float(l['number']))
pharm = lessons_in(mdir('4-')) + [{'number': 'TD', 'title': f"TD — {l['title'].replace('TD ', '')}"} for l in lessons_in(os.path.join(mdir('4-'), 'TD'))]
mods = [
  {'title': 'Anatomie pathologique', 'icon': 'icons/p23_07.webp', 'hero': 'art/hero_p40.webp', 'lessons': lessons_in(mdir('1-')), 'children': []},
  {'title': 'Immunologie', 'icon': 'icons/p23_06.webp', 'hero': 'art/hero_p39.webp', 'lessons': lessons_in(mdir('2-')), 'children': []},
  {'title': 'Microbiologie', 'icon': 'icons/p07_05.webp', 'hero': 'art/hero_p39.webp', 'lessons': [], 'children': [
     {'title': groupname(g), 'icon': 'icons/p07_05.webp', 'hero': 'art/hero_p39.webp', 'lessons': lessons_in(os.path.join(micro, g)), 'children': []} for g in subdirs(micro)]},
  {'title': 'Pharmacologie', 'icon': 'icons/p07_04.webp', 'hero': 'art/hero_p36.webp', 'lessons': pharm, 'children': []},
  {'title': 'Parasitologie', 'icon': 'icons/p23_05.webp', 'hero': 'art/hero_p39.webp', 'lessons': parasito, 'children': []},
]
cur = [{'semester': 'U', 'modules': units}, {'semester': 'M', 'modules': mods}]
json.dump(cur, open('/home/claude/app/supabase/curriculum_year3.json', 'w'), ensure_ascii=False, indent=1)
tot = 0
def show(n, depth):
    global tot
    print('  ' * depth + '# ' + n['title'])
    for l in n['lessons']: print('  ' * depth + '     ' + l['number'] + ' ' + l['title']); tot += 1
    for c in n['children']: show(c, depth + 1)
for s in cur:
    for m in s['modules']: show(m, 0)
print('TOTAL', tot)
