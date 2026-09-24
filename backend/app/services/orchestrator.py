import json
import re
from typing import AsyncGenerator, Optional, List, Dict, Any
from app.schemas.chat import ChatMode, ChatRequest, Citation, MediaAttachment
from app.repositories.session_store import session_store_repo
from app.services.chat_history_service import chat_history_service
from app.services.rag_service import rag_service
from app.services.web_search_service import web_search_service
from app.services.llm_service import llm_service
from app.services.image_gen_service import image_gen_service
from app.services.media_service import media_service
from app.core.logging import logger

class ChatOrchestrator:
    """
    Chat Orchestrator implementing Router & Strategy patterns.
    Dispatches query execution to Multimodal Vision, Image Generation (Imagen 3),
    Document RAG, or Web Search strategies, and persists conversation history,
    citations, and attachments in SQLite/Turso.
    """
    def _is_image_gen_intent(self, query: str) -> bool:
        """Detect if the user prompt explicitly requests image generation/drawing."""
        q = query.strip().lower()
        if q.startswith(("/imagine", "/image", "image:", "draw:", "generate:")):
            return True
        patterns = [
            r"^(generate|create|make|draw|paint|produce|render)\s+(an?|me\s+an?)\s+(image|picture|photo|illustration|artwork|drawing|painting|logo|graphic)",
            r"^(draw|paint)\s+(a|an|me)\s+",
            r"^can\s+you\s+(draw|generate|paint|create)\s+(an?|me\s+an?)\s+(image|picture|photo)",
            r"^(recreate|turn\s+this|transform\s+this|remix\s+this)\s+(image|picture|sketch|photo)",
        ]
        return any(re.search(p, q) for p in patterns)

    def _clean_image_prompt(self, query: str) -> str:
        """Strip command prefixes from image generation prompt."""
        q = query.strip()
        for prefix in ["/imagine", "/image", "image:", "draw:", "generate:"]:
            if q.lower().startswith(prefix):
                return q[len(prefix):].strip()
        
        # Strip common leading patterns like 'generate an image of'
        cleaned = re.sub(
            r"^(please\s+)?(generate|create|make|draw|paint|render)\s+(an?|me\s+an?)\s+(image|picture|photo|illustration|artwork)\s+(of|showing|depicting)?\s*",
            "",
            q,
            flags=re.IGNORECASE
        )
        return cleaned.strip() if cleaned.strip() else q

    def _find_recent_image_attachments(self, chat_history: Optional[List[Dict[str, Any]]]) -> List[MediaAttachment]:
        """Find the most recent image attachments from previous turns in the chat history."""
        if not chat_history:
            return []
        for msg in reversed(chat_history):
            raw_atts = msg.get("attachments") or []
            image_atts = []
            for a in raw_atts:
                if isinstance(a, dict):
                    if a.get("file_type") == "image" or (a.get("mime_type") or "").startswith("image/"):
                        image_atts.append(MediaAttachment(**a))
                elif hasattr(a, "file_type") and a.file_type == "image":
                    image_atts.append(a)
            if image_atts:
                return image_atts
        return []

    def _is_visual_query(self, query: str) -> bool:
        """Check if user query is asking about an image, visual element, or OCR."""
        q = query.strip().lower()
        visual_keywords = [
            "image", "picture", "photo", "diagram", "chart", "table", "screenshot", "receipt",
            "drawing", "what do you see", "what is in", "what is this", "describe", "read the text",
            "ocr", "transcribe", "what does it say", "color", "shown", "visual", "look like",
            "this picture", "the picture", "this image", "the image", "in the photo"
        ]
        return any(k in q for k in visual_keywords)

    def _needs_web_search(self, query: str) -> bool:
        """Detect if the query asks about real-time, current events, live data, or web search."""
        q = query.strip().lower()
        search_indicators = [
            "search", "google", "web search", "browse", "look up",
            "latest", "today", "yesterday", "recent", "breaking news",
            "weather", "stock price", "stock", "score", "match result",
            "who won", "current president", "release date", "election",
            "2025", "2026", "2027"
        ]
        return any(indicator in q for indicator in search_indicators)

    def _is_conversational_query(self, query: str, chat_history: Optional[List[Dict[str, Any]]] = None) -> bool:
        """Check if a query is a greeting, follow-up, or conversational prompt that doesn't need external web scraping."""
        q = query.strip().lower()
        cleaned_q = re.sub(r"[^\w\s]", " ", q).strip()
        if not cleaned_q or len(cleaned_q) < 2:
            return True
        
        conversational_phrases = [
            "hi", "hello", "hey", "hola", "howdy", "sup",
            "good morning", "good afternoon", "good evening", "good night",
            "how are you", "how are you doing", "how r u", "how are u", "how are you today",
            "who are you", "what are you", "what is your name", "what can you do",
            "thank you", "thanks", "thanks a lot", "thx", "ty",
            "tell me a joke", "help me", "what's up", "whats up", "nice to meet you",
            "just one word", "one word", "single word", "in one word",
            "tell me more", "explain more", "summarize", "summarize that", "why",
            "give me 3 points", "explain in simple terms", "short answer"
        ]
        
        # Check if the query is or starts with any of these phrases
        for phrase in conversational_phrases:
            if cleaned_q == phrase or cleaned_q.startswith(phrase + " ") or (" " + phrase + " ") in (" " + cleaned_q + " "):
                return True
            
        words = cleaned_q.split()
        if len(words) <= 6 and any(w in ["hi", "hello", "hey", "thanks", "thank", "bye", "goodbye"] for w in words):
            return True

        # Follow-up conversational directives when prior conversation context already exists
        if chat_history and len(words) <= 6 and any(w in ["word", "points", "short", "more", "why", "again", "explain", "meaning", "summarize", "it", "this", "that"] for w in words):
            return True
            
        return False

    async def _emit_simple_message(self, message: str, session_id: str) -> AsyncGenerator[str, None]:
        """Emit a simple assistant text response and persist to history."""
        chat_history_service.save_message(session_id=session_id, role="assistant", content=message)
        session_store_repo.record_message(session_id, "assistant", message)
        yield f"data: {json.dumps({'event': 'token', 'data': message})}\n\n"
        yield f"data: {json.dumps({'event': 'done', 'data': '[DONE]'})}\n\n"

    async def _execute_conversational(
        self,
        query: str,
        session_id: str,
        chat_history: Optional[List[Dict[str, Any]]] = None
    ) -> AsyncGenerator[str, None]:
        """Direct conversational response with full multi-turn chat memory."""
        full_answer = ""
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

    async def route_and_stream(self, request: ChatRequest) -> AsyncGenerator[str, None]:
        session_id = request.session_id
        session = session_store_repo.get_or_create_session(session_id)
        
        # Enforce Mode Selection if client passed an explicit mode
        if request.mode:
            session.mode = request.mode
            chat_history_service.update_session_mode(session_id, request.mode)
            
        logger.info(f"Orchestrator routing query for session '{session_id}' [Mode: {session.mode.value}] Attachments: {len(request.attachments or [])}")

        # 0. Retrieve Pre-existing Conversation History for this chat thread
        chat_history = session_store_repo.get_history_messages(session_id)

        # 1. Persist User Prompt to database & in-memory store with attachments
        chat_history_service.save_message(
            session_id=session_id,
            role="user",
            content=request.message or "",
            attachments=request.attachments
        )
        session_store_repo.record_message(session_id, "user", request.message or "", attachments=request.attachments)

        # 2. Auto-generate title if session is brand new / "New Conversation"
        existing_session = chat_history_service.get_session(session_id)
        if existing_session and (existing_session.title == "New Conversation" or not existing_session.title):
            summary_title = (request.message or "Conversation").strip().replace("\n", " ")
            if len(summary_title) > 35:
                summary_title = summary_title[:32] + "..."
            chat_history_service.update_session_title(session_id, summary_title)

        query = request.message or ""
        recent_images = self._find_recent_image_attachments(chat_history)

        # =========================================================================
        # 3. Explicit Mode Handlers (with graceful conversational Q&A fallback)
        # =========================================================================

        # 3a. Explicit IMAGE_GENERATION Mode
        if session.mode == ChatMode.IMAGE_GENERATION:
            if self._is_conversational_query(query, chat_history) and not self._is_image_gen_intent(query):
                async for chunk in self._execute_conversational(query, session_id, chat_history):
                    yield chunk
                return
            async for chunk in self._execute_image_generation(request, session_id):
                yield chunk
            return

        # 3b. Explicit MULTIMODAL Mode
        if session.mode == ChatMode.MULTIMODAL:
            # If current request has attachments, use them directly
            if request.attachments and len(request.attachments) > 0:
                async for chunk in self._execute_multimodal(request, session_id, chat_history):
                    yield chunk
                return
            # If no current attachments, but recent image exists in history
            if recent_images:
                req_with_recent = request.model_copy(update={"attachments": recent_images})
                async for chunk in self._execute_multimodal(req_with_recent, session_id, chat_history):
                    yield chunk
                return
            # If conversational query or greeting
            if self._is_conversational_query(query, chat_history):
                async for chunk in self._execute_conversational(query, session_id, chat_history):
                    yield chunk
                return
            msg = "Please attach an image or document to analyze with Vision & OCR, or ask any general question."
            async for chunk in self._emit_simple_message(msg, session_id):
                yield chunk
            return

        # 3c. Explicit DOCUMENT_RAG Mode
        if session.mode == ChatMode.DOCUMENT_RAG:
            # If conversational greeting or general follow-up without document query
            if self._is_conversational_query(query, chat_history):
                async for chunk in self._execute_conversational(query, session_id, chat_history):
                    yield chunk
                return
            async for chunk in self._execute_document_rag(query, session_id, chat_history, allow_fallback=False):
                yield chunk
            return

        # 3d. Explicit WEB_SEARCH Mode
        if session.mode == ChatMode.WEB_SEARCH:
            async for chunk in self._execute_web_search(query, session_id, chat_history):
                yield chunk
            return

        # =========================================================================
        # 4. AUTO (Smart AI / ChatGPT-style) Dynamic Routing
        # =========================================================================

        # Case A: Explicit Image Generation Intent
        if self._is_image_gen_intent(query):
            async for chunk in self._execute_image_generation(request, session_id):
                yield chunk
            return

        # Case B: Current request contains attached images or media
        if request.attachments and len(request.attachments) > 0:
            async for chunk in self._execute_multimodal(request, session_id, chat_history):
                yield chunk
            return

        # Case C: Recent image exists in history + visual follow-up or conversational query
        if recent_images and (self._is_visual_query(query) or self._is_conversational_query(query, chat_history)):
            req_with_recent = request.model_copy(update={"attachments": recent_images})
            async for chunk in self._execute_multimodal(req_with_recent, session_id, chat_history):
                yield chunk
            return

        # Case D: Conversational greeting or short follow-up
        if self._is_conversational_query(query, chat_history):
            async for chunk in self._execute_conversational(query, session_id, chat_history):
                yield chunk
            return

        # Case E: Session has uploaded documents -> retrieve context
        if session.document_ids and len(session.document_ids) > 0:
            chunks = rag_service.retrieve_context_for_query(query, session_id)
            if chunks:
                async for chunk in self._execute_document_rag(query, session_id, chat_history, context_chunks=chunks, allow_fallback=True):
                    yield chunk
                return

        # Case F: Query requires real-time web search
        if self._needs_web_search(query):
            async for chunk in self._execute_web_search(query, session_id, chat_history):
                yield chunk
            return

        # Case G: Default general knowledge / reasoning / coding / conversation
        async for chunk in self._execute_conversational(query, session_id, chat_history):
            yield chunk

    async def _execute_document_rag(
        self,
        query: str,
        session_id: str,
        chat_history: Optional[List[Dict[str, Any]]] = None,
        context_chunks: Optional[List[Dict[str, Any]]] = None,
        allow_fallback: bool = True
    ) -> AsyncGenerator[str, None]:
        session = session_store_repo.get_or_create_session(session_id)
        
        if not session.document_ids:
            if allow_fallback:
                async for chunk in self._execute_conversational(query, session_id, chat_history):
                    yield chunk
                return
            msg = "⚠️ No documents uploaded to this chat session yet! Please upload a PDF or text file first to ask document-based questions, or switch to Auto / Web Search mode."
            async for chunk in self._emit_simple_message(msg, session_id):
                yield chunk
            return

        # 1. Retrieve relevant chunks if not provided
        if context_chunks is None:
            context_chunks = rag_service.retrieve_context_for_query(query, session_id)
        
        if not context_chunks:
            if allow_fallback:
                async for chunk in self._execute_conversational(query, session_id, chat_history):
                    yield chunk
                return
            msg = "I searched your uploaded document(s), but could not find matching information relevant to your question."
            async for chunk in self._emit_simple_message(msg, session_id):
                yield chunk
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

    async def _execute_web_search(
        self,
        query: str,
        session_id: str,
        chat_history: Optional[List[Dict[str, Any]]] = None
    ) -> AsyncGenerator[str, None]:
        full_answer = ""
        citations_data = []

        # 1. Handle Conversational Greetings & Continuity Follow-ups directly
        if self._is_conversational_query(query, chat_history):
            logger.info(f"Routing query '{query}' to conversational assistant with chat history")
            async for chunk in self._execute_conversational(query, session_id, chat_history):
                yield chunk
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

    async def _execute_image_generation(
        self,
        request: ChatRequest,
        session_id: str
    ) -> AsyncGenerator[str, None]:
        prompt = self._clean_image_prompt(request.message or "Creative artwork")
        loading_text = f"🎨 *Generating image for '{prompt}'...*\n\n"
        yield f"data: {json.dumps({'event': 'token', 'data': loading_text})}\n\n"

        try:
            # Check if reference image exists in attachments
            ref_attachment = None
            if request.attachments:
                for att in request.attachments:
                    if att.file_type == "image":
                        ref_attachment = att
                        break

            generated_media: Optional[MediaAttachment] = None
            if ref_attachment:
                local_ref = media_service.resolve_local_path(ref_attachment.url)
                if local_ref and local_ref.exists():
                    logger.info(f"Generating image from reference: {local_ref}")
                    generated_media = await image_gen_service.generate_from_reference(
                        prompt=prompt,
                        reference_image_path=str(local_ref),
                        session_id=session_id
                    )
            
            if not generated_media:
                generated_media = await image_gen_service.generate_image(
                    prompt=prompt,
                    session_id=session_id
                )

            # Send media event to client
            yield f"data: {json.dumps({'event': 'media', 'data': '', 'media': generated_media.model_dump()})}\n\n"
            
            done_caption = f"Here is your generated image based on: **{prompt}**"
            yield f"data: {json.dumps({'event': 'token', 'data': done_caption})}\n\n"

            # Save assistant message with generated attachment
            chat_history_service.save_message(
                session_id=session_id,
                role="assistant",
                content=done_caption,
                attachments=[generated_media]
            )
            session_store_repo.record_message(
                session_id=session_id,
                role="assistant",
                content=done_caption,
                attachments=[generated_media]
            )

        except Exception as e:
            logger.error(f"Image generation execution error: {e}")
            err_msg = f"⚠️ Sorry, could not generate image: {str(e)}"
            yield f"data: {json.dumps({'event': 'error', 'data': err_msg})}\n\n"
            chat_history_service.save_message(session_id=session_id, role="assistant", content=err_msg)
            session_store_repo.record_message(session_id, "assistant", err_msg)

        yield f"data: {json.dumps({'event': 'done', 'data': '[DONE]'})}\n\n"

    async def _execute_multimodal(
        self,
        request: ChatRequest,
        session_id: str,
        chat_history: Optional[List[Dict[str, Any]]] = None
    ) -> AsyncGenerator[str, None]:
        full_answer = ""
        try:
            async for token in llm_service.stream_multimodal_answer(
                query=request.message or "",
                attachments=request.attachments or [],
                chat_history=chat_history
            ):
                full_answer += token
                yield f"data: {json.dumps({'event': 'token', 'data': token})}\n\n"
        except Exception as e:
            logger.error(f"Multimodal vision execution error: {e}")
            err_msg = f"⚠️ Error analyzing image/document: {str(e)}"
            yield f"data: {json.dumps({'event': 'error', 'data': err_msg})}\n\n"
            full_answer = err_msg

        # Persist assistant response
        chat_history_service.save_message(
            session_id=session_id,
            role="assistant",
            content=full_answer
        )
        session_store_repo.record_message(session_id, "assistant", full_answer)
        yield f"data: {json.dumps({'event': 'done', 'data': '[DONE]'})}\n\n"

chat_orchestrator = ChatOrchestrator()
