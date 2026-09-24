"""Extract this digital scorecard layout, without inferring identities or scoring rules.
Requires pypdf and pypdfium2. Unsupported layouts fail rather than guessing.
Usage: python scripts/extract-digital-scorecards.py SOURCE.pdf OUTPUT_DIRECTORY
"""
import hashlib
import json
import re
import sys
from pathlib import Path
from pypdf import PdfReader
import pypdfium2 as pdfium

source = Path(sys.argv[1]).expanduser().resolve()
out = Path(sys.argv[2]).resolve()
out.mkdir(parents=True, exist_ok=True, mode=0o700)
reader = PdfReader(source)
rendered = pdfium.PdfDocument(str(source))
cards = []
for index, page in enumerate(reader.pages):
    lines = [v.strip() for v in page.extract_text().splitlines() if v.strip()]
    def after(label):
        return lines[lines.index(label) + 1]
    start = lines.index('Away') + 1
    stop = lines.index('TEAM TOTAL GAMES WON')
    values = lines[start:stop]
    if len(values) % 6:
        raise ValueError(f'Unexpected table structure on page {index+1}')
    rows = []
    for i in range(0, len(values), 6):
        round_text, position, home, away, home_games, away_games = values[i:i+6]
        if not re.fullmatch(r'#\d+ (Singles|Doubles)', position):
            raise ValueError(f'Unrecognized position: {position}')
        rows.append(dict(round=int(round_text), position_text=position,
            home_names=home.split(' / '), away_names=away.split(' / '),
            home_games=int(home_games), away_games=int(away_games)))
    image = out / f'page-{index+1}.png'
    rendered[index].render(scale=1.5).to_pil().save(image)
    cards.append(dict(page=index+1, match_id=after('Match ID'), date_text=after('Date'),
        time_text=after('Time'), division=after('Division'), home_team=after('Home Team'),
        away_team=after('Visiting Team'), location=after('Location'), lines=rows,
        printed_home_total=int(lines[stop+2]), printed_away_total=int(lines[stop+4]),
        rendered_path=str(image), rendered_sha256=hashlib.sha256(image.read_bytes()).hexdigest()))
result = dict(source_path=str(source), source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
    extraction_method='PDF embedded text; deterministic layout parser; no vision API', cards=cards)
(out / 'observations.json').write_text(json.dumps(result, indent=2)+'\n')
print(f'Extracted {len(cards)} cards to {out / "observations.json"}')
