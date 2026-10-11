# Aria — AI Chatbot (Gemini + Supabase)

A premium Python chatbot web application powered by **Google Gemini** with persistent chat history stored in **Supabase**.

## Features

- 🤖 **Google Gemini 2.0 Flash** — streaming responses with real-time token display
- 🗄️ **Supabase** — persistent multi-session chat history
- 💬 **Multi-session sidebar** — manage multiple conversations
- ✨ **Markdown rendering** — full markdown + code syntax highlighting
- 📱 **Responsive design** — works on desktop and mobile
- 🎨 **Premium dark UI** — glassmorphism + animated effects
- 🔄 **Auto-title generation** — Gemini auto-names each conversation
- ⚡ **In-memory fallback** — works even without Supabase configured

---

## Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Set Up Environment Variables

Copy the example file and fill in your credentials:
```bash
cp .env.example .env
```

Edit `.env`:
```env
GEMINI_API_KEY=your_gemini_api_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_supabase_anon_key
SECRET_KEY=any-random-string
```

### 3. Set Up Supabase Database

1. Go to your [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project → **SQL Editor** → **New Query**
3. Copy and paste the contents of `supabase_schema.sql`
4. Click **Run**

### 4. Get API Keys

**Google Gemini API Key:**
- Visit [Google AI Studio](https://aistudio.google.com/apikey)
- Create an API key (free tier available)

**Supabase:**
- Visit [supabase.com](https://supabase.com) → Create a project
- Go to **Project Settings** → **API**
- Copy the **Project URL** and **anon public** key

### 5. Run the App

```bash
python app.py
```

Visit **http://localhost:5000** 🚀

---

## Project Structure

```
web_test/
├── app.py                  # Flask backend (API routes + Gemini + Supabase)
├── requirements.txt        # Python dependencies
├── supabase_schema.sql     # Database schema (run in Supabase SQL Editor)
├── .env.example            # Environment variable template
├── templates/
│   └── index.html          # Single-page app shell
└── static/
    ├── css/
    │   └── style.css       # Premium dark glassmorphism stylesheet
    ├── js/
    │   └── app.js          # Frontend logic (streaming, sessions, markdown)
    └── images/
        └── bg.jpg          # Background image
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/sessions` | List all chat sessions |
| `POST` | `/api/sessions` | Create a new session |
| `DELETE` | `/api/sessions/<id>` | Delete a session |
| `GET`  | `/api/sessions/<id>/messages` | Get messages for session |
| `POST` | `/api/chat` | Send message (SSE stream) |
| `GET`  | `/api/health` | Check server status |

## Supabase Schema

Two tables are created:
- **`chat_sessions`** — stores session metadata (id, title, timestamps)
- **`chat_messages`** — stores all messages with role (`user` / `model`) and content

A trigger automatically updates the session `updated_at` whenever a new message is added.

## Running Without Supabase

If Supabase is not configured, the app falls back to **in-memory storage**. All sessions are lost on server restart. The status indicator in the sidebar will show `⚠️ memory mode`.
