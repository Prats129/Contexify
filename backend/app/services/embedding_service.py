import os
import hashlib
import math
from typing import List
from app.core.config import settings
from app.core.logging import logger

class EmbeddingService:
    """
    Embedding Service generating vector representations.
    Supports Google GenAI API (`text-embedding-004`) with seamless deterministic local fallback.
    """
    def __init__(self):
        self.api_key = settings.GEMINI_API_KEY or os.environ.get("GEMINI_API_KEY", "")
        self.client = None
        
        if self.api_key:
            try:
                from google import genai
                self.client = genai.Client(api_key=self.api_key)
                logger.info("Initialized Google GenAI Embedding Client")
            except Exception as e:
                logger.warning(f"Failed to initialize Google GenAI SDK: {e}. Falling back to local embedding mode.")

    def embed_text(self, text: str) -> List[float]:
        """Embed a single text string into a float vector."""
        return self.embed_batch([text])[0]

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        """Embed a batch of text strings into a list of float vectors."""
        if not texts:
            return []

        if self.client:
            try:
                # Use Google GenAI SDK
                response = self.client.models.embed_content(
                    model=settings.DEFAULT_EMBEDDING_MODEL,
                    contents=texts,
                )
                embeddings = [embedding.values for embedding in response.embeddings]
                return embeddings
            except Exception as e:
                logger.warning(f"GenAI API Embedding failed: {e}. Using deterministic local vector generator.")

        # Local Fallback Vector Generator (384-dimensional normalized TF-IDF/hash vector)
        return [self._local_deterministic_embedding(t) for t in texts]

    def _local_deterministic_embedding(self, text: str, dim: int = 384) -> List[float]:
        """Generate a normalized pseudo-semantic vector for fallback/offline testing."""
        vec = [0.0] * dim
        words = text.lower().split()
        if not words:
            return vec

        for word in words:
            # Hash word into vector dimensions
            h = int(hashlib.md5(word.encode('utf-8')).hexdigest(), 16)
            idx = h % dim
            val = ((h >> 8) % 100) / 100.0 - 0.5
            vec[idx] += val

        # Normalize L2
        norm = math.sqrt(sum(x * x for x in vec))
        if norm > 0:
            vec = [x / norm for x in vec]
            
        return vec

embedding_service = EmbeddingService()
