"""
Телеграм-бот (webhook-версия) для поиска кодов ошибок банкомата.

В отличие от polling-версии, этот вариант не держит постоянный процесс —
он принимает HTTP-запросы от Telegram на /webhook, что идеально подходит
для serverless/PaaS-хостинга (Ample Computer, Vercel и т.п.).

Переменные окружения:
    BOT_TOKEN — токен бота от @BotFather (ОБЯЗАТЕЛЬНО, хранить как секрет,
                не коммитить в код и не класть в файлы)

После деплоя нужно один раз вызвать Telegram API setWebhook с публичным
URL сервиса — см. set_webhook.py рядом.
"""

import html
import json
import os
import re
import time
from pathlib import Path

import requests
from fastapi import FastAPI, Request

import guides
import schemes

app = FastAPI()

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
TELEGRAM_API = f"https://api.telegram.org/bot{BOT_TOKEN}"

DATA_PATH = Path(__file__).parent / "error_codes.json"
with open(DATA_PATH, encoding="utf-8") as f:
    DATA = json.load(f)

CATEGORY_TITLES = {"grg": "GRG", "cmd_v4": "CMD-V4", "ccdm": "CCDM"}

# Режимы меню, как в приложении: вендор -> устройство.
MODES = {
    "grg": {"title": "GRG", "hint": "-1335"},
    "ccdm": {"title": "Wincor CCDM (кеш-ин)", "hint": "08"},
    "cmd_v4": {"title": "Wincor CMD-V4 (кеш-аут)", "hint": "21"},
}
MAX_MESSAGE_LEN = 3800


class Html(str):
    """Текст с HTML-разметкой Telegram (<b>, <i>, <code>). Обычные str уходят без разметки."""


def esc(text) -> str:
    return html.escape(str(text), quote=False)


TAG_RE = re.compile(r"<[^>]+>")


def strip_html(text: str) -> str:
    return html.unescape(TAG_RE.sub("", text))


# Все виды «минусов», которые прилетают с телефонов и из скопированных документов.
DASHES = "\u2212\u2012\u2013\u2014\u2015\u2010\u2011\ufe63\uff0d"
_DASH_TABLE = str.maketrans({ch: "-" for ch in DASHES})
CODE_RE = re.compile(r"(?<![\w-])(-\s*)?(\d{1,9})(?!\d)")
# «1,335» / «1.335» — разделитель тысяч, а не два кода.
THOUSANDS_RE = re.compile(r"(?<=\d)[,.](?=\d{3}(?!\d))")
MAX_CODES_PER_MESSAGE = 10


def _build_index(table: dict) -> dict:
    """Ключ справочника -> целое число (без учёта ведущих нулей)."""
    index = {}
    for key in table:
        try:
            index.setdefault(int(key), key)
        except ValueError:
            continue
    return index


INDEXES = {c: _build_index(DATA.get(c, {})) for c in ("grg", "cmd_v4", "ccdm")}


def extract_codes(text: str) -> list[int]:
    """Достаёт все коды из сообщения: «-1335», «− 1335», «код 08.», «-1335 -1334»."""
    text = THOUSANDS_RE.sub("", text.translate(_DASH_TABLE))
    codes = []
    for m in CODE_RE.finditer(text):
        value = int(m.group(2))
        if m.group(1):
            value = -value
        if value not in codes:
            codes.append(value)
        if len(codes) >= MAX_CODES_PER_MESSAGE:
            break
    return codes


def lookup_value(value: int, mode=None):
    """Возвращает список (категория, ключ, описание, знак_совпал).

    mode — выбранная в меню база ("grg", "ccdm", "cmd_v4"); None — все базы.
    """
    results = []
    negative = value < 0
    if mode in ("cmd_v4", "ccdm"):
        key = INDEXES[mode].get(abs(value))
        if key is not None:
            results.append((mode, key, DATA[mode][key], not negative))
        return results

    grg_index, grg = INDEXES["grg"], DATA.get("grg", {})
    exact = grg_index.get(value)
    opposite = grg_index.get(-value) if value != 0 else None
    if exact is not None:
        results.append(("grg", exact, grg[exact], True))
        # Минус часто забывают поставить: на положительный код
        # показываем и отрицательный, если он тоже есть.
        if not negative and opposite is not None:
            results.append(("grg", opposite, grg[opposite], False))
    elif opposite is not None:
        results.append(("grg", opposite, grg[opposite], False))
    if mode == "grg":
        return results

    for category in ("cmd_v4", "ccdm"):
        key = INDEXES[category].get(abs(value))
        if key is not None:
            results.append((category, key, DATA[category][key], not negative))
    return results


def lookup_code(raw: str):
    """Совместимость: все совпадения по всем кодам из строки."""
    results = []
    for value in extract_codes(raw):
        results.extend(lookup_value(value))
    return results


# Подписи строк описания из базы -> значок.
FIELD_ICONS = {"Категория": "🏷", "Описание": "📝", "Рекомендации": "🛠"}
SEPARATOR = "\n\n┈┈┈┈┈┈┈┈┈┈\n\n"


def format_description(text: str) -> str:
    """Описание и рекомендации — в отдельных рамках-цитатах Telegram (<blockquote>)."""
    about, advice = [], []
    for line in text.strip().split("\n"):
        label, sep, rest = line.partition(":")
        icon = FIELD_ICONS.get(label.strip()) if sep else None
        target = advice if label.strip() == "Рекомендации" and sep else about
        if icon:
            target.append(f"{icon} <b>{esc(label.strip())}:</b> {esc(rest.strip())}")
        elif line.strip():
            (advice if advice else about).append(esc(line.strip()))
    blocks = ["<blockquote>" + "\n".join(part) + "</blockquote>" for part in (about, advice) if part]
    return "\n".join(blocks)


def format_value(value: int, results, mode=None) -> Html:
    if not results:
        if mode:
            return Html(f"❓ Код <b>{value}</b> не найден в базе {esc(MODES[mode]['title'])}.\n"
                        "Сменить банкомат: /menu")
        return Html(f"❓ Код <b>{value}</b> не найден ни в одной из баз (GRG, CMD-V4, CCDM).")
    blocks = []
    for category, key, text, sign_matches in results:
        title = f"🔴 <b>{esc(CATEGORY_TITLES.get(category, category))} · код {esc(key)}</b>"
        note = "" if sign_matches else f"\n⚠️ <i>Ты ввёл {value}, показан код с другим знаком</i>"
        blocks.append(f"{title}{note}\n{format_description(text)}")
    return Html("\n\n".join(blocks))


def tg_post(method: str, **kwargs):
    """Запрос к Bot API; при «Too Many Requests» один раз ждём и повторяем."""
    for attempt in range(2):
        try:
            resp = requests.post(f"{TELEGRAM_API}/{method}", **kwargs)
        except requests.RequestException:
            return None  # не роняем обработчик вебхука из-за сетевой ошибки
        if resp.status_code != 429 or attempt:
            return resp
        try:
            wait = resp.json().get("parameters", {}).get("retry_after", 1)
        except ValueError:
            wait = 1
        time.sleep(min(max(wait, 1), 5))
        files = kwargs.get("files")
        if files:  # файлы-потоки нужно перемотать перед повтором
            for value in files.values():
                handle = value[1] if isinstance(value, tuple) else value
                if hasattr(handle, "seek"):
                    handle.seek(0)
    return None


def _text_payload(text: str) -> dict:
    """Html уходит с parse_mode, длинный Html — без разметки, чтобы не порвать теги."""
    if isinstance(text, Html) and len(text) <= MAX_MESSAGE_LEN:
        return {"text": str(text), "parse_mode": "HTML"}
    if isinstance(text, Html):
        text = strip_html(text)
    if len(text) > MAX_MESSAGE_LEN:
        text = text[:MAX_MESSAGE_LEN] + "\n\n…(обрезано)"
    return {"text": text}


def send_message(chat_id: int, text: str, reply_markup=None) -> None:
    payload = {"chat_id": chat_id, **_text_payload(text)}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    tg_post("sendMessage", json=payload, timeout=10)


def edit_message(chat_id: int, message_id: int, text: str, reply_markup=None) -> None:
    payload = {"chat_id": chat_id, "message_id": message_id, **_text_payload(text)}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    try:
        requests.post(f"{TELEGRAM_API}/editMessageText", json=payload, timeout=10)
    except requests.RequestException:
        pass


def send_photo(chat_id: int, photo: bytes, caption: str = "") -> None:
    tg_post("sendPhoto", data={"chat_id": chat_id, "caption": caption[:1000]},
            files={"photo": ("scheme.jpg", photo, "image/jpeg")}, timeout=20)


def delete_messages(chat_id: int, message_ids: list) -> None:
    """Удаляет пачками по 100; несуществующие и старше 48 часов Telegram пропускает."""
    ids = sorted(set(i for i in message_ids if i > 0))
    for start in range(0, len(ids), 100):
        tg_post("deleteMessages", json={"chat_id": chat_id, "message_ids": ids[start:start + 100]},
                timeout=10)


def send_document(chat_id: int, path, caption: str = "") -> None:
    try:
        with open(path, "rb") as f:
            requests.post(
                f"{TELEGRAM_API}/sendDocument",
                data={"chat_id": chat_id, "caption": caption[:1000]},
                files={"document": (path.name, f)},
                timeout=30,
            )
    except (OSError, requests.RequestException):
        pass


def answer_callback(callback_id: str) -> None:
    try:
        requests.post(
            f"{TELEGRAM_API}/answerCallbackQuery",
            json={"callback_query_id": callback_id},
            timeout=10,
        )
    except requests.RequestException:
        pass


def build_help_text() -> Html:
    meta = DATA.get("meta", {})
    return Html(
        "<b>📖 Как пользоваться ботом</b>\n\n"
        "<b>🔢 Коды ошибок</b>\n"
        "Пришли код цифрами: <code>-1335</code>, <code>08</code>, <code>21</code>. "
        "Можно несколько кодов в одном сообщении.\n"
        f"• GRG: {meta.get('grg_count', '?')} кодов\n"
        f"• Wincor CMD-V4 (кеш-аут): {meta.get('cmd_v4_count', '?')} кодов\n"
        f"• Wincor CCDM (кеш-ин): {meta.get('ccdm_count', '?')} кодов\n\n"
        "<b>🏧 Выбор банкомата</b> · /menu\n"
        "После выбора код ищется только в базе этого устройства. Если хранилище не подключено, "
        "отвечай на сообщения бота, чтобы выбор сохранялся.\n\n"
        "<b>📍 Датчики и схемы</b>\n"
        "• Название датчика (<code>SF01</code>, <code>VLS12</code>, <code>PES</code>) "
        "или /sensor SF01 — схема с отмеченным датчиком\n"
        "• /sensor — список датчиков по устройствам\n"
        "• /schemes — все схемы: датчики, моторы, соленоиды\n"
        "• Если в описании ошибки есть датчик, схема придёт сразу\n\n"
        "<b>📚 Ещё</b>\n"
        "• /guides — инструкции по настройке NCR, CINEO, GRG\n"
        "• /clear — очистить историю чата\n"
        "• В любом чате: <code>@имя_бота 1335</code>"
    )


@app.get("/")
async def health():
    return {"status": "ok"}


START_TEXT = Html(
    "👋 <b>Привет! Я помогаю разобраться с ошибками банкомата.</b>\n\n"
    "🔢 Пришли код ошибки, например <code>-1335</code>, <code>08</code> или <code>21</code>.\n"
    "🏧 Выбери банкомат ниже, чтобы искать только в его базе.\n"
    "📍 Пришли название датчика (<code>SF01</code>), и я покажу его на схеме.\n\n"
    "Все возможности: /help"
)
NO_CODE_TEXT = Html(
    "🤔 Не вижу в сообщении кода ошибки или названия датчика.\n"
    "Пришли код цифрами (<code>-1335</code>, <code>08</code>) или датчик (<code>SF01</code>)."
)
UNKNOWN_COMMAND_TEXT = Html("🤔 Не знаю такой команды. Пришли код ошибки или открой /help.")
SCHEME_CALLBACK_PREFIX = "scheme:"


def build_reply(text: str, is_private: bool, mode=None):
    """Текст ответа или None, если отвечать не нужно."""
    text = (text or "").strip()

    if text.startswith("/"):
        command = text.split()[0].split("@")[0].lower()
        if command == "/start":
            return START_TEXT
        if command == "/help":
            return build_help_text()
        return UNKNOWN_COMMAND_TEXT if is_private else None

    codes = extract_codes(text)
    if not codes:
        return NO_CODE_TEXT if is_private else None

    parts = []
    for value in codes:
        results = lookup_value(value, mode)
        if not results and not is_private:
            continue  # в группах не спамим «не найден»
        parts.append(format_value(value, results, mode))
    if not parts:
        return None
    return Html(SEPARATOR.join(parts))


def short_description(text: str, width: int = 90) -> str:
    for line in text.split("\n"):
        if line.startswith("Описание:"):
            line = line[len("Описание:"):].strip()
            return line if len(line) <= width else line[:width - 1] + "…"
    return text[:width]


# --- подсказки: датчики, упомянутые в описании кода ---------------------------
GRG_DEVICES = ("CRM9250N", "CAM8320", "CDM8240")
SENSOR_TOKEN_RE = re.compile(r"[A-Z][A-Z0-9_]{1,9}")
SENSOR_CALLBACK_PREFIX = "sensor:"


def devices_for(category: str, text: str) -> tuple:
    if category == "cmd_v4":
        return ("CMD-V4",)
    if category == "ccdm":
        return ("CCDM",)
    head = text.split("\n", 1)[0]
    if "CRM9250" in head:
        return ("CRM9250N",)
    if "CDM8240" in head:
        return ("CDM8240",)
    if "CAM83" in head:  # в базе CAM8350, в приложении схема CAM8320
        return ("CAM8320",)
    return GRG_DEVICES


def sensor_hints(category: str, text: str) -> list:
    """[(устройство, имя датчика)] для датчиков, названных в описании кода."""
    devices = devices_for(category, text)
    hints = []
    for token in SENSOR_TOKEN_RE.findall(text):
        for hit in schemes.find_sensor(token):
            pair = (hit["scheme"]["device"], hit["name"])
            if pair[0] in devices and pair not in hints:
                hints.append(pair)
    return hints


def hints_for_text(text: str, mode=None) -> list:
    hints = []
    for value in extract_codes(text):
        for category, _, description, _ in lookup_value(value, mode):
            for pair in sensor_hints(category, description):
                if pair not in hints:
                    hints.append(pair)
    return hints


MAX_AUTO_SCHEMES = 4


def hint_photo_actions(hints: list) -> list:
    """Схемы с отмеченными датчиками из описания: по картинке на схему, все датчики на ней сразу."""
    by_image: dict = {}
    for device, name in hints:
        for hit in schemes.find_sensor(name):
            if hit["scheme"]["device"] != device:
                continue
            entry = by_image.setdefault(hit["scheme"]["image"], {"scheme": hit["scheme"], "names": [], "points": []})
            if hit["name"] not in entry["names"]:
                entry["names"].append(hit["name"])
                entry["points"].extend(hit["points"])
    actions = []
    for image_id, entry in list(by_image.items())[:MAX_AUTO_SCHEMES]:
        label = "Датчик" if len(entry["names"]) == 1 else "Датчики"
        caption = f"{label} {', '.join(entry['names'])}: {schemes.scheme_title(entry['scheme'])}"
        actions.append(_photo(lambda i=image_id, pts=entry["points"]: schemes.render_markers(i, pts),
                              caption))
    return actions


def hints_line(hints: list) -> str:
    names = ", ".join(f"<b>{esc(name)}</b> ({esc(device)})" for device, name in hints)
    return f"📍 Датчики из описания: {names}. Отметил на схеме ниже 👇"


def sensor_callback_actions(data: str) -> list:
    device, _, name = data[len(SENSOR_CALLBACK_PREFIX):].partition(":")
    hits = [h for h in schemes.find_sensor(name) if h["scheme"]["device"] == device]
    return [
        _photo(lambda h=hit: schemes.render_markers(h["scheme"]["image"], h["points"]),
               schemes.sensor_caption(hit))
        for hit in hits
    ]


# --- схемы -----------------------------------------------------------------
# Ответ — список действий: ("text", текст, клавиатура) или ("photo", картинка, подпись),
# где картинка — функция, рисующая JPEG только перед отправкой.

def _text(text, markup=None):
    return ("text", text, markup)


def _photo(render, caption):
    return ("photo", render, caption)


def sensor_actions(name: str, is_private: bool = True) -> list:
    hits = schemes.find_sensor(name)
    if not hits:
        if not is_private:
            return []
        return [_text(Html(f"❓ Датчик «{esc(name)}» не найден. Список датчиков: /sensor"))]
    return [
        _photo(lambda h=hit: schemes.render_markers(h["scheme"]["image"], h["points"]),
               schemes.sensor_caption(hit))
        for hit in hits
    ]


# Группы устройств для меню /sensor и /schemes: id -> (кнопка, устройства схем, префиксы галереи).
DEVICE_GROUPS = {
    "ccdm": ("CCDM", ("CCDM",), ("CCDM",)),
    "cmd": ("CMD-V4", ("CMD-V4",), ("CMD-V4",)),
    "grg": ("GRG", ("CRM9250N", "CAM8320", "CDM8240"), ("CRM9250", "CAM8320", "CDM8240")),
    "crs": ("Recycler", ("CRS 4060 FL",), ("CRS 4060 FL",)),
}
ALL_GROUP = "all"
SENSOR_LIST_PREFIX = "slist:"
SCHEME_MENU_PREFIX = "smenu:"
BACK = "back"
SENSOR_MENU_TEXT = Html("📍 <b>Где искать датчик?</b>\n"
                        "Выбери устройство или сразу пришли название: <code>SF01</code>.")
SCHEME_MENU_TEXT = Html("🗺 <b>Схемы какого устройства показать?</b>")
GROUP_ICONS = {"ccdm": "📥", "cmd": "📤", "grg": "🏧", "crs": "♻️"}


def group_menu_keyboard(prefix: str) -> dict:
    buttons = [{"text": f"{GROUP_ICONS.get(gid, '')} {title}".strip(), "callback_data": f"{prefix}{gid}"}
               for gid, (title, _, _) in DEVICE_GROUPS.items()]
    rows = [buttons[i:i + 2] for i in range(0, len(buttons), 2)]
    rows.append([{"text": "🌐 Всё сразу", "callback_data": f"{prefix}{ALL_GROUP}"}])
    return {"inline_keyboard": rows}


def back_keyboard(prefix: str) -> dict:
    return {"inline_keyboard": [[{"text": "« Назад", "callback_data": f"{prefix}{BACK}"}]]}


def sensor_list_text(group: str = ALL_GROUP) -> Html:
    devices = None if group == ALL_GROUP else DEVICE_GROUPS[group][1]
    blocks = []
    example = "SF01"
    for scheme_device, names in schemes.list_sensor_names().items():
        if devices is not None and not scheme_device.endswith(devices):
            continue
        if not blocks:
            example = names[0]
        blocks.append(f"<b>{esc(scheme_device)}</b> ({len(names)})\n{esc(', '.join(names))}")
    header = (f"📍 Пришли название датчика, например <code>{esc(example)}</code> "
              f"или /sensor {esc(example)}.")
    return Html("\n\n".join([header] + blocks))


def sensor_list_callback(chat_id: int, message_id, data: str) -> None:
    group = data[len(SENSOR_LIST_PREFIX):]
    if group == BACK:
        edit_message(chat_id, message_id, SENSOR_MENU_TEXT, group_menu_keyboard(SENSOR_LIST_PREFIX))
        return
    if group != ALL_GROUP and group not in DEVICE_GROUPS:
        return
    # Режем по строкам, а теги в каждой строке закрыты, поэтому куски остаются Html.
    chunks = [Html(chunk) for chunk in guides.split_text(sensor_list_text(group))]
    back = back_keyboard(SENSOR_LIST_PREFIX)
    if len(chunks) == 1:
        edit_message(chat_id, message_id, chunks[0], back)
        return
    # Длинный список: первый кусок в это же сообщение, остальные новыми, «Назад» под последним.
    edit_message(chat_id, message_id, chunks[0])
    for chunk in chunks[1:-1]:
        send_message(chat_id, chunk)
    send_message(chat_id, chunks[-1], back)


def gallery_indexes(group: str = ALL_GROUP) -> list:
    if group == ALL_GROUP:
        return list(range(len(schemes.GALLERY)))
    prefixes = DEVICE_GROUPS[group][2]
    return [i for i, item in enumerate(schemes.GALLERY) if item["title"].startswith(prefixes)]


def schemes_keyboard(group: str = ALL_GROUP) -> dict:
    buttons = [
        {"text": schemes.GALLERY[i]["title"], "callback_data": f"{SCHEME_CALLBACK_PREFIX}{i}"}
        for i in gallery_indexes(group)
    ]
    rows = [buttons[i:i + 2] for i in range(0, len(buttons), 2)]
    rows.append([{"text": "« Назад", "callback_data": f"{SCHEME_MENU_PREFIX}{BACK}"}])
    return {"inline_keyboard": rows}


def scheme_menu_callback(chat_id: int, message_id, data: str) -> None:
    group = data[len(SCHEME_MENU_PREFIX):]
    if group == BACK:
        edit_message(chat_id, message_id, SCHEME_MENU_TEXT, group_menu_keyboard(SCHEME_MENU_PREFIX))
    elif group == ALL_GROUP or group in DEVICE_GROUPS:
        title = "все устройства" if group == ALL_GROUP else DEVICE_GROUPS[group][0]
        edit_message(chat_id, message_id, Html(f"🗺 <b>Схемы: {esc(title)}</b>\nВыбери схему:"),
                     schemes_keyboard(group))


def gallery_actions(data: str) -> list:
    raw = data[len(SCHEME_CALLBACK_PREFIX):]
    if not raw.isdigit() or int(raw) >= len(schemes.GALLERY):
        return []
    item = schemes.GALLERY[int(raw)]
    return [_photo(lambda: schemes.load_image_bytes(item["image"]), item["title"])]


# --- инструкции по настройке (/guides) ----------------------------------------
GUIDE_CALLBACK_PREFIX = "guide:"
GUIDES_TEXT = Html("📚 <b>Инструкции по настройке банкоматов</b>")


def guides_keyboard() -> dict:
    return {"inline_keyboard": [
        [{"text": g["title"], "callback_data": f"{GUIDE_CALLBACK_PREFIX}{gid}"}]
        for gid, g in guides.GUIDES.items()
    ]}


def guide_sections_keyboard(guide_id: str) -> dict:
    rows = [[{"text": sec["title"], "callback_data": f"{GUIDE_CALLBACK_PREFIX}{guide_id}:{i}"}]
            for i, sec in enumerate(guides.GUIDES[guide_id]["sections"])]
    if guides.full_file(guide_id):
        rows.append([{"text": "📄 Вся инструкция целиком",
                      "callback_data": f"{GUIDE_CALLBACK_PREFIX}{guide_id}:all"}])
    rows.append([{"text": "« Все инструкции", "callback_data": f"{GUIDE_CALLBACK_PREFIX}root"}])
    return {"inline_keyboard": rows}


def guide_nav_keyboard(guide_id: str, index: int) -> dict:
    total = len(guides.GUIDES[guide_id]["sections"])
    row = []
    if index > 0:
        row.append({"text": "◀ Назад", "callback_data": f"{GUIDE_CALLBACK_PREFIX}{guide_id}:{index - 1}"})
    if index + 1 < total:
        row.append({"text": "Дальше ▶", "callback_data": f"{GUIDE_CALLBACK_PREFIX}{guide_id}:{index + 1}"})
    return {"inline_keyboard": [row, [{"text": "☰ Разделы",
                                       "callback_data": f"{GUIDE_CALLBACK_PREFIX}{guide_id}"}]]}


def guide_section_actions(guide_id: str, index: int) -> list:
    sec = guides.section(guide_id, index)
    if sec is None:
        return []
    guide = guides.GUIDES[guide_id]
    total = len(guide["sections"])
    actions = [_text(Html(f"📘 <b>{esc(guide['title'])}</b>\n"
                          f"<b>{esc(sec['title'])}</b> · {index + 1}/{total}"))]
    for kind, value in sec["blocks"]:
        if kind == "img":
            path = guides.image_path(value)
            if path.is_file():
                actions.append(_photo(lambda p=path: p.read_bytes(), ""))
        else:
            actions.extend(_text(chunk) for chunk in guides.split_text(value))
    actions.append(_text(f"📘 Раздел {index + 1} из {total}", guide_nav_keyboard(guide_id, index)))
    return actions


def guide_full_keyboard(guide_id: str) -> dict:
    rows = [[{"text": "📜 Текстом в чат (все разделы)",
              "callback_data": f"{GUIDE_CALLBACK_PREFIX}{guide_id}:text"}]]
    if guides.full_file(guide_id):
        rows.insert(0, [{"text": "📄 Файлом", "callback_data": f"{GUIDE_CALLBACK_PREFIX}{guide_id}:file"}])
    rows.append([{"text": "« Разделы", "callback_data": f"{GUIDE_CALLBACK_PREFIX}{guide_id}"}])
    return {"inline_keyboard": rows}


def guide_full_actions(guide_id: str, start: int = 0) -> list:
    """Вся инструкция подряд: [(номер раздела, действие)]. Текст склеен в крупные сообщения."""
    guide = guides.GUIDES[guide_id]
    total = len(guide["sections"])
    result = []
    for index in range(start, total):
        sec = guide["sections"][index]
        pending = f"▶ {sec['title']} ({index + 1}/{total})"
        if index == start:
            pending = f"📘 {guide['title']}\n\n{pending}"
        for kind, value in sec["blocks"]:
            if kind == "img":
                path = guides.image_path(value)
                if not path.is_file():
                    continue
                for chunk in guides.split_text(pending):
                    result.append((index, _text(chunk)))
                pending = ""
                result.append((index, _photo(lambda p=path: p.read_bytes(), "")))
            else:
                pending = f"{pending}\n\n{value}" if pending else value
        for chunk in guides.split_text(pending) if pending.strip() else []:
            result.append((index, _text(chunk)))
    return result


# Vercel и Telegram не ждут бесконечно: если инструкция не успела уйти целиком,
# присылаем кнопку «Продолжить» с того раздела, на котором остановились.
FULL_GUIDE_TIME_BUDGET = 40.0


def send_full_guide(chat_id: int, guide_id: str, start: int = 0, budget=None) -> None:
    budget = FULL_GUIDE_TIME_BUDGET if budget is None else budget
    deadline = time.monotonic() + budget
    total = len(guides.GUIDES[guide_id]["sections"])
    current = None
    for index, action in guide_full_actions(guide_id, start):
        if index != current:
            if current is not None and time.monotonic() > deadline:
                send_message(chat_id, f"Отправлено разделов: {index} из {total}.", {"inline_keyboard": [[
                    {"text": f"Продолжить с раздела {index + 1} ▶",
                     "callback_data": f"{GUIDE_CALLBACK_PREFIX}{guide_id}:from{index}"}]]})
                return
            current = index
        perform(chat_id, [action])
    send_message(chat_id, "✅ Инструкция целиком отправлена.", {"inline_keyboard": [[
        {"text": "☰ Разделы", "callback_data": f"{GUIDE_CALLBACK_PREFIX}{guide_id}"},
        {"text": "« Все инструкции", "callback_data": f"{GUIDE_CALLBACK_PREFIX}root"}]]})


def guide_callback(chat_id: int, message_id, data: str) -> None:
    step = data[len(GUIDE_CALLBACK_PREFIX):]
    guide_id, _, raw_index = step.partition(":")
    if step == "root" and message_id is not None:
        edit_message(chat_id, message_id, GUIDES_TEXT, guides_keyboard())
    elif guide_id in guides.GUIDES and not raw_index:
        title = guides.GUIDES[guide_id]["title"]
        send_message(chat_id, Html(f"📘 <b>{esc(title)}</b>\nВыбери раздел:"), guide_sections_keyboard(guide_id))
    elif guide_id in guides.GUIDES and raw_index == "all":
        title = guides.GUIDES[guide_id]["title"]
        text = Html(f"📘 <b>{esc(title)}</b>\nКак прислать всю инструкцию?")
        if message_id is not None:
            edit_message(chat_id, message_id, text, guide_full_keyboard(guide_id))
        else:
            send_message(chat_id, text, guide_full_keyboard(guide_id))
    elif guide_id in guides.GUIDES and raw_index == "file":
        path = guides.full_file(guide_id)
        if path:
            send_document(chat_id, path, guides.GUIDES[guide_id]["title"])
    elif guide_id in guides.GUIDES and raw_index == "text":
        send_full_guide(chat_id, guide_id)
    elif guide_id in guides.GUIDES and raw_index.startswith("from") and raw_index[4:].isdigit():
        start = int(raw_index[4:])
        if start < len(guides.GUIDES[guide_id]["sections"]):
            send_full_guide(chat_id, guide_id, start)
    elif guide_id in guides.GUIDES and raw_index.isdigit():
        perform(chat_id, guide_section_actions(guide_id, int(raw_index)))


# --- меню выбора банкомата ---------------------------------------------------
# Vercel не хранит состояние между запросами, поэтому выбранный режим живёт
# в самой переписке: каждое сообщение бота в режиме начинается с заголовка
# MODE_HEADER и просит ответить на него (force_reply). Ответ пользователя
# приходит с reply_to_message — по его заголовку и понимаем режим.
MENU_CALLBACK_PREFIX = "menu:"
MODE_HEADER = "🏧 Банкомат: "
MENU_TEXT = Html("🏧 <b>Выбери производителя банкомата</b>")
WINCOR_TEXT = Html("🏧 <b>Wincor</b>: выбери модуль")


def menu_keyboard() -> dict:
    return {"inline_keyboard": [
        [{"text": "🏧 GRG", "callback_data": "menu:mode:grg"},
         {"text": "🏧 Wincor", "callback_data": "menu:wincor"}],
        [{"text": "🌐 Все базы сразу", "callback_data": "menu:mode:all"}],
        [{"text": "🧹 Очистить историю", "callback_data": "menu:clear"}],
    ]}


# Telegram не даёт боту список сообщений чата, но id в личке идут подряд:
# удаляем диапазон id перед кнопкой. Сообщения старше 48 часов Telegram
# удалить не даст, их он молча пропустит.
CLEAR_DEPTH = 1000
CLEAR_CONFIRM_TEXT = Html("🧹 <b>Удалить переписку с ботом в этом чате?</b>\n"
                          "Удалятся и твои сообщения, и ответы бота. "
                          "Telegram позволяет удалить только сообщения моложе 48 часов.")
CLEAR_ONLY_PRIVATE = "Очистка истории работает только в личном чате с ботом."


def clear_keyboard() -> dict:
    return {"inline_keyboard": [[{"text": "🧹 Да, очистить", "callback_data": "menu:clear:yes"},
                                 {"text": "✖️ Отмена", "callback_data": "menu:root"}]]}


def clear_history(chat_id: int, last_message_id: int) -> None:
    first = max(1, last_message_id - CLEAR_DEPTH)
    delete_messages(chat_id, list(range(first, last_message_id + 1)))
    send_message(chat_id, Html("✅ История очищена (сообщения за последние 48 часов).\n\n" + MENU_TEXT),
                 menu_keyboard())


def wincor_keyboard() -> dict:
    return {"inline_keyboard": [
        [{"text": "📥 CCDM (кеш-ин)", "callback_data": "menu:mode:ccdm"},
         {"text": "📤 CMD-V4 (кеш-аут)", "callback_data": "menu:mode:cmd_v4"}],
        [{"text": "« Назад", "callback_data": "menu:root"}],
    ]}


def mode_markup(mode: str) -> dict:
    return {"force_reply": True,
            "input_field_placeholder": f"Код ошибки {MODES[mode]['title']}"[:64]}


def mode_header(mode: str) -> str:
    return f"{MODE_HEADER}{MODES[mode]['title']}"


def mode_from_text(text: str):
    """Режим по заголовку сообщения бота, на которое ответил пользователь."""
    # Telegram возвращает текст без разметки, а в тестах и старых сообщениях она может быть.
    first_line = strip_html((text or "").split("\n", 1)[0])
    for mode in MODES:
        if first_line == mode_header(mode):
            return mode
    return None


def mode_from_message(message: dict):
    replied = message.get("reply_to_message") or {}
    if not (replied.get("from") or {}).get("is_bot"):
        return None
    return mode_from_text(replied.get("text") or replied.get("caption") or "")


def mode_selected_text(mode: str) -> Html:
    return Html(f"<b>{esc(mode_header(mode))}</b>\n"
                f"🔢 Пришли код ошибки (например <code>{esc(MODES[mode]['hint'])}</code>) "
                f"ответом на это сообщение, поищу только в базе {esc(MODES[mode]['title'])}.\n"
                "Сменить банкомат: /menu")


# --- хранение выбранного режима (Upstash Redis, необязательно) ----------------
# Если в Vercel подключён Upstash Redis, режим запоминается для каждого
# пользователя в каждом чате, и отвечать на сообщения бота не нужно.
# Без переменных окружения бот работает как раньше — через ответы.
REDIS_URL = (os.environ.get("KV_REST_API_URL")
             or os.environ.get("UPSTASH_REDIS_REST_URL") or "").rstrip("/")
REDIS_TOKEN = os.environ.get("KV_REST_API_TOKEN") or os.environ.get("UPSTASH_REDIS_REST_TOKEN") or ""
MODE_ALL = "all"


def storage_enabled() -> bool:
    return bool(REDIS_URL and REDIS_TOKEN)


def redis_command(*args):
    """Команда Redis через REST API Upstash. (ok, result); при любой ошибке ok=False."""
    if not storage_enabled():
        return False, None
    try:
        resp = requests.post(REDIS_URL, json=[str(a) for a in args],
                             headers={"Authorization": f"Bearer {REDIS_TOKEN}"}, timeout=3)
        body = resp.json()
    except (requests.RequestException, ValueError):
        return False, None
    if resp.status_code != 200 or "error" in body:
        return False, None
    return True, body.get("result")


def _mode_key(chat_id, user_id) -> str:
    return f"botsabyr:mode:{chat_id}:{user_id or 0}"


def load_mode(chat_id, user_id):
    ok, value = redis_command("GET", _mode_key(chat_id, user_id))
    return value if ok and value in MODES else None


def save_mode(chat_id, user_id, mode: str) -> bool:
    ok, _ = redis_command("SET", _mode_key(chat_id, user_id), mode)
    return ok


def saved_mode_text(mode: str) -> Html:
    return Html(f"<b>{esc(mode_header(mode))}</b>\n"
                f"✅ Запомнил. Присылай коды (например <code>{esc(MODES[mode]['hint'])}</code>), "
                f"ищу только в базе {esc(MODES[mode]['title'])}.\nСменить банкомат: /menu")


def menu_callback(chat_id: int, message_id, data: str, user_id=None, is_private=True) -> None:
    """Нажатие кнопки меню: переход по экранам или выбор режима."""
    step = data[len(MENU_CALLBACK_PREFIX):]
    if step.startswith("clear") and not is_private:
        send_message(chat_id, CLEAR_ONLY_PRIVATE)
    elif step == "clear" and message_id is not None:
        edit_message(chat_id, message_id, CLEAR_CONFIRM_TEXT, clear_keyboard())
    elif step == "clear:yes" and message_id is not None:
        clear_history(chat_id, message_id)
    elif step == "root" and message_id is not None:
        edit_message(chat_id, message_id, MENU_TEXT, menu_keyboard())
    elif step == "wincor" and message_id is not None:
        edit_message(chat_id, message_id, WINCOR_TEXT, wincor_keyboard())
    elif step == "mode:" + MODE_ALL:
        save_mode(chat_id, user_id, MODE_ALL)
        send_message(chat_id, Html("🌐 <b>Режим: все базы</b>\n"
                                   "Просто присылай коды, поищу в GRG, CMD-V4 и CCDM. Меню: /menu"))
    elif step.startswith("mode:") and step[5:] in MODES:
        mode = step[5:]
        if save_mode(chat_id, user_id, mode):
            send_message(chat_id, saved_mode_text(mode))
        else:
            send_message(chat_id, mode_selected_text(mode), mode_markup(mode))


def build_actions(text: str, is_private: bool, mode=None, remembered: bool = False) -> list:
    """Всё, что бот должен отправить в ответ на сообщение."""
    text = (text or "").strip()

    if text.startswith("/"):
        command, _, arg = text.partition(" ")
        command = command.split("@")[0].lower()
        arg = arg.strip()
        if command == "/start":
            return [_text(START_TEXT, menu_keyboard())]
        if command == "/menu":
            return [_text(MENU_TEXT, menu_keyboard())]
        if command == "/clear":
            if not is_private:
                return [_text(CLEAR_ONLY_PRIVATE)]
            return [_text(CLEAR_CONFIRM_TEXT, clear_keyboard())]
        if command == "/guides":
            return [_text(GUIDES_TEXT, guides_keyboard())]
        if command == "/sensor":
            return (sensor_actions(arg) if arg
                    else [_text(SENSOR_MENU_TEXT, group_menu_keyboard(SENSOR_LIST_PREFIX))])
        if command == "/schemes":
            return [_text(SCHEME_MENU_TEXT, group_menu_keyboard(SCHEME_MENU_PREFIX))]

    actions = []
    sensors = []
    if not text.startswith("/"):
        sensors = schemes.find_sensors_in_text(text, strict_case=not is_private)
    codes = extract_codes(text)
    if not sensors or codes:
        reply = build_reply(text, is_private, mode)
        # Без хранилища в режиме снова просим ответ (force_reply), иначе можно кнопки.
        force = bool(reply and mode and not remembered)
        markup = mode_markup(mode) if force else None
        hints = hints_for_text(text, mode) if reply and codes else []
        # Датчик, который и так назван в сообщении, придёт ниже отдельно.
        hints = [h for h in hints if schemes.normalize_name(h[1]) not in sensors]
        if hints:
            reply = Html(f"{reply}\n\n{hints_line(hints)}")
        if reply and mode:
            actions.append(_text(Html(f"<b>{esc(mode_header(mode))}</b>\n\n{reply}"), markup))
        elif reply:
            actions.append(_text(reply, markup))
        actions.extend(hint_photo_actions(hints))
    for key in sensors:
        actions.extend(sensor_actions(key, is_private))
    return actions


def perform(chat_id: int, actions: list) -> None:
    for kind, payload, extra in actions:
        if kind == "text":
            if extra:
                send_message(chat_id, payload, extra)
            else:
                send_message(chat_id, payload)
        else:
            send_photo(chat_id, payload(), extra)


def is_duplicate_update(update_id) -> bool:
    """Telegram повторяет апдейт, если ответ задержался (например, длинная инструкция).
    С подключённым Redis такой повтор пропускаем, без Redis проверки нет."""
    if update_id is None or not storage_enabled():
        return False
    ok, result = redis_command("SET", f"botsabyr:upd:{update_id}", "1", "NX", "EX", "3600")
    return ok and result is None


# --- меню команд и инлайн-режим ----------------------------------------------
BOT_COMMANDS = [
    ("menu", "Выбрать банкомат (GRG / Wincor)"),
    ("sensor", "Датчик на схеме"),
    ("schemes", "Все схемы устройств"),
    ("guides", "Инструкции по настройке (NCR, CINEO, GRG)"),
    ("clear", "Очистить историю чата с ботом"),
    ("help", "Справка"),
]
_commands_set = False


def ensure_commands() -> None:
    """Один раз за запуск сервера ставим меню команд рядом с полем ввода."""
    global _commands_set
    if _commands_set or not BOT_TOKEN:
        return
    _commands_set = True
    try:
        requests.post(
            f"{TELEGRAM_API}/setMyCommands",
            json={"commands": [{"command": c, "description": d} for c, d in BOT_COMMANDS]},
            timeout=5,
        )
    except requests.RequestException:
        _commands_set = False


MAX_INLINE_RESULTS = 20


def inline_results(query: str) -> list:
    """Результаты для @бот <код>."""
    query = (query or "").strip()
    items = []
    codes = extract_codes(query)
    if codes:
        for value in codes:
            for category, key, text, sign_matches in lookup_value(value):
                items.append((category, key, text, sign_matches, value))
    results = []
    for i, (category, key, text, sign_matches, value) in enumerate(items[:MAX_INLINE_RESULTS]):
        title = f"[{CATEGORY_TITLES[category]}] код {key}"
        note = "" if sign_matches else f" (введено {value}, показан код с другим знаком)"
        results.append({
            "type": "article",
            "id": f"{category}:{key}:{i}"[:64],
            "title": title,
            "description": short_description(text, 120),
            "input_message_content": {"message_text": f"{title}{note}\n{text}"[:4000]},
        })
    return results


def answer_inline(inline_query_id: str, results: list) -> None:
    try:
        requests.post(
            f"{TELEGRAM_API}/answerInlineQuery",
            json={"inline_query_id": inline_query_id, "results": results, "cache_time": 300},
            timeout=10,
        )
    except requests.RequestException:
        pass


@app.post("/webhook")
async def webhook(request: Request):
    update = await request.json()
    if is_duplicate_update(update.get("update_id")):
        return {"ok": True}
    ensure_commands()

    inline = update.get("inline_query")
    if inline:
        answer_inline(inline.get("id", ""), inline_results(inline.get("query", "")))
        return {"ok": True}

    callback = update.get("callback_query")
    if callback:
        answer_callback(callback.get("id", ""))
        chat_id = ((callback.get("message") or {}).get("chat") or {}).get("id")
        data = callback.get("data") or ""
        if chat_id is not None and data.startswith(SCHEME_CALLBACK_PREFIX):
            perform(chat_id, gallery_actions(data))
        elif chat_id is not None and data.startswith(GUIDE_CALLBACK_PREFIX):
            guide_callback(chat_id, (callback.get("message") or {}).get("message_id"), data)
        elif chat_id is not None and data.startswith(SENSOR_LIST_PREFIX):
            sensor_list_callback(chat_id, (callback.get("message") or {}).get("message_id"), data)
        elif chat_id is not None and data.startswith(SCHEME_MENU_PREFIX):
            scheme_menu_callback(chat_id, (callback.get("message") or {}).get("message_id"), data)
        elif chat_id is not None and data.startswith(SENSOR_CALLBACK_PREFIX):
            perform(chat_id, sensor_callback_actions(data))
        elif chat_id is not None and data.startswith(MENU_CALLBACK_PREFIX):
            cb_chat = (callback.get("message") or {}).get("chat") or {}
            menu_callback(chat_id, (callback.get("message") or {}).get("message_id"), data,
                          (callback.get("from") or {}).get("id"),
                          cb_chat.get("type", "private") == "private")
        return {"ok": True}

    message = update.get("message")
    if not message:
        # edited_message и прочие апдейты игнорируем, чтобы не отвечать повторно
        return {"ok": True}

    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    if chat_id is None:
        return {"ok": True}
    is_private = chat.get("type", "private") == "private"

    text = message.get("text") or message.get("caption") or ""
    mode = mode_from_message(message)
    remembered = False
    if mode is None and not text.lstrip().startswith("/"):
        user_id = (message.get("from") or {}).get("id")
        mode = load_mode(chat_id, user_id)
        remembered = mode is not None
    perform(chat_id, build_actions(text, is_private, mode, remembered))

    return {"ok": True}
