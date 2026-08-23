import os
import chromadb
from chromadb.config import Settings as ChromaSettings
from typing import List, Dict, Any, Optional
from app.core.config import settings
from app.core.logging import logger

class VectorStoreRepository:
    """
    Thread-safe Repository pattern encapsulating ChromaDB operations for high-dimensional vector search.
    """
    def __init__(self):
        self.persist_dir = str(settings.CHROMA_PERSIST_DIR)
        self.client = chromadb.PersistentClient(path=self.persist_dir)
        self.collection = self.client.get_or_create_collection(
            name="document_knowledge_base",
            metadata={"hnsw:space": "cosine"}
        )
        logger.info(f"VectorStoreRepository initialized at {self.persist_dir}")

    def add_chunks(
        self,
        document_id: str,
        chunk_ids: List[str],
        embeddings: List[List[float]],
        documents: List[str],
        metadatas: List[Dict[str, Any]]
    ):
        """Add text chunk embeddings with metadata into ChromaDB collection."""
        try:
            self.collection.add(
                ids=chunk_ids,
                embeddings=embeddings,
                documents=documents,
                metadatas=metadatas
            )
            logger.info(f"Successfully indexed {len(chunk_ids)} chunks for document_id '{document_id}'")
        except Exception as e:
            logger.error(f"Error indexing chunks in VectorStoreRepository: {str(e)}")
            raise e

    def similarity_search(
        self,
        query_embedding: List[float],
        top_k: int = 4,
        document_ids: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """
        Perform cosine similarity vector search over indexed chunks.
        Optionally filter by session document_ids.
        """
        try:
            where_clause = None
            if document_ids:
                if len(document_ids) == 1:
                    where_clause = {"document_id": document_ids[0]}
                else:
                    where_clause = {"document_id": {"$in": document_ids}}

            results = self.collection.query(
                query_embeddings=[query_embedding],
                n_results=top_k,
                where=where_clause,
                include=["documents", "metadatas", "distances"]
            )

            retrieved_chunks = []
            if results and results.get("ids") and results["ids"][0]:
                ids = results["ids"][0]
                documents = results["documents"][0]
                metadatas = results["metadatas"][0]
                distances = results["distances"][0]

                for i in range(len(ids)):
                    # Cosine distance to similarity score
                    cosine_distance = distances[i]
                    similarity_score = round(max(0.0, 1.0 - cosine_distance), 4)

                    retrieved_chunks.append({
                        "chunk_id": ids[i],
                        "text": documents[i],
                        "metadata": metadatas[i],
                        "similarity_score": similarity_score
                    })

            return retrieved_chunks
        except Exception as e:
            logger.error(f"Vector search failed: {str(e)}")
            return []

    def get_document_chunks(self, document_id: str) -> List[Dict[str, Any]]:
        """Retrieve all indexed chunks and metadata for a specific document."""
        try:
            results = self.collection.get(
                where={"document_id": document_id},
                include=["documents", "metadatas"]
            )
            chunks = []
            if results and results.get("ids"):
                ids = results["ids"]
                documents = results["documents"] or []
                metadatas = results["metadatas"] or []
                for i in range(len(ids)):
                    meta = metadatas[i] if i < len(metadatas) else {}
                    chunks.append({
                        "chunk_id": ids[i],
                        "chunk_index": meta.get("chunk_index", i),
                        "page_number": meta.get("page_number"),
                        "text": documents[i] if i < len(documents) else ""
                    })
                # Sort by chunk_index
                chunks.sort(key=lambda x: x["chunk_index"])
            return chunks
        except Exception as e:
            logger.error(f"Failed to get chunks for document '{document_id}': {str(e)}")
            return []

    def delete_document(self, document_id: str):

        """Delete all vectors belonging to a specific document."""
        try:
            self.collection.delete(where={"document_id": document_id})
            logger.info(f"Deleted vectors for document_id '{document_id}'")
        except Exception as e:
            logger.error(f"Failed to delete document vectors: {str(e)}")

    def clear_all(self):
        """Clear all indexed documents and vector embeddings from ChromaDB."""
        try:
            self.client.delete_collection("document_knowledge_base")
            logger.info("Deleted ChromaDB collection 'document_knowledge_base'")
        except Exception as e:
            logger.warning(f"Collection deletion warning: {e}")
        
        self.collection = self.client.get_or_create_collection(
            name="document_knowledge_base",
            metadata={"hnsw:space": "cosine"}
        )
        logger.info("Recreated empty ChromaDB collection 'document_knowledge_base'")

vector_store_repo = VectorStoreRepository()
