import json
from typing import AsyncGenerator, Optional, List, Dict
from app.schemas.chat import ChatMode, ChatRequest, Citation
from app.repositories.session_store import session_store_repo
from app.services.chat_history_service import chat_history_service
from app.services.rag_service import rag_service
from app.services.web_search_service import web_search_service
from app.services.llm_service import llm_service
from app.core.logging import logger

class ChatOrchestrator:
    """
    Chat Orchestrator implementing Router & Strategy patterns.
    Dispatches query execution to Document RAG, Web Search, or Multimodal strategies,
    and automatically persists conversation history and citations into the relational database.
    """
    async def route_and_stream(self, request: ChatRequest) -> AsyncGenerator[str, None]:
        session_id = request.session_id
        session = session_store_repo.get_or_create_session(session_id)
        
        # Enforce Mode Selection
        if request.mode:
            session.mode = request.mode
            chat_history_service.update_session_mode(session_id, request.mode)
            
        logger.info(f"Orchestrator routing query for session '{session_id}' [Mode: {session.mode.value}]")

        # 0. Retrieve Pre-existing Conversation History for this chat thread
        chat_history = session_store_repo.get_history_messages(session_id)

        # 1. Persist User Prompt to database & in-memory store
        chat_history_service.save_message(
            session_id=session_id,
            role="user",
            content=request.message
        )
        session_store_repo.record_message(session_id, "user", request.message)

        # 2. Auto-generate title if session is brand new / "New Conversation"
        existing_session = chat_history_service.get_session(session_id)
        if existing_session and (existing_session.title == "New Conversation" or not existing_session.title):
            summary_title = request.message.strip().replace("\n", " ")
            if len(summary_title) > 35:
                summary_title = summary_title[:32] + "..."
            chat_history_service.update_session_title(session_id, summary_title)

        # 3. Route to execution strategy with conversation history
        if session.mode == ChatMode.DOCUMENT_RAG:
            async for chunk in self._execute_document_rag(request.message, session_id, chat_history):
                yield chunk
        elif session.mode == ChatMode.WEB_SEARCH:
            async for chunk in self._execute_web_search(request.message, session_id, chat_history):
                yield chunk
        else:
            err_msg = f"Unsupported chat mode: {session.mode.value}"
            chat_history_service.save_message(
                session_id=session_id,
                role="assistant",
                content=err_msg
            )
            session_store_repo.record_message(session_id, "assistant", err_msg)
            yield f"data: {json.dumps({'event': 'error', 'data': err_msg})}\n\n"

    async def _execute_document_rag(
        self,
        query: str,
        session_id: str,
        chat_history: Optional[List[Dict[str, str]]] = None
    ) -> AsyncGenerator[str, None]:
        session = session_store_repo.get_or_create_session(session_id)
        
        if not session.document_ids:
            msg = "⚠️ No documents uploaded to this chat session yet! Please upload a PDF or text file first to ask document-based questions, or switch to Web Search mode."
            chat_history_service.save_message(session_id=session_id, role="assistant", content=msg)
            session_store_repo.record_message(session_id, "assistant", msg)
            yield f"data: {json.dumps({'event': 'token', 'data': msg})}\n\n"
            yield f"data: {json.dumps({'event': 'done', 'data': '[DONE]'})}\n\n"
            return

        # 1. Retrieve relevant chunks
        context_chunks = rag_service.retrieve_context_for_query(query, session_id)
        
        if not context_chunks:
            msg = "I searched your uploaded document(s), but could not find matching information relevant to your question."
            chat_history_service.save_message(session_id=session_id, role="assistant", content=msg)
            session_store_repo.record_message(session_id, "assistant", msg)
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

        # 3. Stream answer token by token with chat history & accumulate
        full_answer = ""
        try:
            async for token in llm_service.stream_rag_answer(query, context_chunks, chat_history):
                full_answer += token
                yield f"data: {json.dumps({'event': 'token', 'data': token})}\n\n"
        except Exception as e:
            logger.error(f"Error during LLM streaming: {e}")
            err_str = f"Error generating answer: {str(e)}"
            yield f"data: {json.dumps({'event': 'error', 'data': err_str})}\n\n"
            full_answer = err_str

        # 4. Persist completed assistant message with citations to SQLite & in-memory
        chat_history_service.save_message(
            session_id=session_id,
            role="assistant",
            content=full_answer,
            citations=citations_data
        )
        session_store_repo.record_message(session_id, "assistant", full_answer)

        yield f"data: {json.dumps({'event': 'done', 'data': '[DONE]'})}\n\n"

    def _is_conversational_query(self, query: str, chat_history: Optional[List[Dict[str, str]]] = None) -> bool:
        """Check if a query is a greeting, follow-up, or conversational prompt that doesn't need external web scraping."""
        q = query.strip().lower().rstrip("?!.,")
        if not q or len(q) < 2:
            return True
        
        conversational_phrases = {
            "hi", "hello", "hey", "hola", "howdy", "sup",
            "good morning", "good afternoon", "good evening", "good night",
            "how are you", "how are you doing", "how r u", "how are u",
            "who are you", "what are you", "what is your name", "what can you do",
            "thank you", "thanks", "thanks a lot", "thx", "ty",
            "tell me a joke", "help me", "what's up", "whats up", "nice to meet you",
            "just one word", "one word", "single word", "in one word",
            "tell me more", "explain more", "summarize", "summarize that", "why", "why?",
            "give me 3 points", "explain in simple terms", "short answer"
        }
        
        if q in conversational_phrases:
            return True
            
        words = q.split()
        if len(words) <= 4 and any(w in conversational_phrases for w in words):
            return True

        # Follow-up conversational directives when prior conversation context already exists
        if chat_history and len(words) <= 4 and any(w in ["word", "points", "short", "more", "why", "again", "explain", "meaning", "summarize"] for w in words):
            return True
            
        return False

    async def _execute_web_search(
        self,
        query: str,
        session_id: str,
        chat_history: Optional[List[Dict[str, str]]] = None
    ) -> AsyncGenerator[str, None]:
        full_answer = ""
        citations_data = []

        # 1. Handle Conversational Greetings & Continuity Follow-ups directly
        if self._is_conversational_query(query, chat_history):
            logger.info(f"Routing query '{query}' to conversational assistant with chat history")
            try:
                async for token in llm_service.stream_conversational_answer(query, chat_history):
                    full_answer += token
                    yield f"data: {json.dumps({'event': 'token', 'data': token})}\n\n"
            except Exception as e:
                logger.error(f"Error during Conversational LLM streaming: {e}")
                err_str = f"Error generating response: {str(e)}"
                yield f"data: {json.dumps({'event': 'error', 'data': err_str})}\n\n"
                full_answer = err_str

            chat_history_service.save_message(
                session_id=session_id,
                role="assistant",
                content=full_answer
            )
            session_store_repo.record_message(session_id, "assistant", full_answer)
            yield f"data: {json.dumps({'event': 'done', 'data': '[DONE]'})}\n\n"
            return

        # 2. Informational Search Query: Execute Search & Emit Sources
        results = web_search_service.search(query)
        
        if results:
            citations = [
                Citation(
                    document_id="",
                    filename=r.get("title", "Web Source"),
                    page_number=None,
                    chunk_index=idx,
                    snippet=f"{r.get('url', '')}\n{r.get('snippet', '')[:160]}",
                    similarity_score=1.0
                )
                for idx, r in enumerate(results) if r.get("title") and r.get("url")
            ]
            citations_data = [c.model_dump() for c in citations]
            if citations_data:
                yield f"data: {json.dumps({'event': 'citations', 'data': '', 'citations': citations_data})}\n\n"

        try:
            async for token in llm_service.stream_web_search_answer(query, results, chat_history):
                full_answer += token
                yield f"data: {json.dumps({'event': 'token', 'data': token})}\n\n"
        except Exception as e:
            logger.error(f"Error during Web Search LLM streaming: {e}")
            err_str = f"Error generating web search answer: {str(e)}"
            yield f"data: {json.dumps({'event': 'error', 'data': err_str})}\n\n"
            full_answer = err_str

        # Persist completed assistant message with citations to SQLite & in-memory
        chat_history_service.save_message(
            session_id=session_id,
            role="assistant",
            content=full_answer,
            citations=citations_data
        )
        session_store_repo.record_message(session_id, "assistant", full_answer)
            
        yield f"data: {json.dumps({'event': 'done', 'data': '[DONE]'})}\n\n"

chat_orchestrator = ChatOrchestrator()
