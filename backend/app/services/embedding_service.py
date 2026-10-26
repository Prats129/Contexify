import math
import os
from typing import List

import httpx

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
        vectors: List[List[float]] = []
        for offset in range(0, len(texts), 100):
            vectors.extend(self._embed_provider_batch(texts[offset : offset + 100]))
        return vectors

    def _embed_provider_batch(self, texts: List[str]) -> List[List[float]]:
        assert self.client is not None
        response_received = False
        try:
            from google.genai.types import ContentListUnion, EmbedContentConfig

            contents: ContentListUnion = [text for text in texts]
            response = self.client.models.embed_content(
                model=self.model,
                contents=contents,
                config=EmbedContentConfig(output_dimensionality=self.dimension),
            )
            response_received = True
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
            code = getattr(error, "code", None)
            if (
                not isinstance(code, int)
                or isinstance(code, bool)
                or not 400 <= code <= 599
            ):
                code = None
            category = {
                400: "invalid_request",
                401: "authentication",
                402: "account_settings",
                403: "permission",
                404: "model_not_found",
                408: "timeout",
                413: "request_too_large",
                429: "rate_or_quota_limit",
                504: "timeout",
            }.get(code, "provider_unavailable" if code and code >= 500 else "unknown")
            if isinstance(error, (TimeoutError, httpx.TimeoutException)):
                category = "timeout"
            elif isinstance(error, httpx.TransportError):
                category = "connection"
            elif response_received:
                category = "invalid_response"
            logger.error(
                "Embedding request failed (%s; http_status=%s; category=%s; batch_size=%d)",
                type(error).__name__,
                code if code is not None else "unknown",
                category,
                len(texts),
            )
            messages = {
                "rate_or_quota_limit": "The AI service has reached a rate or usage limit while processing your document. Please try again later.",
                "invalid_request": "The AI service rejected the document-processing request. Please contact support.",
                "authentication": "The document-processing service could not authenticate with the AI provider. Please contact support.",
                "account_settings": "Document processing is unavailable because the AI service's account settings need attention. Please contact support.",
                "permission": "The AI service denied access to document processing. Please contact support.",
                "model_not_found": "The configured document-processing model could not be found. Please contact support.",
                "request_too_large": "The AI service rejected the document-processing request because it was too large. Try a smaller document or contact support.",
                "timeout": "The AI service timed out while processing your document. Please try again later.",
                "connection": "Could not connect to the AI service to process your document. Please try again later.",
                "invalid_response": "The AI service returned an incomplete or invalid result while processing your document. Please try again or contact support.",
                "provider_unavailable": "The AI service is temporarily unavailable for document processing. Please try again later.",
            }
            raise EmbeddingError(
                messages.get(
                    category,
                    "Document processing failed because of an unexpected AI service error. Please try again or contact support.",
                )
            ) from None


embedding_service = EmbeddingService()
