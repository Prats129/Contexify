"""Application errors shared by services and API boundaries."""


class ImageGenerationError(RuntimeError):
    """An image-generation failure with a message safe to show to the user."""


class EmbeddingDimensionError(ValueError):
    """Embedding dimensions are incompatible with the document index."""

    def __init__(self) -> None:
        super().__init__(
            "Document indexing is unavailable because the embedding dimensions "
            "do not match the index configuration. Please contact the administrator. "
            "Existing documents have been preserved."
        )
