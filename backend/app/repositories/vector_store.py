import os
from typing import List, Dict, Any, Optional
from app.core.config import settings
from app.core.logging import logger

def is_pinecone_configured() -> bool:
    # 1. Check explicit VECTOR_STORE_TYPE override
    vs_type = (settings.VECTOR_STORE_TYPE or "").strip().lower()
    if vs_type in ["chroma", "chromadb", "local"]:
        return False
    if vs_type == "pinecone":
        key = (settings.PINECONE_API_KEY or "").strip()
        return bool(key and not key.startswith("paste_"))

    # 2. Check general DB_MODE (default: "local" uses ChromaDB)
    db_mode = (settings.DB_MODE or "local").strip().lower()
    if db_mode in ["local", "sqlite", "chroma", "chromadb"]:
        return False
    if db_mode in ["cloud", "turso-pinecone", "pinecone", "production"]:
        key = (settings.PINECONE_API_KEY or "").strip()
        return bool(key and not key.startswith("paste_"))

    key = (settings.PINECONE_API_KEY or "").strip()
    return bool(key and not key.startswith("paste_"))

class VectorStoreRepository:
    """
    Thread-safe Repository pattern supporting Pinecone Serverless Vector Store
    with automatic ChromaDB local fallback.
    """
    def __init__(self):
        self.use_pinecone = is_pinecone_configured()
        if self.use_pinecone:
            from pinecone import Pinecone
            self.pc = Pinecone(api_key=settings.PINECONE_API_KEY)
            self.index_name = settings.PINECONE_INDEX_NAME
            self.index = self.pc.Index(self.index_name)
            logger.info(f"VectorStoreRepository initialized with Pinecone Index '{self.index_name}'")
        else:
            import chromadb
            self.persist_dir = str(settings.CHROMA_PERSIST_DIR)
            self.client = chromadb.PersistentClient(path=self.persist_dir)
            self.collection = self.client.get_or_create_collection(
                name="document_knowledge_base",
                metadata={"hnsw:space": "cosine"}
            )
            logger.info(f"VectorStoreRepository initialized with ChromaDB at {self.persist_dir}")

    def add_chunks(
        self,
        document_id: str,
        chunk_ids: List[str],
        embeddings: List[List[float]],
        documents: List[str],
        metadatas: List[Dict[str, Any]]
    ):
        """Add text chunk embeddings with metadata into Vector Store."""
        try:
            if self.use_pinecone:
                records = []
                for cid, emb, doc, meta in zip(chunk_ids, embeddings, documents, metadatas):
                    clean_meta = {k: v for k, v in meta.items() if v is not None}
                    clean_meta["text"] = doc
                    clean_meta["document_id"] = document_id
                    records.append({"id": cid, "values": emb, "metadata": clean_meta})
                
                # Upsert in batches of 100
                for i in range(0, len(records), 100):
                    self.index.upsert(vectors=records[i:i+100])
                logger.info(f"Successfully indexed {len(chunk_ids)} chunks in Pinecone for document_id '{document_id}'")
            else:
                self.collection.add(
                    ids=chunk_ids,
                    embeddings=embeddings,
                    documents=documents,
                    metadatas=metadatas
                )
                logger.info(f"Successfully indexed {len(chunk_ids)} chunks in ChromaDB for document_id '{document_id}'")
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
            if self.use_pinecone:
                filter_clause = None
                if document_ids:
                    if len(document_ids) == 1:
                        filter_clause = {"document_id": {"$eq": document_ids[0]}}
                    else:
                        filter_clause = {"document_id": {"$in": document_ids}}

                results = self.index.query(
                    vector=query_embedding,
                    top_k=top_k,
                    filter=filter_clause,
                    include_metadata=True
                )

                retrieved_chunks = []
                for match in results.get("matches", []):
                    meta = match.get("metadata", {})
                    # Pinecone cosine similarity score
                    score = round(max(0.0, float(match.get("score", 0.0))), 4)
                    retrieved_chunks.append({
                        "chunk_id": match.get("id"),
                        "text": meta.get("text", ""),
                        "metadata": meta,
                        "similarity_score": score
                    })
                return retrieved_chunks
            else:
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
            if self.use_pinecone:
                dummy_vector = [0.0] * 768
                results = self.index.query(
                    vector=dummy_vector,
                    top_k=1000,
                    filter={"document_id": {"$eq": document_id}},
                    include_metadata=True
                )
                chunks = []
                for match in results.get("matches", []):
                    meta = match.get("metadata", {})
                    chunks.append({
                        "chunk_id": match.get("id"),
                        "chunk_index": meta.get("chunk_index", 0),
                        "page_number": meta.get("page_number"),
                        "text": meta.get("text", "")
                    })
                chunks.sort(key=lambda x: x.get("chunk_index", 0))
                return chunks
            else:
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
                    chunks.sort(key=lambda x: x["chunk_index"])
                return chunks
        except Exception as e:
            logger.error(f"Failed to get chunks for document '{document_id}': {str(e)}")
            return []

    def delete_document(self, document_id: str):
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

    def clear_all(self):
        """Clear all indexed documents and vector embeddings."""
        try:
            if self.use_pinecone:
                self.index.delete(delete_all=True)
                logger.info("Cleared all vectors from Pinecone index")
            else:
                self.client.delete_collection("document_knowledge_base")
                self.collection = self.client.get_or_create_collection(
                    name="document_knowledge_base",
                    metadata={"hnsw:space": "cosine"}
                )
                logger.info("Recreated empty ChromaDB collection 'document_knowledge_base'")
        except Exception as e:
            logger.warning(f"Collection clear warning: {e}")

vector_store_repo = VectorStoreRepository()
