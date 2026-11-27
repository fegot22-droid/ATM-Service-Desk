"""
Схемы устройств: поиск датчиков по названию и галерея.

Данные (координаты датчиков и зон, картинки) перенесены из приложения
ATM Code Lookup: schemes.json + папка schemes/. Координаты хранятся долями
ширины/высоты картинки (0..1), поэтому не зависят от её размера.
"""

import io
import json
import re
from pathlib import Path

from PIL import Image, ImageDraw

BASE_DIR = Path(__file__).parent
with open(BASE_DIR / "schemes.json", encoding="utf-8") as f:
    SCHEMES = json.load(f)

GALLERY = SCHEMES["gallery"]

# Кириллица, похожая на латиницу: на телефоне датчик часто набирают русской раскладкой.
_LOOKALIKE = str.maketrans("АВСЕНКМОРТХУавсенкмортху", "ABCEHKMOPTXY" * 2)
_SPACES_RE = re.compile(r"\s+")
_UNDERSCORE_RE = re.compile(r"[_\-]+")
# Опечатки в подписях приложения: так датчик тоже находится.
ALIASES = {"VLS13": "VSL13"}
# CRS 4060 FL: «TUB_PS1a-d» — четыре датчика в одном месте, находится и по «TUB_PS1b», и по «TUB_PS1».
_RANGE_RE = re.compile(r"^(.*\d)([a-z])-([a-z])$")
MAX_SENSORS_PER_MESSAGE = 5


def normalize_name(name: str) -> str:
    """«vls 12», «ВЛС12»… → «VLS12»; «KLS2-5» = «KLS2_5».

    «_» не выбрасываем: KLS1_1 и KLS11 — разные датчики CCDM.
    """
    name = _SPACES_RE.sub("", (name or "").translate(_LOOKALIKE).upper())
    return _UNDERSCORE_RE.sub("_", name)


def _build_sensor_index() -> dict:
    """Нормализованное имя -> список совпадений (схема, имя, координаты)."""
    index: dict = {}
    for scheme in SCHEMES["sensor_schemes"]:
        grouped: dict = {}
        for name, x, y in scheme["markers"]:
            grouped.setdefault(name, []).append((x, y))
        for name, points in grouped.items():
            index.setdefault(normalize_name(name), []).append(
                {"scheme": scheme, "name": name, "points": points}
            )
    for alias, target in ALIASES.items():
        if target in index:
            index.setdefault(normalize_name(alias), []).extend(index[target])
    for key, hits in list(index.items()):
        for hit in hits:
            match = _RANGE_RE.match(hit["name"])
            if not match:
                continue
            base, first, last = match.groups()
            aliases = [base + chr(c) for c in range(ord(first), ord(last) + 1)] + [base]
            for alias in aliases:
                alias_key = normalize_name(alias)
                if alias_key not in index:
                    index[alias_key] = []
                if hit not in index[alias_key] and not any(
                        h["name"] == alias for h in index[alias_key]):
                    index[alias_key].append(hit)
    return index


SENSOR_INDEX = _build_sensor_index()
_MIN_SENSOR_LEN = min(len(k) for k in SENSOR_INDEX)
_TOKEN_RE = re.compile(r"[^\s,;]+")


def find_sensor(name: str) -> list:
    return SENSOR_INDEX.get(normalize_name(name), [])


def find_sensors_in_text(text: str, strict_case: bool = False) -> list:
    """Названия датчиков, встретившиеся в тексте (по словам или целиком: «Print head»).

    strict_case=True (для групп): засчитываются только слова, набранные
    заглавными, чтобы обычная переписка не вызывала схемы.
    """
    text = (text or "").strip()
    if not text:
        return []
    candidates = [text] + [t.strip("().:!?\"'") for t in _TOKEN_RE.findall(text)]
    found, seen = [], set()
    for candidate in candidates:
        if strict_case and candidate != candidate.upper():
            continue
        key = normalize_name(candidate)
        if len(key) < _MIN_SENSOR_LEN or key in seen or key not in SENSOR_INDEX:
            continue
        seen.add(key)
        found.append(key)
        if len(found) >= MAX_SENSORS_PER_MESSAGE:
            break
    return found


def scheme_title(scheme: dict) -> str:
    return f"{scheme['vendor']} {scheme['device']}, {scheme['part']}"


def sensor_caption(hit: dict) -> str:
    return f"Датчик {hit['name']}: {scheme_title(hit['scheme'])}"


def list_sensor_names() -> dict:
    """Устройство -> отсортированный список датчиков (для подсказки)."""
    result: dict = {}
    for scheme in SCHEMES["sensor_schemes"]:
        names = result.setdefault(f"{scheme['vendor']} {scheme['device']}", set())
        names.update(name for name, _, _ in scheme["markers"])
    return {device: sorted(names) for device, names in result.items()}


def image_path(image_id: str) -> Path:
    return BASE_DIR / SCHEMES["images"][image_id]


def load_image_bytes(image_id: str) -> bytes:
    return image_path(image_id).read_bytes()


def render_markers(image_id: str, points) -> bytes:
    """Картинка схемы с красными кольцами на указанных точках (JPEG)."""
    with Image.open(image_path(image_id)) as src:
        image = src.convert("RGB")
    width, height = image.size
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    radius = max(14, min(width, height) // 28)
    ring = max(4, radius // 4)
    for x, y in points:
        cx, cy = x * width, y * height
        draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius],
                     fill=(255, 0, 0, 60), outline=(255, 0, 0, 255), width=ring)
        outer = radius * 2
        draw.ellipse([cx - outer, cy - outer, cx + outer, cy + outer],
                     outline=(255, 0, 0, 160), width=max(2, ring // 2))
    image = Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=88)
    return buffer.getvalue()
