import math
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Sequence, cast

from app.core.config import settings
from app.core.errors import EmbeddingDimensionError, EmbeddingError
from app.core.logging import logger

if TYPE_CHECKING:
    from chromadb.api.types import Metadata, Where


def is_pinecone_configured() -> bool:
    vs_type = (settings.VECTOR_STORE_TYPE or "").strip().lower()
    if vs_type:
        return vs_type == "pinecone"
    return (settings.DB_MODE or "local").strip().lower() in (
        "cloud",
        "turso-pinecone",
        "pinecone",
        "production",
    )


class VectorStoreRepository:
    """
    Thread-safe Repository pattern supporting Pinecone Serverless Vector Store
    with explicit local or cloud backend selection.
    """

    def __init__(self):
        self.use_pinecone = is_pinecone_configured()
        if self.use_pinecone:
            from pinecone import Pinecone

            self.pc = Pinecone(api_key=settings.PINECONE_API_KEY)
            self.index_name = settings.PINECONE_INDEX_NAME
            self.index = self.pc.Index(self.index_name)
            logger.info(
                f"VectorStoreRepository initialized with Pinecone Index '{self.index_name}'"
            )
        else:
            import chromadb

            self.persist_dir = str(settings.CHROMA_PERSIST_DIR)
            self.client = chromadb.PersistentClient(path=self.persist_dir)
            self.collection = self.client.get_or_create_collection(
                name="document_knowledge_base", metadata={"hnsw:space": "cosine"}
            )
            logger.info(
                f"VectorStoreRepository initialized with ChromaDB at {self.persist_dir}"
            )

    def add_chunks(
        self,
        document_id: str,
        chunk_ids: List[str],
        embeddings: List[List[float]],
        documents: List[str],
        metadatas: List[Dict[str, Any]],
    ):
        """Add text chunk embeddings with metadata into Vector Store."""
        # Validate the whole batch before Pinecone can persist an earlier batch.
        if embeddings and (
            not embeddings[0]
            or any(len(vector) != len(embeddings[0]) for vector in embeddings)
        ):
            raise EmbeddingDimensionError()
        try:
            if self.use_pinecone:
                records = []
                for cid, emb, doc, meta in zip(
                    chunk_ids, embeddings, documents, metadatas
                ):
                    clean_meta = {k: v for k, v in meta.items() if v is not None}
                    clean_meta["text"] = doc
                    clean_meta["document_id"] = document_id
                    records.append({"id": cid, "values": emb, "metadata": clean_meta})

                # Upsert in batches of 100
                for i in range(0, len(records), 100):
                    self.index.upsert(vectors=records[i : i + 100])
                logger.info(
                    f"Successfully indexed {len(chunk_ids)} chunks in Pinecone for document_id '{document_id}'"
                )
            else:
                self.collection.add(
                    ids=chunk_ids,
                    embeddings=cast(List[Sequence[float]], embeddings),
                    documents=documents,
                    metadatas=cast("List[Metadata]", metadatas),
                )
                logger.info(
                    f"Successfully indexed {len(chunk_ids)} chunks in ChromaDB for document_id '{document_id}'"
                )
        except Exception as e:
            message = str(e).lower()
            # Chroma versions and Pinecone use different dimension error text.
            # Unknown failures also propagate; none may reset shared data.
            if "expecting embedding with dimension of" in message or (
                "dimension" in message
                and "does not match" in message
                and any(word in message for word in ("embedding", "vector"))
            ):
                logger.warning("Rejected incompatible embedding dimensions")
                raise EmbeddingDimensionError() from e
            logger.exception("Error indexing document chunks")
            raise

    def similarity_search(
        self,
        query_embedding: List[float],
        top_k: int = 4,
        document_ids: Optional[List[str]] = None,
        *,
        embedding_space: str,
    ) -> List[Dict[str, Any]]:
        """
        Perform cosine similarity vector search over indexed chunks.
        Optionally filter by session document_ids.
        """
        if not embedding_space:
            raise EmbeddingError("Document search requires a verified embedding space.")
        if document_ids == []:
            return []
        try:
            if self.use_pinecone:
                filter_clause = None
                if document_ids:
                    if len(document_ids) == 1:
                        filter_clause = {"document_id": {"$eq": document_ids[0]}}
                    else:
                        filter_clause = {"document_id": {"$in": document_ids}}

                space_filter = {"embedding_space": {"$eq": embedding_space}}
                filter_clause = (
                    {"$and": [filter_clause, space_filter]}
                    if filter_clause
                    else space_filter
                )
                results = self.index.query(
                    vector=query_embedding,
                    top_k=top_k,
                    filter=filter_clause,
                    include_metadata=True,
                )

                retrieved_chunks = []
                for match in results.get("matches", []):
                    meta = match.get("metadata", {})
                    if meta.get("embedding_space") != embedding_space or (
                        document_ids is not None
                        and meta.get("document_id") not in document_ids
                    ):
                        continue
                    # Pinecone cosine similarity score
                    raw_score = float(match.get("score", 0.0))
                    if not math.isfinite(raw_score):
                        continue
                    score = round(max(0.0, raw_score), 4)
                    retrieved_chunks.append(
                        {
                            "chunk_id": match.get("id"),
                            "text": meta.get("text", ""),
                            "metadata": meta,
                            "similarity_score": score,
                        }
                    )
                return retrieved_chunks
            else:
                where_clause = None
                if document_ids:
                    if len(document_ids) == 1:
                        where_clause = {"document_id": document_ids[0]}
                    else:
                        where_clause = {"document_id": {"$in": document_ids}}

                space_filter = {"embedding_space": embedding_space}
                where_clause = (
                    {"$and": [where_clause, space_filter]}
                    if where_clause
                    else space_filter
                )
                results = self.collection.query(
                    query_embeddings=[query_embedding],
                    n_results=top_k,
                    where=cast("Optional[Where]", where_clause),
                    include=["documents", "metadatas", "distances"],
                )

                retrieved_chunks = []
                if results.get("ids") and results["ids"][0]:
                    if (
                        not results["documents"]
                        or not results["metadatas"]
                        or not results["distances"]
                    ):
                        return []
                    ids = results["ids"][0]
                    documents = results["documents"][0]
                    metadatas = results["metadatas"][0]
                    distances = results["distances"][0]

                    for i in range(len(ids)):
                        meta = metadatas[i] or {}
                        if meta.get("embedding_space") != embedding_space or (
                            document_ids is not None
                            and meta.get("document_id") not in document_ids
                        ):
                            continue
                        cosine_distance = distances[i]
                        if not math.isfinite(cosine_distance):
                            continue
                        similarity_score = round(max(0.0, 1.0 - cosine_distance), 4)

                        retrieved_chunks.append(
                            {
                                "chunk_id": ids[i],
                                "text": documents[i],
                                "metadata": meta,
                                "similarity_score": similarity_score,
                            }
                        )

                return retrieved_chunks
        except Exception as e:
            logger.exception(f"Vector search failed: {str(e)}")
            raise EmbeddingError(
                "Document search is temporarily unavailable. Please try again later."
            ) from None

    def get_document_chunks(self, document_id: str) -> List[Dict[str, Any]]:
        """Retrieve all indexed chunks and metadata for a specific document."""
        chunks: List[Dict[str, Any]] = []
        try:
            if self.use_pinecone:
                dummy_vector = [0.0] * 768
                results = self.index.query(
                    vector=dummy_vector,
                    top_k=1000,
                    filter={"document_id": {"$eq": document_id}},
                    include_metadata=True,
                )
                chunks = []
                for match in results.get("matches", []):
                    meta = match.get("metadata", {})
                    chunks.append(
                        {
                            "chunk_id": match.get("id"),
                            "chunk_index": meta.get("chunk_index", 0),
                            "page_number": meta.get("page_number"),
                            "text": meta.get("text", ""),
                        }
                    )
                chunks.sort(key=lambda x: x.get("chunk_index", 0))
                return chunks
            else:
                results = self.collection.get(
                    where={"document_id": document_id},
                    include=["documents", "metadatas"],
                )
                chunks = []
                if results.get("ids"):
                    ids = results["ids"]
                    documents = results["documents"] or []
                    metadatas = results["metadatas"] or []
                    for i in range(len(ids)):
                        meta = metadatas[i] if i < len(metadatas) else {}
                        chunks.append(
                            {
                                "chunk_id": ids[i],
                                "chunk_index": meta.get("chunk_index", i),
                                "page_number": meta.get("page_number"),
                                "text": documents[i] if i < len(documents) else "",
                            }
                        )
                    chunks.sort(key=lambda x: x["chunk_index"])
                return chunks
        except Exception as e:
            logger.exception(
                f"Failed to get chunks for document '{document_id}': {str(e)}"
            )
            return []

    def delete_document(self, document_id: str, *, raise_on_error: bool = False):
        """Delete all vectors belonging to a specific document."""
        try:
            if self.use_pinecone:
                self.index.delete(filter={"document_id": {"$eq": document_id}})
                logger.info(f"Deleted Pinecone vectors for document_id '{document_id}'")
            else:
                self.collection.delete(where={"document_id": document_id})
                logger.info(f"Deleted ChromaDB vectors for document_id '{document_id}'")
        except Exception as e:
            logger.error(f"Failed to delete document vectors: {str(e)}")
            if raise_on_error:
                raise

    def clear_all(self):
        """Clear all indexed documents and vector embeddings."""
        try:
            if self.use_pinecone:
                self.index.delete(delete_all=True)
                logger.info("Cleared all vectors from Pinecone index")
            else:
                self.client.delete_collection("document_knowledge_base")
                self.collection = self.client.get_or_create_collection(
                    name="document_knowledge_base", metadata={"hnsw:space": "cosine"}
                )
                logger.info(
                    "Recreated empty ChromaDB collection 'document_knowledge_base'"
                )
        except Exception as e:
            logger.warning(f"Collection clear warning: {e}", exc_info=True)


vector_store_repo = VectorStoreRepository()
