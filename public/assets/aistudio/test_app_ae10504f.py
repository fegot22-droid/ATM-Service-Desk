import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import app  # noqa: E402


def keys(text):
    return [(c, k, ok) for c, k, _, ok in
            [r for v in app.extract_codes(text) for r in app.lookup_value(v)]]


@pytest.mark.parametrize("text, expected", [
    ("-1335", [-1335]),
    ("−1335", [-1335]),   # типографский минус
    ("–1335", [-1335]),   # тире
    ("—1335", [-1335]),
    ("- 1335", [-1335]),
    ("-1335.", [-1335]),
    ("код 1335", [1335]),
    ("-1335 -1334", [-1335, -1334]),
    ("1335, 1334", [1335, 1334]),
    ("1,335", [1335]),
    ("008", [8]),
    ("abc-12", []),
    ("", []),
    ("привет", []),
])
def test_extract_codes(text, expected):
    assert app.extract_codes(text) == expected


def test_leading_zeros_find_cmd_and_ccdm():
    for text in ("8", "08", "008", "0008"):
        found = {(c, k) for c, k, _ in keys(text)}
        assert ("cmd_v4", "08") in found and ("ccdm", "08") in found, text


def test_positive_input_shows_both_grg_signs():
    assert keys("1323")[:2] == [("grg", "1323", True), ("grg", "-1323", False)]


def test_negative_input_shows_exact_grg_only():
    grg = [r for r in keys("-1323") if r[0] == "grg"]
    assert grg == [("grg", "-1323", True)]


def test_sign_flip_is_marked():
    assert keys("8")[0] == ("grg", "-8", False)
    reply = app.build_reply("8", is_private=True)
    assert "другим знаком" in reply


def test_negative_input_still_finds_cmd():
    assert ("cmd_v4", "08", False) in keys("-8")


@pytest.mark.parametrize("text", ["/start", "/START", "/start@my_bot", "/start deeplink"])
def test_start_variants(text):
    assert app.build_reply(text, True) == app.START_TEXT


@pytest.mark.parametrize("text", ["/help", "/help@my_bot", "/Help"])
def test_help_variants(text):
    assert app.build_reply(text, True) == app.build_help_text()


def test_unknown_command():
    assert "Не знаю такой команды" in app.build_reply("/foo", True)
    assert app.build_reply("/foo", False) is None


def test_no_text_private_and_group():
    assert app.build_reply("", True) == app.NO_CODE_TEXT
    assert app.build_reply("", False) is None


def test_group_is_quiet_without_matches():
    assert app.build_reply("всем привет", False) is None
    assert app.build_reply("77777", False) is None
    assert "-1335" in app.build_reply("смотрите -1335", False)


def test_not_found_private():
    assert "не найден" in app.build_reply("77777", True)


def test_multiple_codes_in_one_message():
    reply = app.build_reply("-1335 -1334", True)
    assert "код -1335" in reply and "код -1334" in reply


# --- webhook ---

@pytest.fixture
def client(monkeypatch):
    sent = []
    monkeypatch.setattr(app, "send_message", lambda chat_id, text, markup=None: sent.append((chat_id, text)))
    monkeypatch.setattr(app, "send_photo", lambda chat_id, photo, caption="": sent.append((chat_id, ("photo", photo, caption))))
    monkeypatch.setattr(app, "answer_callback", lambda callback_id: None)
    monkeypatch.setattr(app, "send_document",
                        lambda chat_id, path, caption="": sent.append((chat_id, ("document", path, caption))))
    monkeypatch.setattr(app, "edit_message",
                        lambda chat_id, message_id, text, markup=None: sent.append((chat_id, ("edit", text, markup))))
    return TestClient(app.app), sent


def post(c, message):
    return c.post("/webhook", json={"update_id": 1, **message})


def test_webhook_answers_code(client):
    c, sent = client
    post(c, {"message": {"chat": {"id": 5, "type": "private"}, "text": "-1335"}})
    assert sent and sent[0][0] == 5 and "код -1335" in sent[0][1]


def test_webhook_sticker_gets_hint(client):
    c, sent = client
    post(c, {"message": {"chat": {"id": 5, "type": "private"}, "sticker": {}}})
    assert sent == [(5, app.NO_CODE_TEXT)]


def test_webhook_photo_caption_is_used(client):
    c, sent = client
    post(c, {"message": {"chat": {"id": 5, "type": "private"}, "caption": "08"}})
    assert "код 08" in sent[0][1]


def test_webhook_ignores_edits_and_group_chatter(client):
    c, sent = client
    post(c, {"edited_message": {"chat": {"id": 5, "type": "private"}, "text": "-1335"}})
    post(c, {"message": {"chat": {"id": -9, "type": "group"}, "text": "всем привет"}})
    assert sent == []


def test_health():
    assert TestClient(app.app).get("/").json() == {"status": "ok"}


# --- схемы ---

import io  # noqa: E402

from PIL import Image  # noqa: E402

import schemes  # noqa: E402


def photos(sent):
    return [item[1] for item in sent if isinstance(item[1], tuple)]


def test_all_scheme_images_exist():
    for image_id in schemes.SCHEMES["images"]:
        assert schemes.image_path(image_id).is_file(), image_id
    for scheme in schemes.SCHEMES["sensor_schemes"]:
        for _, x, y in scheme["markers"]:
            assert 0 <= x <= 1 and 0 <= y <= 1


@pytest.mark.parametrize("name, device", [
    ("SF01", "CRM9250N"), ("sf01", "CRM9250N"), ("PES", "CDM8240"),
    ("VLS12", "CCDM"), ("vls 12", "CCDM"), ("KLS2-5", "CCDM"), ("Print head", "CCDM"),
    ("PS27", "CMD-V4"), ("BUE4", "CAM8320"), ("ССЕ1", "CCDM"),
])
def test_find_sensor(name, device):
    hits = schemes.find_sensor(name)
    assert hits and hits[0]["scheme"]["device"] == device


def test_cmd_v4_sensor_on_both_orientations():
    parts = {h["scheme"]["part"] for h in schemes.find_sensor("PS27")}
    assert parts == {"Horizontal", "Vertical"}


def test_render_markers_returns_jpeg():
    hit = schemes.find_sensor("SF01")[0]
    data = schemes.render_markers(hit["scheme"]["image"], hit["points"])
    with Image.open(io.BytesIO(data)) as image:
        assert image.format == "JPEG"


def test_sensors_in_text():
    assert schemes.find_sensors_in_text("сработал SF01 и pes") == ["SF01", "PES"]
    assert schemes.find_sensors_in_text("сработал SF01 и pes", strict_case=True) == ["SF01"]
    assert schemes.find_sensors_in_text("всем привет") == []


def test_webhook_sensor_by_name(client):
    c, sent = client
    post(c, {"message": {"chat": {"id": 5, "type": "private"}, "text": "SF01"}})
    shots = photos(sent)
    assert len(sent) == 1 and len(shots) == 1
    assert "SF01" in shots[0][2] and shots[0][1][:2] == b"\xff\xd8"


def test_webhook_sensor_command_and_unknown(client):
    c, sent = client
    post(c, {"message": {"chat": {"id": 5, "type": "private"}, "text": "/sensor@bot pes"}})
    assert "PES" in photos(sent)[0][2]
    post(c, {"message": {"chat": {"id": 5, "type": "private"}, "text": "/sensor QQQ1"}})
    assert "не найден" in sent[-1][1]
    before = len(sent)
    post(c, {"message": {"chat": {"id": 5, "type": "private"}, "text": "/sensor"}})
    assert "SF01" in "".join(item[1] for item in sent[before:])


def test_webhook_code_and_sensor_together(client):
    c, sent = client
    post(c, {"message": {"chat": {"id": 5, "type": "private"}, "text": "-1335 SF01"}})
    assert "код -1335" in sent[0][1] and photos(sent)


def test_group_ignores_lowercase_sensor(client):
    c, sent = client
    post(c, {"message": {"chat": {"id": -9, "type": "group"}, "text": "tes pes"}})
    assert sent == []


def test_schemes_keyboard_and_callback(client):
    keyboard = app.schemes_keyboard()["inline_keyboard"]
    assert sum(len(row) for row in keyboard) == len(schemes.GALLERY) + 1  # + «Назад»
    c, sent = client
    post(c, {"callback_query": {"id": "1", "data": "scheme:0",
                                "message": {"chat": {"id": 5, "type": "private"}}}})
    assert photos(sent)[0][2] == schemes.GALLERY[0]["title"]
    post(c, {"callback_query": {"id": "2", "data": "scheme:999",
                                "message": {"chat": {"id": 5, "type": "private"}}}})
    assert len(sent) == 1


# --- меню выбора банкомата ---

def test_lookup_by_mode():
    assert {r[0] for r in app.lookup_value(8, "ccdm")} == {"ccdm"}
    assert {r[0] for r in app.lookup_value(8, "cmd_v4")} == {"cmd_v4"}
    assert {r[0] for r in app.lookup_value(-1335, "grg")} == {"grg"}
    assert app.lookup_value(-1335, "ccdm") == []
    assert {r[0] for r in app.lookup_value(8)} == {"grg", "cmd_v4", "ccdm"}


def test_mode_header_roundtrip():
    for mode in app.MODES:
        assert app.mode_from_text(app.mode_selected_text(mode)) == mode
    assert app.mode_from_text("что-то другое") is None


def test_menu_flow(client):
    c, sent = client
    post(c, {"message": {"chat": {"id": 5, "type": "private"}, "text": "/menu"}})
    assert sent[-1][1] == app.MENU_TEXT
    post(c, {"callback_query": {"id": "1", "data": "menu:wincor",
                                "message": {"message_id": 10, "chat": {"id": 5}}}})
    assert sent[-1][1][:2] == ("edit", app.WINCOR_TEXT)
    post(c, {"callback_query": {"id": "2", "data": "menu:mode:ccdm",
                                "message": {"message_id": 10, "chat": {"id": 5}}}})
    assert app.mode_from_text(sent[-1][1]) == "ccdm"


def reply_in_mode(mode, text, is_bot=True):
    return {"message": {
        "chat": {"id": 5, "type": "private"}, "text": text,
        "reply_to_message": {"from": {"is_bot": is_bot}, "text": app.mode_selected_text(mode)},
    }}


def test_code_in_mode_searches_only_that_base(client):
    c, sent = client
    post(c, reply_in_mode("ccdm", "08"))
    reply = sent[-1][1]
    assert app.mode_from_text(reply) == "ccdm"  # режим сохраняется в ответе
    assert "CCDM · код 08" in reply and "CMD-V4" not in reply and "GRG · код" not in reply
    post(c, reply_in_mode("cmd_v4", "08"))
    assert "CMD-V4 · код 08" in sent[-1][1] and "CCDM · код" not in sent[-1][1]
    post(c, reply_in_mode("grg", "-1335"))
    assert "не найден" not in sent[-1][1] and "GRG · код -1335" in sent[-1][1]


def test_code_not_found_in_mode(client):
    c, sent = client
    post(c, reply_in_mode("ccdm", "-1335"))
    assert "не найден в базе Wincor CCDM" in sent[-1][1]


def test_reply_to_user_message_does_not_set_mode(client):
    c, sent = client
    post(c, reply_in_mode("ccdm", "08", is_bot=False))
    assert "GRG · код" in sent[-1][1] and app.mode_from_text(sent[-1][1]) is None


# --- запоминание режима (Redis) ---

@pytest.fixture
def fake_redis(monkeypatch):
    store = {}

    def command(*args):
        if args[0] == "SET":
            if "NX" in args[3:] and args[1] in store:
                return True, None
            store[args[1]] = args[2]
            return True, "OK"
        if args[0] == "GET":
            return True, store.get(args[1])
        return False, None

    monkeypatch.setattr(app, "redis_command", command)
    return store


def msg(text, user=7):
    return {"message": {"chat": {"id": 5, "type": "private"}, "from": {"id": user}, "text": text}}


def choose(c, mode, user=7):
    post(c, {"callback_query": {"id": "1", "data": f"menu:mode:{mode}", "from": {"id": user},
                                "message": {"message_id": 10, "chat": {"id": 5}}}})


def test_without_storage_mode_uses_force_reply(client, monkeypatch):
    monkeypatch.setattr(app, "REDIS_URL", "")
    c, sent = client
    choose(c, "ccdm")
    assert "ответом на это сообщение" in sent[-1][1]
    post(c, msg("08"))
    assert "GRG · код" in sent[-1][1]  # режим без ответа не запомнился


def test_saved_mode_applies_without_reply(client, fake_redis):
    c, sent = client
    choose(c, "ccdm")
    assert "Запомнил" in sent[-1][1]
    post(c, msg("08"))
    assert "CCDM · код 08" in sent[-1][1] and "GRG · код" not in sent[-1][1]
    post(c, msg("08", user=8))  # у другого пользователя режим свой
    assert "GRG · код" in sent[-1][1]
    choose(c, "all")
    post(c, msg("08"))
    assert "GRG · код" in sent[-1][1] and "CCDM · код" in sent[-1][1]


def test_saved_mode_does_not_send_force_reply(client, fake_redis, monkeypatch):
    markups = []
    monkeypatch.setattr(app, "send_message", lambda chat_id, text, markup=None: markups.append(markup))
    c, _ = client
    choose(c, "grg")
    post(c, msg("-1335"))
    assert markups == [None, None]


def test_redis_command_disabled_without_env(monkeypatch):
    monkeypatch.setattr(app, "REDIS_URL", "")
    assert app.redis_command("GET", "x") == (False, None)
    assert app.load_mode(1, 2) is None


def test_words_are_not_searched(client):
    c, sent = client
    post(c, {"message": {"chat": {"id": 5, "type": "private"}, "text": "застревание"}})
    assert sent[-1][1] == app.NO_CODE_TEXT
    post(c, {"message": {"chat": {"id": 5, "type": "private"}, "text": "/find jam"}})
    assert "Не знаю такой команды" in sent[-1][1]
    post(c, {"message": {"chat": {"id": 5, "type": "private"}, "text": "/scod 41"}})
    assert "Не знаю такой команды" in sent[-1][1]


def test_group_words_are_not_searched(client):
    c, sent = client
    post(c, {"message": {"chat": {"id": -9, "type": "group"}, "text": "застревание"}})
    assert sent == []


def test_sensor_hints_by_device():
    assert app.hints_for_text("25523") == [("CRM9250N", "SF17")]
    ccdm = app.hints_for_text("21", "ccdm")
    assert ccdm and all(device == "CCDM" for device, _ in ccdm)
    assert app.hints_for_text("-1335") == []


def test_code_with_sensor_shows_scheme_right_away(client, monkeypatch):
    markups = []
    monkeypatch.setattr(app, "send_message", lambda chat_id, text, markup=None: markups.append((text, markup)))
    c, sent = client
    post(c, {"message": {"chat": {"id": 5, "type": "private"}, "text": "25523"}})
    text, markup = markups[-1]
    assert "📍" in text and "SF17" in text and markup is None
    shots = photos(sent)
    assert len(shots) == 1 and "SF17" in shots[0][2] and "CRM9250N" in shots[0][2]
    assert shots[0][1][:2] == b"\xff\xd8"
    # Кнопки из старых сообщений продолжают работать.
    post(c, {"callback_query": {"id": "1", "data": "sensor:CRM9250N:SF17",
                                "message": {"chat": {"id": 5}}}})
    assert "SF17" in photos(sent)[-1][2]


def test_code_without_sensor_sends_no_scheme(client):
    c, sent = client
    post(c, {"message": {"chat": {"id": 5, "type": "private"}, "text": "-1335"}})
    assert photos(sent) == []


def test_sensor_scheme_in_mode_with_force_reply(client, monkeypatch):
    markups = []
    monkeypatch.setattr(app, "send_message", lambda chat_id, text, markup=None: markups.append((text, markup)))
    monkeypatch.setattr(app, "REDIS_URL", "")
    c, sent = client
    post(c, reply_in_mode("grg", "25523"))
    text, markup = markups[-1]
    assert "SF17" in text and markup.get("force_reply")
    assert "SF17" in photos(sent)[-1][2]


def test_ccdm_mode_shows_only_ccdm_schemes():
    expected = {h[0] for h in app.hints_for_text("21", "ccdm")}
    actions = app.build_actions("21", True, "ccdm", remembered=True)
    captions = [a[2] for a in actions if a[0] == "photo"]
    assert captions and all("CCDM" in cap for cap in captions) and expected == {"CCDM"}
    assert len(captions) <= app.MAX_AUTO_SCHEMES


def test_sensor_named_with_code_not_duplicated():
    actions = app.build_actions("25523 SF17", True)
    captions = [a[2] for a in actions if a[0] == "photo"]
    assert len(captions) == len(set(captions)) and any("SF17" in cap for cap in captions)
    assert sum("SF17" in cap for cap in captions) == len(app.schemes.find_sensor("SF17"))


def test_inline_results():
    by_code = app.inline_results("-1335")
    assert by_code and by_code[0]["title"] == "[GRG] код -1335"
    assert app.inline_results("jam") == [] and app.inline_results("") == []
    assert len(app.inline_results("8 21 -1335")) <= app.MAX_INLINE_RESULTS


def test_webhook_inline_query(client, monkeypatch):
    answered = []
    monkeypatch.setattr(app, "answer_inline", lambda qid, results: answered.append((qid, results)))
    c, _ = client
    post(c, {"inline_query": {"id": "q1", "query": "08", "from": {"id": 1}}})
    assert answered[0][0] == "q1" and answered[0][1]


def test_commands_menu_set_once(monkeypatch):
    calls = []
    monkeypatch.setattr(app, "BOT_TOKEN", "x")
    monkeypatch.setattr(app, "_commands_set", False)
    monkeypatch.setattr(app.requests, "post", lambda url, **kw: calls.append((url, kw)))
    app.ensure_commands()
    app.ensure_commands()
    assert len(calls) == 1 and calls[0][0].endswith("/setMyCommands")
    names = [c["command"] for c in calls[0][1]["json"]["commands"]]
    assert {"menu", "sensor", "schemes", "guides", "clear"} <= set(names)
    assert "find" not in names and "scod" not in names
    descriptions = [c["description"] for c in calls[0][1]["json"]["commands"]]
    assert "Датчик на схеме" in descriptions and not any("SF01" in d for d in descriptions)


# --- инструкции /guides ---

import guides  # noqa: E402


def test_guides_loaded_with_images():
    assert list(guides.GUIDES) == ["ncr", "cineo", "grg"]
    for gid, guide in guides.GUIDES.items():
        assert guide["title"] and len(guide["sections"]) >= 5, gid
        for sec in guide["sections"]:
            assert sec["blocks"], sec["title"]
            for kind, value in sec["blocks"]:
                if kind == "img":
                    assert guides.image_path(value).is_file(), value


def test_split_text_limits():
    text = "\n".join("x" * 100 for _ in range(100))
    chunks = guides.split_text(text, 1000)
    assert all(len(c) <= 1000 for c in chunks) and "\n".join(chunks) == text
    assert guides.split_text("y" * 2500, 1000) == ["y" * 1000, "y" * 1000, "y" * 500]


def test_guides_menu_flow(client):
    c, sent = client
    post(c, {"message": {"chat": {"id": 5, "type": "private"}, "text": "/guides"}})
    assert sent[-1][1] == app.GUIDES_TEXT
    post(c, {"callback_query": {"id": "1", "data": "guide:ncr", "message": {"message_id": 3, "chat": {"id": 5}}}})
    assert "Выбери раздел" in sent[-1][1]
    post(c, {"callback_query": {"id": "2", "data": "guide:ncr:1", "message": {"message_id": 3, "chat": {"id": 5}}}})
    texts = [m[1] for m in sent if isinstance(m[1], str)]
    assert any("PROFILE SELECTION" in t for t in texts)
    assert photos(sent)  # скриншоты раздела I
    assert texts[-1].startswith("📘 Раздел 2 из")
    count = len(sent)
    post(c, {"callback_query": {"id": "3", "data": "guide:ncr:999", "message": {"chat": {"id": 5}}}})
    assert len(sent) == count


def test_guide_section_messages_fit_telegram():
    for gid, guide in guides.GUIDES.items():
        for i in range(len(guide["sections"])):
            for kind, payload, _ in app.guide_section_actions(gid, i):
                if kind == "text":
                    assert len(payload) <= app.MAX_MESSAGE_LEN


def test_guide_full_file_button(client):
    for gid in guides.GUIDES:
        assert guides.full_file(gid) is not None, gid
        rows = app.guide_sections_keyboard(gid)["inline_keyboard"]
        assert rows[-2][0]["callback_data"] == f"guide:{gid}:all"
    c, sent = client
    post(c, {"callback_query": {"id": "1", "data": "guide:grg:file", "message": {"chat": {"id": 5}}}})
    kind, path, caption = sent[-1][1]
    assert kind == "document" and path.name == "GRG_nastroika.pdf" and caption.startswith("GRG")


# --- вся инструкция текстом, очистка истории ---

def test_full_guide_choice(client):
    c, sent = client
    post(c, {"callback_query": {"id": "1", "data": "guide:ncr:all",
                                "message": {"message_id": 3, "chat": {"id": 5}}}})
    kind, text, markup = sent[-1][1]
    datas = [b["callback_data"] for row in markup["inline_keyboard"] for b in row]
    assert kind == "edit" and "guide:ncr:file" in datas and "guide:ncr:text" in datas


def test_full_guide_as_text_covers_all_sections(client):
    c, sent = client
    post(c, {"callback_query": {"id": "1", "data": "guide:cineo:text", "message": {"chat": {"id": 5}}}})
    texts = "\n".join(m[1] for m in sent if isinstance(m[1], str))
    for sec in guides.GUIDES["cineo"]["sections"]:
        assert sec["title"] in texts
    assert "Первая инкассация" in texts and "Проверяем выдачу и прием" in texts
    assert len(photos(sent)) == 4
    assert sent[-1][1].startswith("✅")
    assert all(len(m[1]) <= app.MAX_MESSAGE_LEN for m in sent if isinstance(m[1], str))


def test_full_guide_time_budget_offers_continue(client, monkeypatch):
    markups = []
    monkeypatch.setattr(app, "send_message", lambda chat_id, text, markup=None: markups.append((text, markup)))
    c, sent = client
    app.send_full_guide(5, "ncr", budget=-1)  # бюджет исчерпан сразу после первого раздела
    text, markup = markups[-1]
    assert markup["inline_keyboard"][0][0]["callback_data"] == "guide:ncr:from1"
    post(c, {"callback_query": {"id": "1", "data": "guide:ncr:from11", "message": {"chat": {"id": 5}}}})
    assert any("Длинный чек" in t for t, _ in markups)
    assert markups[-1][0].startswith("✅")


def test_clear_history_flow(client, monkeypatch):
    deleted = []
    monkeypatch.setattr(app, "delete_messages", lambda chat_id, ids: deleted.append((chat_id, ids)))
    c, sent = client
    assert any(b["callback_data"] == "menu:clear" for row in app.menu_keyboard()["inline_keyboard"] for b in row)
    post(c, {"callback_query": {"id": "1", "data": "menu:clear",
                                "message": {"message_id": 1500, "chat": {"id": 5, "type": "private"}}}})
    assert sent[-1][1][1] == app.CLEAR_CONFIRM_TEXT
    post(c, {"callback_query": {"id": "2", "data": "menu:clear:yes",
                                "message": {"message_id": 1500, "chat": {"id": 5, "type": "private"}}}})
    chat_id, ids = deleted[-1]
    assert chat_id == 5 and max(ids) == 1500 and min(ids) == 1500 - app.CLEAR_DEPTH
    assert "История очищена" in sent[-1][1]


def test_clear_only_private(client, monkeypatch):
    deleted = []
    monkeypatch.setattr(app, "delete_messages", lambda chat_id, ids: deleted.append(ids))
    c, sent = client
    post(c, {"callback_query": {"id": "2", "data": "menu:clear:yes",
                                "message": {"message_id": 9, "chat": {"id": -9, "type": "group"}}}})
    assert deleted == [] and sent[-1][1] == app.CLEAR_ONLY_PRIVATE
    post(c, {"message": {"chat": {"id": -9, "type": "group"}, "text": "/clear"}})
    assert sent[-1][1] == app.CLEAR_ONLY_PRIVATE


def test_delete_messages_batches(monkeypatch):
    calls = []
    monkeypatch.setattr(app, "tg_post", lambda method, **kw: calls.append((method, kw["json"]["message_ids"])))
    app.delete_messages(5, list(range(1, 251)))
    assert [len(ids) for _, ids in calls] == [100, 100, 50] and calls[0][0] == "deleteMessages"


def test_duplicate_update_skipped(client, fake_redis, monkeypatch):
    monkeypatch.setattr(app, "storage_enabled", lambda: True)
    c, sent = client
    body = {"update_id": 77, "message": {"chat": {"id": 5, "type": "private"}, "text": "-1335"}}
    c.post("/webhook", json=body)
    c.post("/webhook", json=body)
    assert len(sent) == 1


def test_tg_post_retries_on_429(monkeypatch):
    class Resp:
        def __init__(self, code):
            self.status_code = code

        def json(self):
            return {"parameters": {"retry_after": 1}}

    codes = [429, 200]
    monkeypatch.setattr(app.requests, "post", lambda url, **kw: Resp(codes.pop(0)))
    monkeypatch.setattr(app.time, "sleep", lambda s: None)
    assert app.tg_post("sendMessage", json={}).status_code == 200 and codes == []


def test_kls11_and_kls1_1_are_different():
    assert [h["name"] for h in schemes.find_sensor("KLS11")] == ["KLS11"]
    assert [h["name"] for h in schemes.find_sensor("KLS1_1")] == ["KLS1_1"]
    assert [h["name"] for h in schemes.find_sensor("kls1-1")] == ["KLS1_1"]


def test_vls13_alias():
    hits = schemes.find_sensor("VLS13")
    assert {h["scheme"]["part"] for h in hits} == {"Датчики и механизмы - В", "Датчики и механизмы - С"}
    assert all(h["name"] == "VSL13" for h in hits)
    assert schemes.find_sensor("VSL14") == []
    assert schemes.find_sensors_in_text("сработал VLS13") == ["VLS13"]


def test_no_normalized_name_collisions():
    for key, hits in schemes.SENSOR_INDEX.items():
        if key in {schemes.normalize_name(a) for a in schemes.ALIASES}:
            continue
        assert len({h["name"] for h in hits}) == 1, key


# --- схема Recycler CRS 4060 FL ---

def test_crs_sensors_found():
    parts = {h["scheme"]["part"] for h in schemes.find_sensor("AU_BSL6")}
    assert parts == {"Голова: моторы и соленоиды"}
    for name in ("IOT_PS1", "tub_dps3", "VS1_SM5", "RRL3_SL1", "BVM_ENC", "RS1_DPS2", "IOC_HS2a-b"):
        hits = schemes.find_sensor(name)
        assert hits and all(h["scheme"]["device"] == "CRS 4060 FL" for h in hits), name


def test_crs_range_aliases():
    for name in ("TUB_PS1a-d", "TUB_PS1b", "tub_ps1d", "TUB_PS1"):
        assert [h["name"] for h in schemes.find_sensor(name)] == ["TUB_PS1a-d"], name
    # Настоящий датчик не подменяется диапазоном.
    assert [h["name"] for h in schemes.find_sensor("IOT_DPS1a")] == ["IOT_DPS1a"]
    assert schemes.find_sensor("TUB_PS1e") == []


def test_crs_in_gallery_and_list(client):
    titles = [item["title"] for item in schemes.GALLERY]
    assert sum(t.startswith("CRS 4060 FL") for t in titles) == 3
    assert "Wincor CRS 4060 FL" in schemes.list_sensor_names()
    assert "IOT_PS1" in app.sensor_list_text("crs")
    c, sent = client
    post(c, {"message": {"chat": {"id": 5, "type": "private"}, "text": "IOT_PS1"}})
    assert "CRS 4060 FL" in photos(sent)[0][2]


# --- меню устройств в /sensor и /schemes ---

def callback(c, data, message_id=77):
    post(c, {"callback_query": {"id": "1", "data": data,
                                "message": {"message_id": message_id,
                                            "chat": {"id": 5, "type": "private"}}}})


def button_data(markup):
    return [b["callback_data"] for row in markup["inline_keyboard"] for b in row]


def test_sensor_command_offers_devices(monkeypatch, client):
    markups = []
    monkeypatch.setattr(app, "send_message",
                        lambda chat_id, text, markup=None: markups.append((text, markup)))
    c, _ = client
    post(c, {"message": {"chat": {"id": 5, "type": "private"}, "text": "/sensor"}})
    text, markup = markups[0]
    assert "Где искать датчик" in text
    assert button_data(markup) == ["slist:ccdm", "slist:cmd", "slist:grg", "slist:crs", "slist:all"]


@pytest.mark.parametrize("group, present, absent", [
    ("ccdm", "VLS12", "SF01"), ("cmd", "PS27", "VLS12"), ("grg", "SF01", "VLS12"),
    ("crs", "IOT_PS1", "SF01"),
])
def test_sensor_list_by_device(client, group, present, absent):
    c, sent = client
    callback(c, f"slist:{group}")
    assert len(sent) == 1
    _, (kind, text, markup) = sent[0]
    assert kind == "edit" and present in text and absent not in text
    assert button_data(markup) == ["slist:back"]


def test_sensor_list_all_and_back(client):
    c, sent = client
    callback(c, "slist:all")
    texts = [item[1][1] if isinstance(item[1], tuple) else item[1] for item in sent]
    joined = "".join(texts)
    assert all(len(t) <= 4096 for t in texts)
    assert "SF01" in joined and "VLS12" in joined and "IOT_PS1" in joined
    sent.clear()
    callback(c, "slist:back")
    _, (kind, text, markup) = sent[0]
    assert kind == "edit" and "Где искать датчик" in text and "slist:crs" in button_data(markup)
    sent.clear()
    callback(c, "slist:nope")
    assert sent == []


def test_schemes_by_device_and_back(monkeypatch, client):
    markups = []
    monkeypatch.setattr(app, "send_message",
                        lambda chat_id, text, markup=None: markups.append((text, markup)))
    c, sent = client
    post(c, {"message": {"chat": {"id": 5, "type": "private"}, "text": "/schemes"}})
    assert button_data(markups[0][1])[-1] == "smenu:all"
    callback(c, "smenu:crs")
    _, (kind, text, markup) = sent[-1]
    titles = [b["text"] for row in markup["inline_keyboard"] for b in row]
    assert kind == "edit" and "Recycler" in text
    assert titles[:-1] and all(t.startswith("CRS 4060 FL") for t in titles[:-1])
    assert titles[-1] == "« Назад"
    callback(c, "smenu:grg")
    titles = [b["text"] for row in sent[-1][1][2]["inline_keyboard"] for b in row][:-1]
    assert titles and all(t.startswith(("CRM9250", "CAM8320", "CDM8240")) for t in titles)
    covered = set()
    for group in app.DEVICE_GROUPS:
        covered.update(app.gallery_indexes(group))
    assert covered == set(range(len(schemes.GALLERY)))
    callback(c, "smenu:back")
    assert sent[-1][1][1] == app.SCHEME_MENU_TEXT
    callback(c, "scheme:0")
    assert photos(sent)[-1][2] == schemes.GALLERY[0]["title"]


# --- оформление (HTML) ---

def test_html_payload_and_escaping(monkeypatch):
    text = app.format_value(5, [("grg", "5", "Описание: a < b & c\nРекомендации: x", True)])
    assert isinstance(text, app.Html)
    assert "a &lt; b &amp; c" in text and "<b>Описание:</b>" in text
    assert text.count("<blockquote>") == 2 and "<blockquote>🛠 <b>Рекомендации:</b> x</blockquote>" in text
    assert app._text_payload(text)["parse_mode"] == "HTML"
    assert "parse_mode" not in app._text_payload("обычный <текст>")
    long_html = app.Html("<b>x</b>" + "я" * 5000)
    payload = app._text_payload(long_html)
    assert "parse_mode" not in payload and "<b>" not in payload["text"]


def test_all_code_answers_are_valid_html():
    from html.parser import HTMLParser

    class Checker(HTMLParser):
        def __init__(self):
            super().__init__()
            self.stack = []

        def handle_starttag(self, tag, attrs):
            assert tag in ("b", "i", "code", "blockquote")
            self.stack.append(tag)

        def handle_endtag(self, tag):
            assert self.stack and self.stack.pop() == tag

    for category in ("grg", "cmd_v4", "ccdm"):
        for key, description in app.DATA[category].items():
            checker = Checker()
            checker.feed(app.format_value(0, [(category, key, description, True)]))
            assert checker.stack == []
    for text in (app.START_TEXT, app.build_help_text(), app.sensor_list_text(), app.MENU_TEXT):
        checker = Checker()
        checker.feed(text)
        assert checker.stack == []
