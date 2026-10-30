# Generates supabase/migrations/003_year2.sql from supabase/curriculum_year2.json
# (built from the "2/-Deuxième année" course folder). Same deterministic ids as Year 1.
import json, hashlib, uuid, sys
YEAR = int(sys.argv[1]) if len(sys.argv) > 1 else 2
cur = json.load(open(f'supabase/curriculum_year{YEAR}.json'))
def uid(path): return str(uuid.UUID(hashlib.md5(('resumed:' + path).encode()).hexdigest()))
def q(v):
    if v is None: return 'null'
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, int): return str(v)
    return "'" + str(v).replace("'", "''") + "'"
mods, less = [], []
def walk(ms, sem, parent, path):
    for i, m in enumerate(ms):
        p = f"{path}/{i+1}:{m['title']}"; mid = uid(p)
        mods.append((mid, YEAR, sem, parent, m['title'], m.get('description'), m.get('icon'), m.get('hero'), None, i + 1))
        for j, l in enumerate(m['lessons']):
            less.append((uid(p + f"#{j+1}:{l['title']}"), mid, l.get('number') or f"{j+1:02d}", l['title'], l.get('icon'), None, j + 1, True))
        walk(m['children'], sem, mid, p)
for s in cur: walk(s['modules'], s['semester'], None, f"Y{YEAR}/{s['semester']}")
SRC = {2: 'the course folder "2/-Deuxième année"', 3: 'the course folders "Unités" and "Modules" of the 3rd year'}[YEAR]
out = [f"-- Year {YEAR}: allow the sections U (unités) and M (modules) and add the Year {YEAR} curriculum.",
       f"-- Curriculum built from {SRC} (tools/gen_seed_year2.py {YEAR}).",
       "-- Safe to re-run: existing rows (and admin edits) are never overwritten.",
       "begin;",
       "alter table public.modules drop constraint if exists modules_semester_check;",
       "alter table public.modules add constraint modules_semester_check check (semester in ('S1', 'S2', 'U', 'M'));",
       "alter table public.profiles drop constraint if exists profiles_selected_semester_check;",
       "alter table public.profiles add constraint profiles_selected_semester_check check (selected_semester in ('S1', 'S2', 'U', 'M'));"]
out.append("insert into public.modules (id, year, semester, parent_id, title, description, icon, hero, source_page, position) values")
out.append(",\n".join("(" + ", ".join(q(x) for x in m) + ")" for m in mods) + "\non conflict (id) do nothing;")
out.append("insert into public.lessons (id, module_id, number, title, icon, note, position, active) values")
out.append(",\n".join("(" + ", ".join(q(x) for x in l) + ")" for l in less) + "\non conflict (id) do nothing;")
out.append("commit;")
open({2: 'supabase/migrations/003_year2.sql', 3: 'supabase/migrations/004_year3.sql'}[YEAR], 'w').write("\n".join(out) + "\n")
print(len(mods), 'modules', len(less), 'lessons')
