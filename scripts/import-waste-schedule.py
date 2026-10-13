#!/usr/bin/env python3
"""Läser hämtningsschemat (PDF) och skriver SQL som lägger in en heldagshändelse per datum och fastighet i VI-HEMs kalender.
Användning: import-waste-schedule.py <schema.pdf> > import.sql   (idempotent: tar först bort tidigare import med source_type 'waste_schedule_2026')"""
import re, sys, pdfplumber
MONTHS = {'januari':1,'februari':2,'mars':3,'april':4,'maj':5,'juni':6,'juli':7,'augusti':8,'september':9,'oktober':10,'november':11,'december':12}
PROPS = ['Ekängsvägen 1', 'Ekelundsgatan 6', 'Kyrkogatan 4', 'Kyrkogatan 10', 'Kyrkogatan 12 A']
def parse(path):
    out = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ''
            m = re.search(r'^(Juli|Augusti|September|Oktober|November|December|Januari)\s+(\d{4})', text, re.M | re.I)
            if not m: continue
            year = int(m.group(2))
            for tb in page.extract_tables():
                header = [re.sub(r'\s+', ' ', (c or '')).strip() for c in tb[0]]
                assert header[0] == 'Datum' and header[1:] == PROPS, header
                for row in tb[1:]:
                    dm = re.match(r'(Mån|Tis|Ons|Tor|Fre|Lör|Sön)\s+(\d{1,2})\s+([a-zåäö]+)', (row[0] or '').strip(), re.I)
                    assert dm, row
                    month = MONTHS[dm.group(3).lower()]; day = int(dm.group(2))
                    for prop, cell in zip(PROPS, row[1:]):
                        cell = (cell or '').strip()
                        if not cell: continue
                        lines = [l.strip() for l in cell.split('\n') if l.strip()]
                        items = []
                        if lines[0].startswith('FNI'):
                            assert len(lines) == 2, (row, cell); items.append((lines[0], lines[1]))
                        else:
                            assert len(lines) % 2 == 0, (row, cell)
                            for k in range(0, len(lines), 2): items.append((lines[k], lines[k + 1]))
                        out.append((f'{year:04d}-{month:02d}-{day:02d}', dm.group(1), prop, items))
    return out
def q(s): return "'" + s.replace("'", "''") + "'"
if __name__ == '__main__':
    rows = parse(sys.argv[1])
    print("-- Hämtningsschema 2026 (Virserum Bostäder & Fastighet AB): en heldagshändelse per datum och fastighet. Genererad av scripts/import-waste-schedule.py")
    print("begin;")
    print("delete from public.vihem_calendar_events where organisation_id = '38fe702d-e72c-49a2-9750-5e0b6934959b' and source_type = 'waste_schedule_2026';")
    print("insert into public.vihem_calendar_events (organisation_id, title, description, location, starts_at, ends_at, all_day, visibility, category, color, source_type) values")
    vals = []
    for d, wd, prop, items in rows:
        names = ', '.join(i[0] for i in items)
        desc = f"Hämtning enligt hämtningsschema 2026 ({wd}).\n" + '\n'.join(f"{n} – kärl {k}" for n, k in items)
        if all(n.startswith('FNI') for n, _ in items): desc += "\nBeteckningen FNI anges så i underlaget; avfallsslag framgår inte av schemat."
        vals.append(f"('38fe702d-e72c-49a2-9750-5e0b6934959b', {q(f'Tömning {prop}: {names}')}, {q(desc)}, {q(prop + ', Virserum')}, ({q(d)}::date::timestamp at time zone 'Europe/Stockholm'), (({q(d)}::date + time '23:59') at time zone 'Europe/Stockholm'), true, 'organisation', 'operations', '#16a34a', 'waste_schedule_2026')")
    print(',\n'.join(vals) + ';')
    print("commit;")
    print(f"-- {len(rows)} händelser", file=sys.stderr)
