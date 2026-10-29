# Curriculum transcribed from planner-compressed.pdf (page numbers in comments = PDF pages).
# Labels, order and spelling are kept as shown in the PDF. Lesson icons are cropped from the PDF
# (assets/icons/pNN_MM.webp = PDF page NN, row MM). Hero art = header crop of the module's own PDF page.
import json

def L(page, titles, start=1, skip_icons=()):
    out = []
    for i, t in enumerate(titles):
        out.append({"title": t, "icon": f"icons/p{page:02d}_{i + start:02d}.webp"})
    return out

def withnum(ls, nums):
    for l, n in zip(ls, nums): l['number'] = n
    return ls

def hero(p): return f"art/hero_p{p:02d}.webp"

def mod(title, page, icon=None, desc=None, children=None, lessons=None):
    m = {"title": title, "hero": hero(page), "icon": icon, "description": desc,
         "children": children or [], "lessons": lessons or [], "source_page": page}
    return m

S1 = [
  mod("Anatomie", 8, "icons/p07_01.webp", children=[                          # p7 chooser, p8 chapter list
    mod("Généralités", 9, "icons/p08_01.webp", lessons=L(9, [               # p9
      "Généralités sur le corps humain", "Généralités sur l'ostéologie", "Généralités sur l'arthrologie",
      "Généralités sur la myologie", "Généralités sur l'angiologie", "Généralités sur la névrologie"])),
    mod("Ostéologie", 10, "icons/p08_02.webp", lessons=L(10, [               # p10
      "Clavicule", "Scapula", "Humérus", "Ulna", "Radius", "Squelette de la main"])),
    mod("Arthrologie", 11, "icons/p08_03.webp", lessons=L(11, [              # p11
      "Articulations de l'épaule", "Articulation du coude", "Poignet", "Articulations de la main"])),
    mod("Myologie", 12, "icons/p08_04.webp", lessons=L(12, [                 # p12
      "Muscles de l'épaule", "Muscles du bras", "Muscles de l'avant-bras", "Muscles de la main"])),
    mod("Angiologie", 13, "icons/p08_05.webp", lessons=L(13, [               # p13
      "Artère axillaire", "Artère brachiale", "Artères radiale et ulnaire", "Arcades de la main",
      "Veines du membre thoracique", "Lymphatiques du membre thoracique"])),
    mod("Névrologie", 14, "icons/p08_06.webp", lessons=L(14, [               # p14 (chooser p8 spells it "Névérologie")
      "Plexus brachial", "Nerf axillaire", "Nerf radial", "Nerf ulnaire",
      "Nerf cutané antébrachial médial", "Nerf médian"])),
  ]),
  mod("Biochimie", 15, "icons/p07_02.webp", children=[                       # p15 chapter list
    mod("Les glucides", 16, "icons/p15_01.webp", lessons=L(16, [             # p16
      "Classification et structure des glucides", "Propriétés des glucides",
      "Dérivés sucrés et complexes glucidiques", "Digestion et absorption des glucides", "Glycolyse",
      "Néoglucogenèse", "Le métabolisme du glycogène", "Cycle de Krebs", "La voie des pentoses phosphates"])),
    mod("Les protéines", 17, "icons/p15_02.webp", lessons=withnum(L(17, [    # p17 (PDF numbering: 01, 02, 02.a, 03, 03.a, 04)
      "Les Acides Aminés", "Les propriétés des acides aminés", "a. Les peptides", "Les protéines",
      "a. Les protéines (structure et fonctions)", "Métabolisme des acides aminés"]),
      ["01", "02", "02", "03", "03", "04"])),
  ]),
  mod("Biophysique", 18, "icons/p07_03.webp", lessons=L(18, [                # p18 "Cours du semestre"
      "Biophysique des solutions", "Électricité et phénomène bioélectrique"])),
  mod("Chimie", 19, "icons/p07_04.webp", lessons=[                           # p19
      {"title": "ATOMISTIQUE", "icon": "icons/p19_01.webp"},
      {"title": "THEORIE DE BOHR", "icon": "icons/p19_02.webp"},
      {"title": "Nombres quantiques et description des orbitales", "icon": "icons/p19_03.webp"},
      {"title": "Règles de remplissage", "icon": "icons/p19_04.webp"},
      {"title": "CLASSIFICATION PERIODIQUE ET PROPRIETES DES ELEMENTS", "icon": "icons/p19_05.webp"},
      {"title": "a. LA LIAISON CHIMIQUE", "icon": "icons/p19_06.webp", "number": "06"},
      {"title": "(illisible dans le PDF — ligne 06 suivante, à confirmer)", "icon": None, "active": False,
       "note": "Row between '06. a. LA LIAISON CHIMIQUE' and '07.' is blurred/corrupted in the source PDF (p19). Kept as an INACTIVE placeholder so it is not counted in progress; admin can fill in the title and activate."},
      {"title": "Notions fondamentales de la thermodynamique", "icon": "icons/p19_08.webp", "number": "07"},
      {"title": "Premier principe et thermochimie", "icon": "icons/p19_09.webp", "number": "08"},
      {"title": "Deuxième principe", "icon": "icons/p19_10.webp", "number": "09"},
      {"title": "Equilibre chimique", "icon": "icons/p19_11.webp", "number": "10"}]),
  mod("Cytologie", 20, "icons/p07_05.webp", lessons=L(20, [                  # p20
      "Les Cellules Eucaryotes", "Généralités sur la cellule procaryote", "Les virus", "Microscopie",
      "Méthodes et techniques dans l'étude des cellules", "Fractionnement subcellulaire",
      "LA MEMBRANE PLASMIQUE — Aspect ultrastructural", "Membrane transport", "Cours Adhérence cellulaire"])),
  mod("Embryologie", 21, "icons/p07_06.webp", lessons=L(21, [                # p21
      "La spermatogenèse", "Ovogenèse", "Ovulation", "Première semaine",
      "Deuxième semaine du développement embryonnaire", "Troisième semaine", "Quatrième semaine",
      "Annexes et placenta", "Anomalies du développement", "Cellules souches"])),
  mod("Statistiques", 22, "icons/p07_07.webp", desc="Biostat — Part 1 · Part 2", lessons=L(22, [  # p22
      "Part 1", "Part 2"])),
]

S2 = [
  mod("SSH — Santé, Société et Humanités", 24, "icons/p23_01.webp", lessons=L(24, [   # p24
      "Santé et Culture", "Du Normal au Pathologique", "soignant - soigné", "Décision Médicale", "bioethics",
      "L'éthique médicale", "DEONTOLOGIE", "DROIT MEDICAL", "Les déterminants de santé craduation",
      "Indicateurs de santé", "notions de besoin de demande et d offre de soins"])),
  mod("Anatomie", 25, "icons/p23_02.webp", children=[                         # p25 chapter list
    mod("Généralités", 25, "icons/p25_01.webp",
        desc="Listed in the PDF chapter list (p25) but no lesson page was provided."),
    mod("Ostéologie", 26, "icons/p25_02.webp", lessons=L(26, [               # p26
      "Os coxal", "Fémur", "La rotule", "Fibula", "Le tibia", "Squelette du pied"])),
    mod("Arthrologie", 27, "icons/p25_03.webp", lessons=L(27, [              # p27
      "ARTICULATION DE LA HANCHE", "articulation du genou", "articulation de la cheville", "ANKLE JOINT"])),
    mod("Myologie", 28, "icons/p25_04.webp", lessons=L(28, [                 # p28
      "Muscles de la cuisse", "Muscles de la région glutéale", "Muscles du pied", "Muscles de la jambe"])),
    mod("Angiologie", 29, "icons/p25_05.webp", lessons=L(29, [               # p29
      "Artère fémorale", "Artère poplitée", "Artères de la jambe et du pied", "Veines du membre pelvien",
      "Vaisseaux lymphatiques du membre pelvien"])),
    mod("Neurologie", 30, "icons/p25_06.webp", lessons=[                     # p30 — numbering starts at 02 in the PDF
      {"title": "Plexus lombaire", "icon": "icons/p30_01.webp", "number": "02"},
      {"title": "Plexus sacrée", "icon": "icons/p30_02.webp", "number": "03"}]),
  ]),
  mod("Biochimie", 31, "icons/p23_03.webp", children=[                       # p31 chapter list
    mod("Bioénergétique", 32, "icons/p31_01.webp",
        desc="La chaîne respiratoire et phosphorylation oxydative · Métabolisme énergétique",
        lessons=L(32, ["Les Concepts de la bioénergétique", "la chaine respiratoire et phosphorylation oxydative"])),
    mod("Les enzymes", 33, "icons/p31_02.webp", desc="Structure et fonction · Cinétique enzymatique · Régulation",
        lessons=L(33, ["Introduction à l'enzymologie", "Cinétique enzymatique", "Les enzymes allostériques"])),
    mod("Les lipides", 34, "icons/p31_03.webp", desc="Structure des lipides · Métabolisme lipidique · Régulation",
        lessons=L(34, ["Caractères généraux des lipides", "Structures et propriétés des lipides simples",
          "Structures et propriétés des lipides complexes", "Métabolisme des acides gras (AG)",
          "Métabolisme des corps cétoniques", "Métabolisme des phospholipides", "Métabolisme des triglycérides",
          "Métabolisme du cholestérol", "Lipoprotéines", "Révision générale des lipides"])),
  ]),
  mod("Biophysique", 35, "icons/p23_04.webp", lessons=L(35, [                # p35
      "Optique géométrique", "Biophysique des rayonnements"])),
  mod("Chimie", 36, "icons/p23_05.webp", children=[                          # p36 chapter list
    mod("Chimie générale", 37, "icons/p36_01.webp", lessons=L(37, [          # p37
      "Les solutions", "pH des solutions aqueuses", "Acide-base", "Cinétique"])),
    mod("Chimie organique", 38, "icons/p36_02.webp", lessons=L(38, [         # p38
      "Définitions et concepts généraux", "Nomenclature des hydrocarbures", "Nomenclature des fonctions organiques",
      "Isomérie et stéréochimie", "Les grandes réactions en chimie organique"])),
  ]),
  mod("Cytologie", 39, "icons/p23_06.webp", lessons=L(39, [                  # p39
      "Le cytosquelette", "Le compartiment cytosolique", "Système endomembranaire", "Noyau et cycle cellulaire",
      "Mitochondrie"])),
  mod("Histologie", 40, "icons/p23_07.webp", lessons=L(40, [                 # p40
      "Épithélium de revêtement", "Les épithéliums glandulaires", "Tissu conjonctif", "Le tissu cartilagineux",
      "Tissu osseux et ossification", "Tissu sanguin", "Les tissus musculaires"])),
  mod("Physiologie", 41, "icons/p23_08.webp", lessons=L(41, [                # p41
      "Communication intercellulaire", "Physiologie du neurone", "Les synapses", "Physiologie du muscle",
      "Les compartiments liquidiens", "Bioénergétique", "Système nerveux autonome (SNA)", "Thermorégulation"])),
  mod("Statistiques", 42, "icons/p23_09.webp", desc="Biostat — Part 1 · Part 2", lessons=L(42, [  # p42
      "Part 1", "Part 2"])),
]

CURRICULUM = [
  {"year": 1, "semester": "S1", "label": "1er semestre", "modules": S1},
  {"year": 1, "semester": "S2", "label": "2ème semestre", "modules": S2},
]

def count(ms):
    n = 0
    for m in ms:
        n += len(m["lessons"]) + count(m["children"])
    return n

if __name__ == "__main__":
    json.dump(CURRICULUM, open("supabase/curriculum_year1.json", "w"), ensure_ascii=False, indent=1)
    for s in CURRICULUM:
        print(s["semester"], "modules:", len(s["modules"]), "lessons:", count(s["modules"]))
