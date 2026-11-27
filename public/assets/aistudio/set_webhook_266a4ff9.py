"""
Одноразовый скрипт: сообщает Telegram, куда слать обновления после деплоя.

Запуск (один раз, после того как сервис уже развёрнут и доступен по URL):
    export BOT_TOKEN="токен_от_BotFather"
    python set_webhook.py https://<адрес-сервиса>/webhook
"""

import os
import sys

import requests

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Использование: python set_webhook.py <https://.../webhook>")

    token = os.environ.get("BOT_TOKEN")
    if not token:
        raise SystemExit("Не задана переменная окружения BOT_TOKEN")

    url = sys.argv[1]
    resp = requests.post(
        f"https://api.telegram.org/bot{token}/setWebhook",
        json={"url": url},
        timeout=10,
    )
    print(resp.status_code, resp.json())
