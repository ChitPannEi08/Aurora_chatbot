import os
import uuid
import json
from datetime import datetime, timezone
from flask import Flask, request, jsonify, Response, stream_with_context, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
import google.generativeai as genai
from supabase import create_client, Client

# ── Load environment 
load_dotenv()

# ── Flask App 
app = Flask(__name__, static_folder="static", template_folder="templates")
app.secret_key = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")
CORS(app)

# ── Gemini Setup 
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

SYSTEM_INSTRUCTION = (
    "You are Aurora, a brilliant and friendly AI assistant powered by Google Gemini. "
    "You are helpful, creative, and knowledgeable across a wide range of topics. "
    "You respond thoughtfully with well-structured answers. "
    "When writing code, always use code blocks with the appropriate language identifier. "
    "Keep your tone warm, engaging, and professional."
)

# ── Supabase Setup 
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

supabase: Client | None = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        print("✅ Supabase client initialized.")
    except Exception as e:
        print(f"⚠️  Supabase client initialization failed: {e}")
        supabase = None
else:
    print("⚠️  Supabase credentials not set — running in memory-only mode.")


# ── In-memory fallback (when Supabase is unavailable or RLS blocked) ──────────
memory_sessions: dict[str, dict] = {}
memory_messages: dict[str, list] = {}

#  Helper Functions

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_session(title: str = "New Chat") -> dict:
    """Create a new chat session in Supabase or memory."""
    if supabase:
        try:
            resp = supabase.table("chat_sessions").insert({"title": title}).execute()
            if resp.data:
                return resp.data[0]
        except Exception as e:
            print(f"⚠️  Supabase create_session failed: {e}. Falling back to in-memory store.")
    
    session_id = str(uuid.uuid4())
    session = {"id": session_id, "title": title, "created_at": _now_iso(), "updated_at": _now_iso()}
    memory_sessions[session_id] = session
    memory_messages[session_id] = []
    return session


def get_sessions() -> list:
    """Return all sessions ordered by most recently updated."""
    if supabase:
        try:
            resp = (
                supabase.table("chat_sessions")
                .select("*")
                .order("updated_at", desc=True)
                .execute()
            )
            if resp.data is not None:
                return resp.data
        except Exception as e:
            print(f"⚠️  Supabase get_sessions failed: {e}. Falling back to in-memory store.")
    return sorted(memory_sessions.values(), key=lambda s: s["updated_at"], reverse=True)


def get_messages(session_id: str) -> list:
    """Return all messages for a given session in chronological order."""
    if supabase:
        try:
            resp = (
                supabase.table("chat_messages")
                .select("*")
                .eq("session_id", session_id)
                .order("created_at", desc=False)
                .execute()
            )
            if resp.data is not None:
                return resp.data
        except Exception as e:
            print(f"⚠️  Supabase get_messages failed: {e}. Falling back to in-memory store.")
    return memory_messages.get(session_id, [])


def save_message(session_id: str, role: str, content: str) -> dict:
    """Persist a single message to Supabase or memory."""
    if supabase:
        try:
            resp = (
                supabase.table("chat_messages")
                .insert({"session_id": session_id, "role": role, "content": content})
                .execute()
            )
            if resp.data:
                return resp.data[0]
        except Exception as e:
            print(f"⚠️  Supabase save_message failed: {e}. Falling back to in-memory store.")
    msg = {
        "id": str(uuid.uuid4()),
        "session_id": session_id,
        "role": role,
        "content": content,
        "created_at": _now_iso(),
    }
    memory_messages.setdefault(session_id, []).append(msg)
    if session_id in memory_sessions:
        memory_sessions[session_id]["updated_at"] = _now_iso()
    return msg


def update_session_title(session_id: str, title: str) -> None:
    """Update the title of a chat session."""
    if supabase:
        try:
            supabase.table("chat_sessions").update({"title": title}).eq("id", session_id).execute()
            return
        except Exception as e:
            print(f"⚠️  Supabase update_session_title failed: {e}. Falling back to in-memory store.")
    if session_id in memory_sessions:
        memory_sessions[session_id]["title"] = title


def delete_session(session_id: str) -> None:
    """Delete a session and all its messages."""
    if supabase:
        try:
            supabase.table("chat_sessions").delete().eq("id", session_id).execute()
        except Exception as e:
            print(f"⚠️  Supabase delete_session failed: {e}. Falling back to in-memory store.")
    memory_sessions.pop(session_id, None)
    memory_messages.pop(session_id, None)


def build_gemini_history(messages: list) -> list:
    """Convert stored messages into Gemini chat history format."""
    history = []
    for msg in messages[:-1]:  # Exclude the last user message (sent separately)
        history.append({
            "role": msg["role"],
            "parts": [{"text": msg["content"]}],
        })
    return history


def generate_session_title(user_message: str) -> str:
    """Use Gemini to auto-generate a concise title from the first user message."""
    if not GEMINI_API_KEY:
        return user_message[:40] + ("…" if len(user_message) > 40 else "")
    try:
        model = genai.GenerativeModel(GEMINI_MODEL)
        prompt = (
            f"Generate a very short, concise title (max 6 words, no quotes) "
            f"for a chat that starts with this message:\n\n{user_message}"
        )
        resp = model.generate_content(prompt)
        return resp.text.strip()[:60]
    except Exception:
        return user_message[:40] + ("…" if len(user_message) > 40 else "")


#  Routes — Static Pages

@app.route("/")
def index():
    return send_from_directory("templates", "index.html")

#  Routes — Sessions API
@app.route("/api/sessions", methods=["GET"])
def api_get_sessions():
    """List all chat sessions."""
    try:
        sessions = get_sessions()
        return jsonify({"sessions": sessions})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/sessions", methods=["POST"])
def api_create_session():
    """Create a new chat session."""
    try:
        session = create_session()
        return jsonify({"session": session}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/sessions/<session_id>", methods=["DELETE"])
def api_delete_session(session_id: str):
    """Delete a chat session and all its messages."""
    try:
        delete_session(session_id)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/sessions/<session_id>/messages", methods=["GET"])
def api_get_messages(session_id: str):
    """Get all messages for a session."""
    try:
        messages = get_messages(session_id)
        return jsonify({"messages": messages})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


#  Routes — Chat API (Streaming)

@app.route("/api/chat", methods=["POST"])
def api_chat():
    """Send a message and stream back the Gemini response via SSE."""
    data = request.get_json(force=True)
    session_id: str = data.get("session_id", "")
    user_message: str = data.get("message", "").strip()

    if not user_message:
        return jsonify({"error": "Message cannot be empty."}), 400

    if not GEMINI_API_KEY:
        return jsonify({"error": "GEMINI_API_KEY is not configured."}), 500

    # ── Ensure session exists
    if not session_id:
        session = create_session()
        session_id = session["id"]
    
    # ── Save user message
    save_message(session_id, "user", user_message)

    # ── Retrieve history for context
    all_messages = get_messages(session_id)
    history = build_gemini_history(all_messages)
    is_first_message = len(all_messages) == 1  # Only the user message we just saved

    def generate():
        full_response = ""
        new_session_id = session_id
        new_title = None

        try:
            # ── Build Gemini chat
            model = genai.GenerativeModel(
                model_name=GEMINI_MODEL,
                system_instruction=SYSTEM_INSTRUCTION,
            )
            chat = model.start_chat(history=history)

            # ── Send meta info first
            yield f"data: {json.dumps({'type': 'session_id', 'session_id': new_session_id})}\n\n"

            # ── Stream Gemini response
            response = chat.send_message(user_message, stream=True)
            for chunk in response:
                if chunk.text:
                    full_response += chunk.text
                    yield f"data: {json.dumps({'type': 'text', 'text': chunk.text})}\n\n"

            # ── Save assistant response
            save_message(new_session_id, "model", full_response)

            # ── Auto-generate title for first message
            if is_first_message:
                new_title = generate_session_title(user_message)
                update_session_title(new_session_id, new_title)

            # ── Signal completion
            yield f"data: {json.dumps({'type': 'done', 'title': new_title})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )

#  Health Check
@app.route("/api/health")
def health():
    supabase_ok = False
    supabase_error = None
    if supabase:
        try:
            supabase.table("chat_sessions").select("id").limit(1).execute()
            supabase_ok = True
        except Exception as e:
            supabase_error = str(e)
            print(f"⚠️  Supabase health check warning: {e}")

    return jsonify({
        "status": "ok",
        "gemini": bool(GEMINI_API_KEY),
        "supabase": supabase_ok,
        "supabase_connected": supabase is not None,
        "supabase_error": supabase_error,
        "model": GEMINI_MODEL,
    })

# Entry Point
if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)