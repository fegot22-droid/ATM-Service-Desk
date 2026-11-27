"""
Инструкции по настройке банкоматов (меню /guides).

Каждая инструкция — файл guides/<id>.md:
    # Заголовок инструкции
    ## Раздел
    текст…
    [img: файл.jpg]      — картинка из guides/img, отправляется отдельным фото
Чтобы добавить инструкцию, положи новый .md в guides/ и допиши его id в ORDER.
"""

import re
from pathlib import Path

GUIDES_DIR = Path(__file__).parent / "guides"
ORDER = ["ncr", "cineo", "grg"]
# Исходный документ целиком (кнопка «Вся инструкция целиком»), лежит в guides/files.
FILES = {"ncr": "NCR_Aptra.docx", "cineo": "CINEO_ProFlex.docx", "grg": "GRG_nastroika.pdf"}
MAX_CHUNK = 3800
_IMG_RE = re.compile(r"^\[img:\s*([\w.\-]+)\]$")


def parse(text: str) -> dict:
    title, sections = "", []
    for line in text.splitlines():
        stripped = line.strip()
        if line.startswith("## "):
            sections.append({"title": line[3:].strip(), "blocks": []})
        elif line.startswith("# ") and not title:
            title = line[2:].strip()
        elif sections:
            match = _IMG_RE.match(stripped)
            blocks = sections[-1]["blocks"]
            if match:
                blocks.append(("img", match.group(1)))
            elif blocks and blocks[-1][0] == "text":
                blocks[-1] = ("text", blocks[-1][1] + "\n" + line)
            else:
                blocks.append(("text", line))
    for section in sections:
        section["blocks"] = [(k, v.strip() if k == "text" else v)
                             for k, v in section["blocks"] if k == "img" or v.strip()]
    return {"title": title, "sections": sections}


def load() -> dict:
    guides = {}
    for guide_id in ORDER:
        path = GUIDES_DIR / f"{guide_id}.md"
        if path.is_file():
            guides[guide_id] = parse(path.read_text(encoding="utf-8"))
    return guides


GUIDES = load()


def split_text(text: str, limit: int = MAX_CHUNK) -> list:
    """Режем длинный текст по строкам, чтобы влезть в сообщение Telegram."""
    chunks, current = [], ""
    for line in text.split("\n"):
        while len(line) > limit:
            if current:
                chunks.append(current)
                current = ""
            chunks.append(line[:limit])
            line = line[limit:]
        candidate = f"{current}\n{line}" if current else line
        if len(candidate) > limit:
            chunks.append(current)
            current = line
        else:
            current = candidate
    if current.strip():
        chunks.append(current)
    return chunks


def image_path(name: str) -> Path:
    return GUIDES_DIR / "img" / name


def section(guide_id: str, index: int):
    guide = GUIDES.get(guide_id)
    if not guide or not 0 <= index < len(guide["sections"]):
        return None
    return guide["sections"][index]


def full_file(guide_id: str):
    name = FILES.get(guide_id)
    path = GUIDES_DIR / "files" / name if name else None
    return path if path and path.is_file() else None
