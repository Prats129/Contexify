"""Application errors shared by services and API boundaries."""


class ImageGenerationError(RuntimeError):
    """An image-generation failure with a message safe to show to the user."""


class TextGenerationError(RuntimeError):
    """A text-generation failure with a message safe to show to the user."""


class EmbeddingDimensionError(ValueError):
    """Embedding dimensions are incompatible with the document index."""

    def __init__(self) -> None:
        super().__init__(
            "Document indexing is unavailable because the embedding dimensions "
            "do not match the index configuration. Please contact the administrator. "
            "Existing documents have been preserved."
        )


class EmbeddingError(RuntimeError):
    """An embedding/index availability error safe to show to the user."""


class EmbeddingCompatibilityError(EmbeddingError):
    """A document cannot safely be searched in the configured embedding space."""

    def __init__(self) -> None:
        super().__init__(
            "One or more selected documents need to be uploaded again in a new chat before they "
            "can be searched safely. Their original files have been preserved."
        )


class WebSearchError(RuntimeError):
    """Search could not obtain usable evidence; safe for client display."""

    def __init__(self) -> None:
        super().__init__(
            "Web search is temporarily unavailable. I could not verify current information. Please try again later."
        )


class DocumentLimitError(ValueError):
    """A document exceeds bounded ingestion capacity."""
