import io
import os
import sys
from PIL import Image, ImageDraw

from app.core.config import settings
from app.db.database import init_db, get_db_connection
from app.services.storage_service import storage_service
from app.services.media_service import media_service
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def create_sample_png(text="Cloudflare Test"):
    img = Image.new("RGB", (120, 80), color=(243, 128, 32)) # Cloudflare Orange
    d = ImageDraw.Draw(img)
    d.text((10, 30), text, fill=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()

def test_storage_service_direct():
    print("\n--- 1. Testing StorageService Directly ---")
    data = b"Hello from Cloudflare R2 / Contexify storage service!"
    dest_key = "test/sample_note.txt"
    
    url, key = storage_service.upload_file(data, dest_key, "text/plain")
    print(f"Uploaded: key='{key}', public_url='{url}'")
    assert key == dest_key
    assert url is not None

    downloaded = storage_service.download_file(url)
    assert downloaded == data, f"Downloaded data mismatch: {downloaded}"
    print("Download verified successfully! Matching bytes length:", len(downloaded))

    # Test delete
    deleted = storage_service.delete_file(key)
    print(f"Deleted '{key}':", deleted)

def test_media_service_with_storage():
    print("\n--- 2. Testing MediaService Upload & Download ---")
    img_bytes = create_sample_png("R2 Media")
    att = media_service.save_uploaded_media(
        file_bytes=img_bytes,
        original_filename="r2_logo.png",
        session_id="test_storage_session"
    )
    print(f"Media Saved: id='{att.id}', url='{att.url}'")
    assert att.url is not None

    fetched_bytes = media_service.get_media_bytes(att.url)
    assert fetched_bytes is not None
    assert len(fetched_bytes) == len(img_bytes)
    print(f"get_media_bytes successfully retrieved {len(fetched_bytes)} bytes!")

def test_document_upload_and_storage():
    print("\n--- 3. Testing Document Upload with Storage URL ---")
    doc_content = b"Cloudflare R2 is an S3-compatible object storage service with zero egress fees."
    files = {"file": ("r2_guide.txt", doc_content, "text/plain")}
    data = {"session_id": "test_storage_session"}

    # Ensure session exists in DB
    from app.services.chat_history_service import chat_history_service
    chat_history_service.create_session(
        user_id="bf785aca-cf65-4c19-8b40-1dff7ecb2d96",
        title="Storage Test",
        mode="DOCUMENT_RAG",
        session_id="test_storage_session"
    )

    resp = client.post("/api/v1/document/upload", data=data, files=files)
    print("Doc Upload status:", resp.status_code)
    assert resp.status_code == 201, f"Doc upload failed: {resp.text}"
    doc_json = resp.json()["document"]
    print(f"Doc uploaded: id='{doc_json['document_id']}', storage_url='{doc_json.get('storage_url')}'")
    
    # Check DB record
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT storage_url FROM documents WHERE id = ?", (doc_json["document_id"],))
        row = cursor.fetchone()
        assert row is not None
        print("Database storage_url verified:", row["storage_url"])

    # Delete Document
    del_resp = client.delete(f"/api/v1/document/{doc_json['document_id']}?session_id=test_storage_session")
    assert del_resp.status_code == 200
    print("Document successfully deleted and purged from storage!")

if __name__ == "__main__":
    init_db()
    test_storage_service_direct()
    test_media_service_with_storage()
    test_document_upload_and_storage()
    print("\n=== ALL CLOUDFLARE R2 & STORAGE SERVICE TESTS PASSED! ===")
