import os
import requests
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder=".", static_url_path="")

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"

SYSTEM_PROMPT = """You are a patient, gentle assistant who helps elderly people clarify their speech. The user (elderly person) may speak in a rambling, disjointed way. Your task: 1. Understand the core meaning. 2. Reorganize it concisely and clearly while preserving the original emotion and tone. 3. Output only the simplified content, no extra explanations. Now process the following:"""


@app.route("/")
def index():
    return send_from_directory(".", "index.html")


@app.route("/api/chat", methods=["POST"])
def chat():
    if not DEEPSEEK_API_KEY:
        return jsonify({"reply": "Service not configured with API Key."}), 503

    data = request.get_json(silent=True)
    if not data or "message" not in data:
        return jsonify({"error": "Missing message field"}), 400

    user_text = data["message"].strip()
    if not user_text:
        return jsonify({"error": "Message cannot be empty"}), 400

    try:
        resp = requests.post(
            DEEPSEEK_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
            },
            json={
                "model": "deepseek-chat",
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_text},
                ],
                "temperature": 0.7,
                "max_tokens": 500,
            },
            timeout=30,
        )

        if not resp.ok:
            app.logger.error("DeepSeek API error: %s %s", resp.status_code, resp.text)
            return jsonify({"reply": "AI service unavailable, please try later."}), 502

        result = resp.json()
        reply = result.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        if not reply:
            return jsonify({"reply": "AI returned empty, please try again."}), 502

        return jsonify({"reply": reply})

    except requests.exceptions.Timeout:
        app.logger.error("DeepSeek API timeout")
        return jsonify({"reply": "AI response timeout, please try again."}), 504
    except requests.exceptions.RequestException as e:
        app.logger.error("DeepSeek API request failed: %s", e)
        return jsonify({"reply": "Network error, please try again."}), 502


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
