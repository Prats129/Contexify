import json
import requests

BASE_URL = "http://127.0.0.1:8000/api/v1"
SESSION_ID = "test_verification_session_1"

def test_pipeline():
    print("--- 1. Testing Health Check Endpoint ---")
    res = requests.get(f"{BASE_URL}/health/")
    print("Health response:", res.json())
    assert res.status_code == 200, "Health check failed"

    print("\n--- 2. Testing Document Upload & Vector Indexing ---")
    with open("E:/New/data/sample_book.txt", "rb") as f:
        files = {"file": ("sample_book.txt", f, "text/plain")}
        data = {"session_id": SESSION_ID}
        res = requests.post(f"{BASE_URL}/document/upload", files=files, data=data)
    
    print("Upload response:", res.json())
    assert res.status_code == 201, "Upload failed"
    doc_id = res.json()["document"]["document_id"]
    print(f"[SUCCESS] Document uploaded & vectorized! Doc ID: {doc_id}, Chunks: {res.json()['document']['total_chunks']}")

    print("\n--- 3. Testing Document List Endpoint ---")
    res = requests.get(f"{BASE_URL}/document/list?session_id={SESSION_ID}")
    print("Document list:", res.json())
    assert res.json()["total_count"] >= 1, "Document list empty"

    print("\n--- 4. Testing Document RAG Streaming Query (Priority 1) ---")
    payload = {
        "session_id": SESSION_ID,
        "message": "Explain quantum entanglement and quantum teleportation.",
        "mode": "DOCUMENT_RAG"
    }
    
    res = requests.post(f"{BASE_URL}/chat/stream", json=payload, stream=True)
    assert res.status_code == 200, "Chat stream connection failed"
    
    print("Streaming RAG Response:")
    for line in res.iter_lines():
        if line:
            decoded = line.decode("utf-8")
            if decoded.startswith("data: "):
                data_str = decoded.replace("data: ", "").strip()
                try:
                    event = json.loads(data_str)
                    if event["event"] == "citations":
                        print(f"\n[CITATIONS RETRIEVED ({len(event['citations'])} excerpts)]:")
                        for c in event["citations"]:
                            print(f"  • {c['filename']} (Match: {int(c['similarity_score']*100)}%): {c['snippet']}")
                        print("\n[ANSWER TOKENS]:")
                    elif event["event"] == "token":
                        print(event["data"], end="", flush=True)
                    elif event["event"] == "done":
                        print("\n\n[SUCCESS] Stream completed successfully!")
                except Exception as e:
                    pass

    print("\n--- 5. Testing Web Search Streaming Query (Priority 2 Hook) ---")
    payload = {
        "session_id": SESSION_ID,
        "message": "What are the latest developments in artificial intelligence?",
        "mode": "WEB_SEARCH"
    }
    res = requests.post(f"{BASE_URL}/chat/stream", json=payload, stream=True)
    print("Streaming Web Search Response:")
    for line in res.iter_lines():
        if line:
            decoded = line.decode("utf-8")
            if decoded.startswith("data: "):
                data_str = decoded.replace("data: ", "").strip()
                try:
                    event = json.loads(data_str)
                    if event["event"] == "token":
                        print(event["data"], end="", flush=True)
                    elif event["event"] == "done":
                        print("\n\n[SUCCESS] Web search stream completed!")
                except Exception:
                    pass

if __name__ == "__main__":
    test_pipeline()
