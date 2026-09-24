import io
import json
import sys
from PIL import Image, ImageDraw
from fastapi.testclient import TestClient
from app.main import app
from app.db.database import init_db
from app.services.chat_history_service import chat_history_service

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

client = TestClient(app)

def create_sample_png(text="Auto Test"):
    img = Image.new("RGB", (120, 80), color=(50, 100, 200))
    d = ImageDraw.Draw(img)
    d.text((10, 30), text, fill=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()

def parse_sse_events(response_text: str):
    events = []
    for line in response_text.strip().split("\n\n"):
        if line.startswith("data: "):
            try:
                events.append(json.loads(line[6:]))
            except Exception:
                pass
    return events

def test_auto_mode_conversational():
    print("\n--- 1. Testing AUTO Mode Conversational Q&A ---")
    session_id = "test_auto_session_conv"
    chat_history_service.create_session(
        user_id="bf785aca-cf65-4c19-8b40-1dff7ecb2d96",
        title="Auto Conv Test",
        mode="AUTO",
        session_id=session_id
    )

    payload = {
        "session_id": session_id,
        "message": "Hello! In 3 words, who are you?",
        "mode": "AUTO"
    }
    resp = client.post("/api/v1/chat/stream", json=payload)
    assert resp.status_code == 200
    events = parse_sse_events(resp.text)
    token_text = "".join([e.get("data", "") for e in events if e.get("event") == "token"])
    print(f"Tokens received: {token_text[:80]}...")
    assert len(token_text) > 0
    print("Conversational Q&A in AUTO mode passed!")

def test_auto_mode_image_generation_intent():
    print("\n--- 2. Testing AUTO Mode Image Generation Intent Detection ---")
    session_id = "test_auto_session_img"
    chat_history_service.create_session(
        user_id="bf785aca-cf65-4c19-8b40-1dff7ecb2d96",
        title="Auto Img Test",
        mode="AUTO",
        session_id=session_id
    )

    payload = {
        "session_id": session_id,
        "message": "Draw a miniature glowing geometric cube",
        "mode": "AUTO"
    }
    resp = client.post("/api/v1/chat/stream", json=payload)
    assert resp.status_code == 200
    events = parse_sse_events(resp.text)
    media_events = [e for e in events if e.get("event") == "media"]
    assert len(media_events) > 0, "Expected media event for image generation intent"
    print(f"Media event emitted: {media_events[0]['media']['url']}")
    print("Image generation intent in AUTO mode passed!")

def test_auto_mode_multimodal_and_followup():
    print("\n--- 3. Testing AUTO Mode Multimodal Upload & Multi-turn Follow-up ---")
    session_id = "test_auto_session_multi"
    chat_history_service.create_session(
        user_id="bf785aca-cf65-4c19-8b40-1dff7ecb2d96",
        title="Auto Multi Test",
        mode="AUTO",
        session_id=session_id
    )

    # Turn 1: Upload image
    img_bytes = create_sample_png("Blue Badge")
    upload_resp = client.post(
        "/api/v1/media/upload",
        data={"session_id": session_id},
        files={"file": ("blue_badge.png", img_bytes, "image/png")}
    )
    assert upload_resp.status_code == 201
    media_att = upload_resp.json()

    # Stream with attachment in AUTO mode
    turn1_payload = {
        "session_id": session_id,
        "message": "What text is shown on this badge?",
        "mode": "AUTO",
        "attachments": [media_att]
    }
    turn1_resp = client.post("/api/v1/chat/stream", json=turn1_payload)
    assert turn1_resp.status_code == 200
    events1 = parse_sse_events(turn1_resp.text)
    tokens1 = "".join([e.get("data", "") for e in events1 if e.get("event") == "token"])
    print(f"Turn 1 Vision response: {tokens1[:80]}...")
    assert len(tokens1) > 0

    # Turn 2: Follow-up question with NO attachments in AUTO mode
    turn2_payload = {
        "session_id": session_id,
        "message": "Now summarize that in one single short sentence.",
        "mode": "AUTO"
    }
    turn2_resp = client.post("/api/v1/chat/stream", json=turn2_payload)
    assert turn2_resp.status_code == 200
    events2 = parse_sse_events(turn2_resp.text)
    tokens2 = "".join([e.get("data", "") for e in events2 if e.get("event") == "token"])
    print(f"Turn 2 Follow-up response: {tokens2[:80]}...")
    assert len(tokens2) > 0
    print("Multi-turn follow-up without re-attaching passed!")

def test_document_rag_mode_conversational_fallback():
    print("\n--- 4. Testing Conversational Fallback in DOCUMENT_RAG Mode ---")
    session_id = "test_doc_rag_fallback"
    chat_history_service.create_session(
        user_id="bf785aca-cf65-4c19-8b40-1dff7ecb2d96",
        title="Doc Fallback Test",
        mode="DOCUMENT_RAG",
        session_id=session_id
    )

    # Empty document session: User says "Hello!"
    payload = {
        "session_id": session_id,
        "message": "Hi there! How are you today?",
        "mode": "DOCUMENT_RAG"
    }
    resp = client.post("/api/v1/chat/stream", json=payload)
    assert resp.status_code == 200
    events = parse_sse_events(resp.text)
    token_text = "".join([e.get("data", "") for e in events if e.get("event") == "token"])
    print(f"Fallback response: {token_text[:80]}...")
    assert "⚠️ No documents uploaded" not in token_text, "Should have responded conversationally!"
    print("DOCUMENT_RAG conversational fallback passed!")

if __name__ == "__main__":
    init_db()
    test_auto_mode_conversational()
    test_auto_mode_image_generation_intent()
    test_auto_mode_multimodal_and_followup()
    test_document_rag_mode_conversational_fallback()
    print("\n=== ALL AUTO MODE & CONVERSATIONAL TESTS PASSED! ===")
