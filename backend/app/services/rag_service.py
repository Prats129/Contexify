import uuid
from pathlib import Path
from typing import List, Dict, Any, Tuple
from pypdf import PdfReader
from app.core.config import settings
from app.core.logging import logger
from app.schemas.document import DocumentMetadata, ChunkMetadata
from app.repositories.vector_store import vector_store_repo
from app.repositories.session_store import session_store_repo
from app.services.embedding_service import embedding_service

class RAGService:
    """
    Core Document RAG Service: Parsing, Chunking, Vectorizing, Indexing, and Retrieval.
    """
    
    def extract_text_from_file(self, file_path: Path) -> List[Tuple[str, int]]:
        """
        Extract text from file.
        Returns list of tuples: (page_text, page_number).
        """
        ext = file_path.suffix.lower()
        pages = []
        
        if ext == ".pdf":
            try:
                reader = PdfReader(file_path)
                for idx, page in enumerate(reader.pages):
                    text = page.extract_text() or ""
                    if text.strip():
                        pages.append((text, idx + 1))
            except Exception as e:
                logger.error(f"Error parsing PDF file '{file_path.name}': {e}")
                raise e
        elif ext in [".txt", ".md", ".csv", ".json", ".log"]:
            try:
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                    pages.append((content, 1))
            except Exception as e:
                logger.error(f"Error reading text file '{file_path.name}': {e}")
                raise e
        else:
            raise ValueError(f"Unsupported file format: {ext}")
            
        return pages

    def recursive_character_chunking(
        self,
        pages: List[Tuple[str, int]],
        chunk_size: int = settings.CHUNK_SIZE,
        chunk_overlap: int = settings.CHUNK_OVERLAP
    ) -> List[Dict[str, Any]]:
        """
        Splits text pages recursively maintaining paragraph and sentence boundaries.
        """
        chunks = []
        
        for page_text, page_num in pages:
            # Paragraph level split -> Sentence level split -> Character level split
            separators = ["\n\n", "\n", ". ", " ", ""]
            
            raw_splits = [page_text]
            for sep in separators:
                next_splits = []
                for s in raw_splits:
                    if len(s) > chunk_size:
                        if sep == "":
                            # Character split fallback
                            parts = [s[i:i+chunk_size] for i in range(0, len(s), chunk_size - chunk_overlap)]
                            next_splits.extend(parts)
                        else:
                            parts = s.split(sep)
                            current_chunk = ""
                            for p in parts:
                                piece = p + sep if sep != "" else p
                                if len(current_chunk) + len(piece) <= chunk_size:
                                    current_chunk += piece
                                else:
                                    if current_chunk.strip():
                                        next_splits.append(current_chunk.strip())
                                    current_chunk = piece
                            if current_chunk.strip():
                                next_splits.append(current_chunk.strip())
                    else:
                        if s.strip():
                            next_splits.append(s.strip())
                raw_splits = next_splits

            for chunk_idx, text_chunk in enumerate(raw_splits):
                if len(text_chunk.strip()) > 15:  # Ignore tiny noise chunks
                    chunks.append({
                        "text": text_chunk.strip(),
                        "page_number": page_num,
                        "chunk_index": len(chunks)
                    })

        return chunks

    def process_and_index_document(self, file_path: Path, filename: str, session_id: str) -> DocumentMetadata:
        """
        Full ingestion pipeline: Extract -> Chunk -> Embed -> Index -> Register Metadata.
        """
        document_id = str(uuid.uuid4())
        file_size = file_path.stat().st_size
        file_type = file_path.suffix.lower()

        logger.info(f"Ingesting document '{filename}' ({file_size} bytes) for session '{session_id}'...")

        # 1. Extract
        pages = self.extract_text_from_file(file_path)
        if not pages:
            raise ValueError("No extractable text found in uploaded document.")

        # 2. Chunk
        chunks = self.recursive_character_chunking(pages)
        if not chunks:
            raise ValueError("Document could not be split into valid text chunks.")

        # 3. Vectorize
        chunk_texts = [c["text"] for c in chunks]
        embeddings = embedding_service.embed_batch(chunk_texts)

        # 4. Store in ChromaDB
        chunk_ids = [f"{document_id}_chunk_{c['chunk_index']}" for c in chunks]
        metadatas = [
            {
                "document_id": document_id,
                "filename": filename,
                "page_number": c["page_number"],
                "chunk_index": c["chunk_index"]
            }
            for c in chunks
        ]

        vector_store_repo.add_chunks(
            document_id=document_id,
            chunk_ids=chunk_ids,
            embeddings=embeddings,
            documents=chunk_texts,
            metadatas=metadatas
        )

        # 5. Metadata Registration
        doc_metadata = DocumentMetadata(
            document_id=document_id,
            filename=filename,
            file_type=file_type,
            file_size_bytes=file_size,
            total_chunks=len(chunks),
            uploaded_at=Path(file_path).stat().st_mtime.__str__()
        )

        session_store_repo.save_document_metadata(doc_metadata, session_id=session_id)
        session_store_repo.attach_document_to_session(session_id, document_id)

        logger.info(f"Document '{filename}' indexed successfully into ChromaDB with {len(chunks)} chunks.")
        return doc_metadata

    def retrieve_context_for_query(self, query: str, session_id: str) -> List[Dict[str, Any]]:
        """
        Generate query vector and retrieve top-K relevant chunks with similarity score filter.
        """
        session = session_store_repo.get_or_create_session(session_id)
        if not session.document_ids:
            logger.warning(f"No documents attached to session '{session_id}'")
            return []

        # Generate query vector
        query_embedding = embedding_service.embed_text(query)

        # Vector similarity search
        retrieved = vector_store_repo.similarity_search(
            query_embedding=query_embedding,
            top_k=settings.TOP_K_RETRIEVAL,
            document_ids=session.document_ids
        )

        # Filter by threshold
        valid_chunks = [
            c for c in retrieved 
            if c["similarity_score"] >= settings.SIMILARITY_THRESHOLD
        ]
        
        # If threshold filtered all out, return top retrieved anyway to prevent empty response
        if not valid_chunks and retrieved:
            valid_chunks = retrieved[:2]

        return valid_chunks

rag_service = RAGService()
