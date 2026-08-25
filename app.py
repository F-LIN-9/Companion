import os
import base64
import requests
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder=".", static_url_path="")

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_CHAT_URL = "https://api.deepseek.com/v1/chat/completions"

# ---------- 各模式的 System Prompt ----------
PROMPTS = {
    "default": """你是一位耐心、温和的晚辈助手，专门帮老年人把话说清楚。

任务：用户（老人）说了一段话，可能很啰嗦、跳跃、夹杂很多背景信息。请你：
1. 理解老人真正想表达的核心意思。
2. 用简洁、清晰、有条理的语言重新组织，保留老人的情感和语气。
3. 最终输出只包含精简后的内容，不要添加任何额外解释、不要评价老人的表达。

示例：
用户："哎呀，我那个儿子啊，就是小刚，他好久没回来了，我上回给他打电话，他说忙，我这心里头啊，老惦记着，也不知道他吃饭吃得好不好，你说这孩子……"
输出："小刚最近忙，好久没回家了。我惦记他，担心他吃不好。"

现在请处理以下内容：""",

    "doctor": """你是一位专业的就医辅助助手，帮助老年人整理病情信息。

任务：用户描述了自己的身体不适，可能很啰嗦。请你：
1. 从描述中提取关键信息，整理成以下三句话格式：
   - 哪里不舒服？（部位、症状）
   - 持续多久了？（时间）
   - 有多严重？（程度）
2. 语气温和、有耐心，像家人在关心。
3. 只输出整理后的三句话，不要添加诊断建议或额外解释。

示例输出：
"您感觉胸口闷，心跳有点快。这种情况持续了大概三天。严重的时候会觉得喘不上气。"

现在请处理以下内容：""",

    "fraud": """你是一位防诈骗专家，专门帮老年人识别各种骗局。

任务：用户复述了一段可疑的话术或遭遇。请你：
1. 判断这是否可能是诈骗。
2. 如果是诈骗，指出诈骗类型（如：冒充公检法、中奖诈骗、保健品诈骗、亲情诈骗等）。
3. 列出2-3个可疑点。
4. 给出明确的建议（如：不要转账、不要透露验证码、先联系子女确认等）。
5. 语气坚定但温和，让老人感到安心。

输出格式：
"【判断】这很可能是{诈骗类型}。
【可疑点】1.… 2.… 3.…
【建议】…"

现在请分析以下内容：""",

    "medicine": """你是一位贴心的用药提醒助手，帮助老年人记录用药信息。

任务：用户告诉你他/她需要吃什么药、什么时间吃。请你：
1. 提取药物名称、服用时间、频率。
2. 用温暖的语气确认记录，格式如："好的，我会记住：{时间}服用{药物}。到时间我会提醒您。"
3. 如果信息不完整（缺药名或时间），温和地追问。
4. 只输出确认或追问的内容，不要添加额外解释。

现在请处理以下内容：""",

    "care": """你是一位贴心的晚辈，每天主动关心家里的老人。

任务：生成一段温暖的问候语，表达对老人的关心。内容要：
1. 温馨、自然，像家人聊天。
2. 提及天气、饮食、休息等日常话题。
3. 以"要不要给孩子们打个电话聊聊？"结尾。
4. 2-3句话即可，不要太长。

现在请生成一段问候语："""
}


# ---------- 路由 ----------
@app.route("/")
def index():
    return send_from_directory(".", "index.html")


@app.route("/api/chat", methods=["POST"])
def chat():
    if not DEEPSEEK_API_KEY:
        return jsonify({"reply": "服务未配置 API Key，请联系管理员。"}), 503

    data = request.get_json(silent=True)
    if not data or "message" not in data:
        return jsonify({"error": "缺少 message 字段"}), 400

    user_text = data["message"].strip()
    if not user_text:
        return jsonify({"error": "message 不能为空"}), 400

    mode = data.get("mode", "default")
    if mode not in PROMPTS:
        mode = "default"

    system_prompt = PROMPTS[mode]

    try:
        resp = requests.post(
            DEEPSEEK_CHAT_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
            },
            json={
                "model": "deepseek-chat",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_text},
                ],
                "temperature": 0.7,
                "max_tokens": 500,
            },
            timeout=30,
        )

        if not resp.ok:
            app.logger.error("DeepSeek API error: %s %s", resp.status_code, resp.text)
            return jsonify({"reply": "AI 服务暂时不可用，请稍后再试。"}), 502

        result = resp.json()
        reply = result.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        if not reply:
            return jsonify({"reply": "AI 返回为空，请再试一次。"}), 502

        return jsonify({"reply": reply})

    except requests.exceptions.Timeout:
        app.logger.error("DeepSeek API timeout")
        return jsonify({"reply": "AI 响应超时，请再试一次。"}), 504
    except requests.exceptions.RequestException as e:
        app.logger.error("DeepSeek API request failed: %s", e)
        return jsonify({"reply": "网络连接失败，请检查网络后重试。"}), 502


@app.route("/api/vision", methods=["POST"])
def vision():
    if not DEEPSEEK_API_KEY:
        return jsonify({"reply": "服务未配置 API Key，请联系管理员。"}), 503

    data = request.get_json(silent=True)
    if not data or "image" not in data:
        return jsonify({"error": "缺少 image 字段"}), 400

    image_b64 = data["image"].strip()
    if not image_b64:
        return jsonify({"error": "image 不能为空"}), 400

    # 确保是 data URI 格式，DeepSeek 视觉模型支持 base64
    if not image_b64.startswith("data:"):
        image_b64 = f"data:image/jpeg;base64,{image_b64}"

    try:
        resp = requests.post(
            DEEPSEEK_CHAT_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
            },
            json={
                "model": "deepseek-chat",
                "messages": [
                    {
                        "role": "system",
                        "content": "你是一位帮助老年人识别商品价格的助手。老人拍了一张商品的照片，请帮老人识别：1.这是什么产品（品牌、名称）2.市场参考价格范围 3.判断是否可能被高价售卖，如有风险请温和提醒。用简洁清晰的中文回答，语气温暖。"
                    },
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "请帮我识别这张照片里的产品是什么，大概多少钱？"},
                            {"type": "image_url", "image_url": {"url": image_b64}}
                        ]
                    }
                ],
                "temperature": 0.7,
                "max_tokens": 500,
            },
            timeout=30,
        )

        if not resp.ok:
            app.logger.error("DeepSeek Vision API error: %s %s", resp.status_code, resp.text)
            return jsonify({"reply": "图片识别服务暂时不可用，请稍后再试。"}), 502

        result = resp.json()
        reply = result.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        if not reply:
            return jsonify({"reply": "无法识别图片内容，请拍一张更清晰的照片。"}), 502

        return jsonify({"reply": reply})

    except requests.exceptions.Timeout:
        app.logger.error("DeepSeek Vision API timeout")
        return jsonify({"reply": "图片识别超时，请再试一次。"}), 504
    except requests.exceptions.RequestException as e:
        app.logger.error("DeepSeek Vision API request failed: %s", e)
        return jsonify({"reply": "网络连接失败，请检查网络后重试。"}), 502


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)