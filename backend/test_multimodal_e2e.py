import asyncio
import io
import os
import sys
from PIL import Image, ImageDraw

from fastapi.testclient import TestClient
from app.main import app
from app.db.database import init_db
from app.services.image_gen_service import image_gen_service

client = TestClient(app)

def create_dummy_png():
    img = Image.new("RGB", (100, 100), color=(73, 109, 137))
    d = ImageDraw.Draw(img)
    d.text((10, 40), "Contexify", fill=(255, 255, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf.getvalue()

def test_media_upload():
    print("\n--- 1. Testing Media Upload Endpoint ---")
    img_bytes = create_dummy_png()
    files = {"file": ("test_badge.png", img_bytes, "image/png")}
    data = {"session_id": "test_e2e_session"}
    response = client.post("/api/v1/media/upload", data=data, files=files)
    print("Upload status:", response.status_code)
    assert response.status_code in (200, 201), f"Upload failed: {response.text}"
    res_json = response.json()
    print("Upload response:", res_json)
    assert "url" in res_json
    assert res_json["mime_type"] == "image/png"
    assert res_json["media_type"] == "upload"
    return res_json

def test_image_generation_service():
    print("\n--- 2. Testing Image Generation Service ---")
    res = asyncio.run(image_gen_service.generate_image(
        prompt="A minimalist glowing geometric neon polygon icon on dark blue background",
        session_id="test_e2e_session"
    ))
    print("Image Gen Result:", res)
    assert res.url
    print("Successfully generated image with URL:", res.url)
    return res

def test_chat_multimodal_stream(uploaded_media):
    print("\n--- 3. Testing Multimodal Chat Stream ---")
    payload = {
        "session_id": "test_e2e_session",
        "query": "What text or colors do you see in this image? Describe briefly in one sentence.",
        "mode": "MULTIMODAL",
        "attachments": [
            {
                "url": uploaded_media["url"],
                "file_name": uploaded_media["file_name"],
                "media_type": uploaded_media["media_type"],
                "mime_type": uploaded_media["mime_type"],
                "source": "upload"
            }
        ]
    }
    with client.stream("POST", "/api/v1/chat/stream", json=payload) as response:
        print("Multimodal Stream status:", response.status_code)
        assert response.status_code == 200
        chunks = []
        for line in response.iter_lines():
            if line:
                chunks.append(line)
                if len(chunks) <= 5 or "[DONE]" in line:
                    print("Chunk:", line[:80])
        print(f"Total chunks received: {len(chunks)}")
        assert any("data: " in c for c in chunks)

def test_chat_image_generation_stream():
    print("\n--- 4. Testing Chat Stream with IMAGE_GENERATION Mode ---")
    payload = {
        "session_id": "test_e2e_session",
        "query": "Create an image of an origami fox sitting on a wooden desk",
        "mode": "IMAGE_GENERATION",
        "attachments": []
    }
    with client.stream("POST", "/api/v1/chat/stream", json=payload) as response:
        print("Image Gen Stream status:", response.status_code)
        assert response.status_code == 200
        chunks = []
        for line in response.iter_lines():
            if line:
                chunks.append(line)
                print("Chunk:", line[:80])
        assert any('"event": "media"' in c for c in chunks)
        print("Media event emitted successfully in SSE stream!")

if __name__ == "__main__":
    init_db()
    from app.db.database import get_db_connection
    with get_db_connection() as conn:
        conn.cursor().execute(
            "INSERT OR IGNORE INTO chat_sessions (id, title, mode, created_at, updated_at) VALUES ('test_e2e_session', 'Test Session', 'MULTIMODAL', '2026-09-17T00:00:00', '2026-09-17T00:00:00')"
        )
    uploaded = test_media_upload()
    test_image_generation_service()
    test_chat_multimodal_stream(uploaded)
    test_chat_image_generation_stream()
    print("\n=== ALL MULTIMODAL & IMAGE GEN TESTS PASSED! ===")
