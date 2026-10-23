import math
import os
from typing import List

from app.core.config import settings
from app.core.errors import EmbeddingError
from app.core.logging import logger


class EmbeddingService:
    """Generate semantic vectors in one explicitly identified embedding space."""

    def __init__(self):
        self.model = settings.DEFAULT_EMBEDDING_MODEL.strip().removeprefix("models/")
        self.dimension = settings.EMBEDDING_DIMENSION
        # Increment v1 if preprocessing or provider configuration changes the space.
        self.embedding_space = f"google:{self.model}:dimension:{self.dimension}:v1"
        self.api_key = settings.GEMINI_API_KEY or os.environ.get("GEMINI_API_KEY", "")
        self.client = None
        if self.api_key:
            try:
                from google import genai

                self.client = genai.Client(
                    api_key=self.api_key, http_options={"timeout": 60_000}
                )
            except Exception as error:  # noqa: BLE001 - redact provider initialization failures
                logger.error(
                    "Could not initialize the embedding client (%s)",
                    type(error).__name__,
                )

    def embed_text(self, text: str) -> List[float]:
        return self.embed_batch([text])[0]

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        if not self.client or not self.model or self.dimension <= 0:
            raise EmbeddingError(
                "Document indexing and search are not configured. Please contact support."
            )
        try:
            from google.genai.types import ContentListUnion, EmbedContentConfig

            contents: ContentListUnion = [text for text in texts]
            response = self.client.models.embed_content(
                model=self.model,
                contents=contents,
                config=EmbedContentConfig(output_dimensionality=self.dimension),
            )
            if response.embeddings is None or len(response.embeddings) != len(texts):
                raise ValueError("Incomplete embedding batch")
            vectors: List[List[float]] = []
            for embedding in response.embeddings:
                values = embedding.values
                if (
                    values is None
                    or len(values) != self.dimension
                    or any(not math.isfinite(value) for value in values)
                    or not any(values)
                ):
                    raise ValueError("Invalid embedding vector")
                vectors.append(values)
            return vectors
        except Exception as error:  # noqa: BLE001 - provider boundary; redact all provider/schema failures
            # Never substitute hash vectors or expose provider credentials/content.
            logger.error("Embedding request failed (%s)", type(error).__name__)
            if getattr(error, "code", None) in (401, 403, 404):
                raise EmbeddingError(
                    "Document indexing and search are not configured correctly. Please contact support."
                ) from None
            raise EmbeddingError(
                "The document embedding service is temporarily unavailable. Please try again later."
            ) from None


embedding_service = EmbeddingService()
