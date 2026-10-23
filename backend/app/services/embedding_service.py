import hashlib
import math
import os
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

                self.client = genai.Client(
                    api_key=self.api_key, http_options={"timeout": 60_000}
                )
                logger.info("Initialized Google GenAI Embedding Client")
            except Exception as e:
                logger.warning(
                    f"Failed to initialize Google GenAI SDK: {e}. Falling back to local embedding mode.",
                    exc_info=True,
                )

    def embed_text(self, text: str) -> List[float]:
        """Embed a single text string into a float vector."""
        return self.embed_batch([text])[0]

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        """Embed a batch of text strings into a list of float vectors."""
        if not texts:
            return []

        if self.client:
            try:
                from google.genai.types import ContentListUnion, EmbedContentConfig

                contents: ContentListUnion = [text for text in texts]
                config = EmbedContentConfig(
                    output_dimensionality=settings.EMBEDDING_DIMENSION or None
                )

                response = self.client.models.embed_content(
                    model=settings.DEFAULT_EMBEDDING_MODEL,
                    contents=contents,
                    config=config,
                )
                if response.embeddings is None or len(response.embeddings) != len(
                    texts
                ):
                    raise ValueError("Embedding provider returned an incomplete batch")
                embeddings: List[List[float]] = []
                for embedding in response.embeddings:
                    if embedding.values is None:
                        raise ValueError("Embedding provider returned no vector")
                    embeddings.append(embedding.values)
                return embeddings
            except Exception as e:
                logger.warning(
                    f"GenAI API Embedding failed: {e}. Using deterministic local vector generator.",
                    exc_info=True,
                )

        # Local Fallback Vector Generator (normalized TF-IDF/hash vector matching index dimension)
        return [
            self._local_deterministic_embedding(t, dim=settings.EMBEDDING_DIMENSION)
            for t in texts
        ]

    def _local_deterministic_embedding(self, text: str, dim: int = 768) -> List[float]:
        """Generate a normalized pseudo-semantic vector for fallback/offline testing."""
        vec = [0.0] * dim
        words = text.lower().split()
        if not words:
            return vec

        for word in words:
            # Hash word into vector dimensions
            h = int(hashlib.md5(word.encode("utf-8")).hexdigest(), 16)
            idx = h % dim
            val = ((h >> 8) % 100) / 100.0 - 0.5
            vec[idx] += val

        # Normalize L2
        norm = math.sqrt(sum(x * x for x in vec))
        if norm > 0:
            vec = [x / norm for x in vec]

        return vec


embedding_service = EmbeddingService()
