import json
from typing import AsyncGenerator
from app.schemas.chat import ChatMode, ChatRequest, Citation
from app.repositories.session_store import session_store_repo
from app.services.rag_service import rag_service
from app.services.web_search_service import web_search_service
from app.services.llm_service import llm_service
from app.core.logging import logger

class ChatOrchestrator:
    """
    Chat Orchestrator implementing Router & Strategy patterns.
    Dispatches query execution to Document RAG, Web Search, or Multimodal strategies.
    """
    async def route_and_stream(self, request: ChatRequest) -> AsyncGenerator[str, None]:
        session_id = request.session_id
        session = session_store_repo.get_or_create_session(session_id)
        
        # Enforce Mode Selection or auto-detect
        if request.mode:
            session.mode = request.mode
            
        logger.info(f"Orchestrator routing query for session '{session_id}' [Mode: {session.mode.value}]")

        if session.mode == ChatMode.DOCUMENT_RAG:
            async for chunk in self._execute_document_rag(request.message, session_id):
                yield chunk
        elif session.mode == ChatMode.WEB_SEARCH:
            async for chunk in self._execute_web_search(request.message):
                yield chunk
        else:
            yield f"data: {json.dumps({'event': 'error', 'data': f'Unsupported chat mode: {session.mode.value}'})}\n\n"

    async def _execute_document_rag(self, query: str, session_id: str) -> AsyncGenerator[str, None]:
        session = session_store_repo.get_or_create_session(session_id)
        
        if not session.document_ids:
            msg = "⚠️ No documents uploaded to this chat session yet! Please upload a PDF or text file first to ask document-based questions, or switch to Web Search mode."
            yield f"data: {json.dumps({'event': 'token', 'data': msg})}\n\n"
            yield f"data: {json.dumps({'event': 'done', 'data': '[DONE]'})}\n\n"
            return

        # 1. Retrieve relevant chunks
        context_chunks = rag_service.retrieve_context_for_query(query, session_id)
        
        if not context_chunks:
            msg = "I searched your uploaded document(s), but could not find matching information relevant to your question."
            yield f"data: {json.dumps({'event': 'token', 'data': msg})}\n\n"
            yield f"data: {json.dumps({'event': 'done', 'data': '[DONE]'})}\n\n"
            return

        # 2. Emit Citations event to UI
        citations = [
            Citation(
                document_id=c["metadata"].get("document_id", ""),
                filename=c["metadata"].get("filename", "document"),
                page_number=c["metadata"].get("page_number"),
                chunk_index=c["metadata"].get("chunk_index", 0),
                snippet=c["text"][:180] + "...",
                similarity_score=c.get("similarity_score", 1.0)
            )
            for c in context_chunks
        ]
        
        citations_data = [c.model_dump() for c in citations]
        yield f"data: {json.dumps({'event': 'citations', 'data': '', 'citations': citations_data})}\n\n"

        # 3. Stream answer token by token
        async for token in llm_service.stream_rag_answer(query, context_chunks):
            yield f"data: {json.dumps({'event': 'token', 'data': token})}\n\n"

        yield f"data: {json.dumps({'event': 'done', 'data': '[DONE]'})}\n\n"

    async def _execute_web_search(self, query: str) -> AsyncGenerator[str, None]:
        results = web_search_service.search(query)
        async for token in llm_service.stream_web_search_answer(query, results):
            yield f"data: {json.dumps({'event': 'token', 'data': token})}\n\n"
            
        yield f"data: {json.dumps({'event': 'done', 'data': '[DONE]'})}\n\n"

chat_orchestrator = ChatOrchestrator()
