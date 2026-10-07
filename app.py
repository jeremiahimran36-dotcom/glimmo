import os
import re
import time
from collections import defaultdict, deque

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, send_from_directory

load_dotenv()  # reads .env on your computer; on Railway it uses Variables instead

app = Flask(__name__)

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "").strip().strip('"').strip("'")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

# Groq retired the old Llama models on 16 Aug 2026, so these are the current ones.
DEFAULT_MODEL = "openai/gpt-oss-20b"
FALLBACK_MODELS = ["openai/gpt-oss-120b"]
RETIRED = {
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "qwen/qwen3-32b",
    "meta-llama/llama-4-scout-17b-16e-instruct",
}
_env_model = os.environ.get("GROQ_MODEL", "").strip()
GROQ_MODEL = _env_model if _env_model and _env_model not in RETIRED else DEFAULT_MODEL

SYSTEM_PROMPT = (
    "You are Glimmo, a cute, warm, playful little orb who talks with your friend. "
    "Your replies are spoken aloud, so keep them short: one to three simple sentences. "
    "Never use markdown, lists, emojis or special symbols. "
    "Reply in the same language the person speaks. Be kind, curious and gently funny."
)

# Simple per-visitor rate limit so nobody can drain your Groq quota.
RATE_LIMIT = 20          # messages
RATE_WINDOW = 60         # seconds
hits = defaultdict(deque)


def client_ip():
    forwarded = request.headers.get("X-Forwarded-For", "")
    return forwarded.split(",")[0].strip() or request.remote_addr or "unknown"


def too_many_requests(ip):
    now = time.time()
    q = hits[ip]
    while q and now - q[0] > RATE_WINDOW:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        return True
    q.append(now)
    return False


def clean_messages(raw):
    out = []
    if not isinstance(raw, list):
        return out
    for m in raw[-12:]:
        if not isinstance(m, dict):
            continue
        role, content = m.get("role"), m.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            out.append({"role": role, "content": content.strip()[:800]})
    return out


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/manifest.json")
def manifest():
    return send_from_directory("static", "manifest.json", mimetype="application/manifest+json")


@app.route("/sw.js")
def service_worker():
    resp = send_from_directory("static", "sw.js", mimetype="application/javascript")
    resp.headers["Service-Worker-Allowed"] = "/"
    return resp


@app.route("/health")
def health():
    return jsonify(ok=True, key_loaded=bool(GROQ_API_KEY))


def call_groq(model, messages):
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}] + messages,
        "temperature": 0.8,
        "max_completion_tokens": 600,
    }
    if model.startswith("openai/gpt-oss"):
        payload["reasoning_effort"] = "low"      # fast answers, little thinking
        payload["include_reasoning"] = False
    return requests.post(
        GROQ_URL,
        headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
        json=payload,
        timeout=25,
    )


@app.route("/api/chat", methods=["POST"])
def chat():
    if not GROQ_API_KEY:
        return jsonify(error="The server has no Groq key yet."), 500
    if too_many_requests(client_ip()):
        return jsonify(error="Too many messages. Wait a moment."), 429

    data = request.get_json(silent=True) or {}
    messages = clean_messages(data.get("messages"))
    if not messages or messages[-1]["role"] != "user":
        return jsonify(error="Say something first."), 400

    for model in [GROQ_MODEL] + [m for m in FALLBACK_MODELS if m != GROQ_MODEL]:
        try:
            r = call_groq(model, messages)
        except requests.exceptions.Timeout:
            return jsonify(error="Glimmo took too long to think."), 504
        except requests.exceptions.RequestException as e:
            print(f"[Groq] network error: {e}", flush=True)
            return jsonify(error="Can't reach Groq. Check your internet."), 502

        if r.status_code == 200:
            try:
                reply = (r.json()["choices"][0]["message"].get("content") or "").strip()
            except Exception:
                reply = ""
            reply = re.sub(r"<think>.*?</think>", "", reply, flags=re.S)
            reply = re.sub(r"[*_`#]+", "", reply).strip()
            if reply:
                return jsonify(reply=reply)
            print(f"[Groq] {model} returned an empty reply", flush=True)
            return jsonify(error="Glimmo had no words. Try again."), 502

        body = r.text[:400]
        print(f"[Groq] {model} -> {r.status_code}: {body}", flush=True)  # shows in your terminal
        if r.status_code == 401:
            return jsonify(error="Groq rejected the API key. Check GROQ_API_KEY and restart."), 502
        if r.status_code == 429:
            return jsonify(error="Groq is busy right now. Try again soon."), 429
        if r.status_code in (400, 404) and "model" in body.lower():
            continue  # model unavailable, try the next one
        return jsonify(error="Glimmo got confused. Try again."), 502

    return jsonify(error="No Groq model is available. Update GROQ_MODEL."), 502


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)