import asyncio
import json
import re
from contextlib import aclosing
from contextvars import ContextVar
from typing import Any, AsyncGenerator, Dict, List, Literal, Optional

from anyio import CancelScope

from app.core.concurrency import run_blocking
from app.core.errors import ImageGenerationError, TextGenerationError
from app.core.logging import logger
from app.repositories.session_store import session_store_repo
from app.schemas.chat import (
    ChatMode,
    ChatRequest,
    Citation,
    MediaAttachment,
    MessageAcknowledgement,
)
from app.services.chat_history_service import chat_history_service
from app.services.image_gen_service import image_gen_service
from app.services.llm_service import llm_service
from app.services.rag_service import rag_service
from app.services.web_search_service import web_search_service

_saved_messages: ContextVar[Optional[Dict[str, bool]]] = ContextVar(
    "saved_stream_messages", default=None
)


class ChatOrchestrator:
    """
    Chat Orchestrator implementing Router & Strategy patterns.
    Dispatches query execution to Multimodal Vision, image generation,
    Document RAG, or Web Search strategies, and persists conversation history,
    citations, and attachments in SQLite/Turso.
    """

    def _is_image_gen_intent(self, query: str) -> bool:
        """Detect if the user prompt explicitly requests image generation/drawing."""
        q = query.strip().lower()
        if q.startswith(("/imagine", "/image", "image:", "draw:", "generate:")):
            return True
        patterns = [
            # generate / create / draw / paint / produce / make [an/a] image/picture/photo/etc. [of ...]
            r"\b(generate|create|make|draw|paint|produce|render)\s+(an?\s+)?(image|picture|photo|illustration|artwork|drawing|painting|logo|graphic|portrait|sketch|wallpaper)\b",
            # can/could/please draw / generate / paint / create [me] [an/a] [image of] ...
            r"\b(can|could|please|would\s+you)\s+(you\s+)?(draw|generate|paint|create|make|render)\b",
            # draw / paint / sketch [me] [a/an] <anything>
            r"^(draw|paint|sketch|illustrate)\s+",
            # image of ... / picture of ... / photo of ...
            r"^(image|picture|photo|drawing|illustration|sketch|wallpaper)\s+of\s+",
            # transform / turn / remix this into an image
            r"\b(recreate|turn\s+this|transform\s+this|remix\s+this)\s+(into\s+)?(an?\s+)?(image|picture|sketch|photo)\b",
        ]
        return any(re.search(p, q) for p in patterns)

    def _clean_image_prompt(self, query: str) -> str:
        """Strip command prefixes from image generation prompt."""
        q = query.strip()
        for prefix in ["/imagine", "/image", "image:", "draw:", "generate:"]:
            if q.lower().startswith(prefix):
                return q[len(prefix) :].strip()

        # Strip common leading patterns like 'generate an image of', 'draw me a', 'draw', etc.
        cleaned = re.sub(
            r"^(please\s+)?(can\s+you\s+)?(generate|create|make|draw|paint|render)\s+(me\s+)?(an?\s+)?(image|picture|photo|illustration|artwork|drawing|painting)?\s*(of\s+|showing\s+|depicting\s+)?",
            "",
            q,
            flags=re.IGNORECASE,
        )
        return cleaned.strip() if cleaned.strip() else q

    def _find_recent_image_attachments(
        self, chat_history: Optional[List[Dict[str, Any]]], principal
    ) -> List[MediaAttachment]:
        """Find the most recent image attachments from previous turns in the chat history."""
        if not chat_history:
            return []
        for msg in reversed(chat_history):
            raw_atts = msg.get("attachments") or []
            image_atts = []
            for a in raw_atts:
                if isinstance(a, dict):
                    if a.get("file_type") == "image" or (
                        a.get("mime_type") or ""
                    ).startswith("image/"):
                        image_atts.append(MediaAttachment(**a))
                elif hasattr(a, "file_type") and a.file_type == "image":
                    image_atts.append(a)
            authorized = []
            from fastapi import HTTPException

            from app.core.security import check_asset
            from app.services.storage_service import storage_service

            for attachment in image_atts:
                try:
                    row = check_asset(attachment.id or "", principal)
                    key = storage_service.owned_storage_key(row, "media")
                    authorized.append(attachment.model_copy(update={"url": key}))
                except HTTPException:
                    continue
            if authorized:
                return authorized
        return []

    def _is_visual_query(self, query: str) -> bool:
        """Check if user query is asking about an image, visual element, or OCR."""
        q = query.strip().lower()
        visual_keywords = [
            "image",
            "picture",
            "photo",
            "diagram",
            "chart",
            "table",
            "screenshot",
            "receipt",
            "drawing",
            "what do you see",
            "what is in",
            "what is this",
            "describe",
            "read the text",
            "ocr",
            "transcribe",
            "what does it say",
            "color",
            "shown",
            "visual",
            "look like",
            "this picture",
            "the picture",
            "this image",
            "the image",
            "in the photo",
        ]
        return any(k in q for k in visual_keywords)

    def _needs_web_search(self, query: str) -> bool:
        """Detect if the query asks about real-time, current events, live data, or web search."""
        q = query.strip().lower()
        search_indicators = [
            "search",
            "google",
            "web search",
            "browse",
            "look up",
            "latest",
            "today",
            "yesterday",
            "recent",
            "breaking news",
            "weather",
            "stock price",
            "stock",
            "score",
            "match result",
            "who won",
            "current president",
            "release date",
            "election",
            "2025",
            "2026",
            "2027",
        ]
        return any(indicator in q for indicator in search_indicators)

    def _is_conversational_query(
        self, query: str, chat_history: Optional[List[Dict[str, Any]]] = None
    ) -> bool:
        """Check if a query is a greeting, follow-up, or conversational prompt that doesn't need external web scraping."""
        q = query.strip().lower()
        cleaned_q = re.sub(r"[^\w\s]", " ", q).strip()
        if not cleaned_q or len(cleaned_q) < 2:
            return True

        conversational_phrases = [
            "hi",
            "hello",
            "hey",
            "hola",
            "howdy",
            "sup",
            "good morning",
            "good afternoon",
            "good evening",
            "good night",
            "how are you",
            "how are you doing",
            "how r u",
            "how are u",
            "how are you today",
            "who are you",
            "what are you",
            "what is your name",
            "what can you do",
            "thank you",
            "thanks",
            "thanks a lot",
            "thx",
            "ty",
            "tell me a joke",
            "help me",
            "what's up",
            "whats up",
            "nice to meet you",
            "just one word",
            "one word",
            "single word",
            "in one word",
            "tell me more",
            "explain more",
            "summarize",
            "summarize that",
            "why",
            "give me 3 points",
            "explain in simple terms",
            "short answer",
        ]

        # Check if the query is or starts with any of these phrases
        for phrase in conversational_phrases:
            if (
                cleaned_q == phrase
                or cleaned_q.startswith(phrase + " ")
                or (" " + phrase + " ") in (" " + cleaned_q + " ")
            ):
                return True

        words = cleaned_q.split()
        if len(words) <= 6 and any(
            w in ["hi", "hello", "hey", "thanks", "thank", "bye", "goodbye"]
            for w in words
        ):
            return True

        # Follow-up conversational directives when prior conversation context already exists
        if (
            chat_history
            and len(words) <= 6
            and any(
                w
                in [
                    "word",
                    "points",
                    "short",
                    "more",
                    "why",
                    "again",
                    "explain",
                    "meaning",
                    "summarize",
                    "it",
                    "this",
                    "that",
                ]
                for w in words
            )
        ):
            return True

        return False

    @staticmethod
    def _persist_message(
        session_id: str,
        role: Literal["user", "assistant"],
        content: str,
        citations: Optional[List[Dict[str, Any]]] = None,
        attachments: Optional[List[Any]] = None,
        reply_to: Optional[Any] = None,
        expected_history_version: Optional[int] = None,
    ) -> str:
        saved = chat_history_service.save_message(
            session_id,
            role,
            content,
            citations=citations,
            attachments=attachments,
            reply_to=reply_to,
            expected_history_version=expected_history_version,
        )
        saved_messages = _saved_messages.get()
        if saved_messages is not None:
            saved_messages[role] = True
        session_store_repo.record_message(
            session_id,
            role,
            content,
            attachments=attachments,
            reply_to=reply_to,
            message_id=saved.id,
        )
        acknowledgement = MessageAcknowledgement(
            id=saved.id,
            session_id=saved.session_id,
            role=role,
            created_at=saved.created_at,
        )
        return f"data: {json.dumps({'event': 'message', 'data': '', 'message': acknowledgement.model_dump()})}\n\n"

    async def _emit_simple_message(
        self, message: str, session_id: str
    ) -> AsyncGenerator[str, None]:
        """Emit a simple assistant text response and persist to history."""
        yield (
            await run_blocking(
                self._persist_message,
                session_id=session_id,
                role="assistant",
                content=message,
            )
        )
        yield f"data: {json.dumps({'event': 'token', 'data': message})}\n\n"
        yield f"data: {json.dumps({'event': 'done', 'data': '[DONE]'})}\n\n"

    async def _execute_conversational(
        self,
        query: str,
        session_id: str,
        chat_history: Optional[List[Dict[str, Any]]] = None,
        reply_to: Optional[Any] = None,
    ) -> AsyncGenerator[str, None]:
        """Direct conversational response with full multi-turn chat memory and reply reference."""
        stream_error = None
        full_answer = ""
        try:
            async with aclosing(
                llm_service.stream_conversational_answer(
                    query, chat_history, reply_to=reply_to
                )
            ) as stream:
                async for token in stream:
                    full_answer += token
                    yield f"data: {json.dumps({'event': 'token', 'data': token})}\n\n"
        except Exception as e:
            logger.exception(f"Error during Conversational LLM streaming: {e}")
            err_str = (
                str(e)
                if isinstance(e, TextGenerationError)
                else "The AI response could not be completed. Please try again."
            )
            stream_error = err_str
            full_answer = "\n\n".join(
                filter(None, [full_answer, f"Response interrupted: {err_str}"])
            )

        yield (
            await run_blocking(
                self._persist_message,
                session_id=session_id,
                role="assistant",
                content=full_answer,
            )
        )
        if stream_error is not None:
            yield f"data: {json.dumps({'event': 'error', 'data': stream_error})}\n\n"
            return
        yield f"data: {json.dumps({'event': 'done', 'data': '[DONE]'})}\n\n"

    async def route_and_stream(
        self, request: ChatRequest, principal
    ) -> AsyncGenerator[str, None]:
        session_id = request.session_id
        history_version = (
            await run_blocking(session_store_repo.get_or_create_session, session_id)
        ).history_version
        saved_messages = {"user": False, "assistant": False}
        tokens = []
        citations = None
        attachments = []
        terminal = False
        try:
            async with aclosing(self._route_and_stream(request, principal)) as stream:
                while True:
                    # Scope context to one advancement, never across a yielded SSE
                    # frame: disconnect cleanup may close us from another task.
                    token = _saved_messages.set(saved_messages)
                    try:
                        frame = await anext(stream)
                    except StopAsyncIteration:
                        return
                    finally:
                        _saved_messages.reset(token)
                    event = json.loads(frame[6:])
                    kind = event.get("event")
                    if kind == "message":
                        if event["message"]["role"] == "assistant":
                            saved_messages["assistant"] = True
                        else:
                            saved_messages["user"] = True
                    elif kind == "token":
                        tokens.append(event["data"])
                    elif kind == "citations":
                        citations = event.get("citations")
                    elif kind == "media":
                        attachments.append(MediaAttachment(**event["media"]))
                    terminal = kind in ("done", "error")
                    yield frame
                    if terminal:
                        return
        except (asyncio.CancelledError, GeneratorExit):
            raise
        except Exception:
            logger.exception("Chat streaming failed")
            detail = "The response could not be completed. Please try again."
            if not saved_messages["assistant"] and saved_messages["user"]:
                content = "\n\n".join(
                    filter(None, ["".join(tokens), f"Response interrupted: {detail}"])
                )
                try:
                    token = _saved_messages.set(saved_messages)
                    try:
                        acknowledgement = await run_blocking(
                            self._persist_message,
                            session_id,
                            "assistant",
                            content,
                            citations=citations,
                            attachments=attachments,
                            expected_history_version=history_version,
                        )
                    finally:
                        _saved_messages.reset(token)
                    saved_messages["assistant"] = True
                    yield acknowledgement
                except Exception:
                    logger.exception("Could not save interrupted chat response")
            terminal = True
            yield f"data: {json.dumps({'event': 'error', 'data': detail})}\n\n"
        finally:
            # Cancellation cannot deliver more SSE events. Save the text/media
            # already produced so reopening the conversation does not lose them.
            if (
                saved_messages["user"]
                and not saved_messages["assistant"]
                and not terminal
                and (tokens or attachments)
            ):
                try:
                    with CancelScope(shield=True):
                        await run_blocking(
                            self._persist_message,
                            session_id,
                            "assistant",
                            "\n\n".join(
                                filter(None, ["".join(tokens), "Response stopped."])
                            ),
                            citations=citations,
                            attachments=attachments,
                            expected_history_version=history_version,
                        )
                except Exception:
                    logger.exception("Could not save stopped chat response")

    async def _route_and_stream(
        self, request: ChatRequest, principal
    ) -> AsyncGenerator[str, None]:
        session_id = request.session_id

        session = await run_blocking(
            session_store_repo.get_or_create_session, session_id
        )

        mode = request.mode or session.mode

        # Enforce Mode Selection if client passed an explicit mode
        if request.mode:
            await run_blocking(
                chat_history_service.update_session_mode, session_id, request.mode
            )

        logger.info(
            f"Orchestrator routing query for session '{session_id}' [Mode: {mode.value}] Attachments: {len(request.attachments or [])}"
        )

        # 0. Retrieve Pre-existing Conversation History for this chat thread
        chat_history = await run_blocking(
            session_store_repo.get_history_messages, session_id
        )

        # 1. Persist User Prompt to database & in-memory store with attachments and reply reference
        yield (
            await run_blocking(
                self._persist_message,
                session_id=session_id,
                role="user",
                content=request.message or "",
                attachments=request.attachments,
                reply_to=request.reply_to,
            )
        )

        # 2. Auto-generate title if session is brand new / "New Conversation"
        existing_session = await run_blocking(
            chat_history_service.get_session, session_id
        )
        if existing_session and (
            existing_session.title == "New Conversation" or not existing_session.title
        ):
            summary_title = (
                (request.message or "Conversation").strip().replace("\n", " ")
            )
            if len(summary_title) > 35:
                summary_title = summary_title[:32] + "..."
            await run_blocking(
                chat_history_service.update_session_title, session_id, summary_title
            )

        query = request.message or ""
        selected_documents = [
            attachment.id
            for attachment in request.attachments or []
            if attachment.file_type == "document" and attachment.id
        ]
        # Persist every attachment above, but only images belong in vision requests.
        request = request.model_copy(
            update={
                "attachments": [
                    attachment
                    for attachment in request.attachments or []
                    if attachment.file_type == "image"
                ]
            }
        )
        if (
            selected_documents
            and mode in (ChatMode.AUTO, ChatMode.DOCUMENT_RAG, ChatMode.MULTIMODAL)
            and not request.attachments
        ):
            context = await run_blocking(
                rag_service.retrieve_context_for_query,
                query,
                session_id,
                document_ids=selected_documents,
            )
            async with aclosing(
                self._execute_document_rag(
                    query,
                    session_id,
                    chat_history,
                    context_chunks=context,
                    allow_fallback=False,
                    reply_to=request.reply_to,
                )
            ) as stream:
                async for chunk in stream:
                    yield chunk
            return
        recent_images = await run_blocking(
            self._find_recent_image_attachments, chat_history, principal
        )

        # =========================================================================
        # 3. Explicit Mode Handlers (with graceful conversational Q&A fallback)
        # =========================================================================

        # 3a. Explicit IMAGE_GENERATION Mode
        if mode == ChatMode.IMAGE_GENERATION:
            if self._is_conversational_query(
                query, chat_history
            ) and not self._is_image_gen_intent(query):
                async with aclosing(
                    self._execute_conversational(
                        query, session_id, chat_history, reply_to=request.reply_to
                    )
                ) as stream:
                    async for chunk in stream:
                        yield chunk
                return
            async with aclosing(
                self._execute_image_generation(request, session_id)
            ) as stream:
                async for chunk in stream:
                    yield chunk
            return

        # 3b. Explicit MULTIMODAL Mode
        if mode == ChatMode.MULTIMODAL:
            # If current request has attachments, use them directly
            if request.attachments and len(request.attachments) > 0:
                async with aclosing(
                    self._execute_multimodal(request, session_id, chat_history)
                ) as stream:
                    async for chunk in stream:
                        yield chunk
                return
            # If no current attachments, but recent image exists in history
            if recent_images:
                req_with_recent = request.model_copy(
                    update={"attachments": recent_images}
                )
                async with aclosing(
                    self._execute_multimodal(req_with_recent, session_id, chat_history)
                ) as stream:
                    async for chunk in stream:
                        yield chunk
                return
            # If conversational query or greeting
            if self._is_conversational_query(query, chat_history):
                async with aclosing(
                    self._execute_conversational(
                        query, session_id, chat_history, reply_to=request.reply_to
                    )
                ) as stream:
                    async for chunk in stream:
                        yield chunk
                return
            msg = "Please attach an image or document to analyze with Vision & OCR, or ask any general question."
            async for chunk in self._emit_simple_message(msg, session_id):
                yield chunk
            return

        # 3c. Explicit DOCUMENT_RAG Mode
        if mode == ChatMode.DOCUMENT_RAG:
            # If conversational greeting or general follow-up without document query
            if self._is_conversational_query(query, chat_history):
                async with aclosing(
                    self._execute_conversational(
                        query, session_id, chat_history, reply_to=request.reply_to
                    )
                ) as stream:
                    async for chunk in stream:
                        yield chunk
                return
            async with aclosing(
                self._execute_document_rag(
                    query,
                    session_id,
                    chat_history,
                    allow_fallback=False,
                    reply_to=request.reply_to,
                )
            ) as stream:
                async for chunk in stream:
                    yield chunk
            return

        # 3d. Explicit WEB_SEARCH Mode
        if mode == ChatMode.WEB_SEARCH:
            async with aclosing(
                self._execute_web_search(
                    query, session_id, chat_history, reply_to=request.reply_to
                )
            ) as stream:
                async for chunk in stream:
                    yield chunk
            return

        # =========================================================================
        # 4. AUTO (Smart AI / ChatGPT-style) Dynamic Routing
        # =========================================================================

        # Case A: Explicit Image Generation Intent
        if self._is_image_gen_intent(query):
            async with aclosing(
                self._execute_image_generation(request, session_id)
            ) as stream:
                async for chunk in stream:
                    yield chunk
            return

        # Case B: Current request contains attached images or media
        if request.attachments and len(request.attachments) > 0:
            async with aclosing(
                self._execute_multimodal(request, session_id, chat_history)
            ) as stream:
                async for chunk in stream:
                    yield chunk
            return

        # Case C: Recent image exists in history + visual follow-up or conversational query
        if recent_images and (
            self._is_visual_query(query)
            or self._is_conversational_query(query, chat_history)
        ):
            req_with_recent = request.model_copy(update={"attachments": recent_images})
            async with aclosing(
                self._execute_multimodal(req_with_recent, session_id, chat_history)
            ) as stream:
                async for chunk in stream:
                    yield chunk
            return

        # Case D: Conversational greeting or short follow-up
        if self._is_conversational_query(query, chat_history):
            async with aclosing(
                self._execute_conversational(
                    query, session_id, chat_history, reply_to=request.reply_to
                )
            ) as stream:
                async for chunk in stream:
                    yield chunk
            return

        # Case E: Session has uploaded documents -> retrieve context
        if session.document_ids and len(session.document_ids) > 0:
            chunks = await run_blocking(
                rag_service.retrieve_context_for_query, query, session_id
            )
            if chunks:
                async with aclosing(
                    self._execute_document_rag(
                        query,
                        session_id,
                        chat_history,
                        context_chunks=chunks,
                        allow_fallback=True,
                        reply_to=request.reply_to,
                    )
                ) as stream:
                    async for chunk in stream:
                        yield chunk
                return

        # Case F: Query requires real-time web search
        if self._needs_web_search(query):
            async with aclosing(
                self._execute_web_search(
                    query, session_id, chat_history, reply_to=request.reply_to
                )
            ) as stream:
                async for chunk in stream:
                    yield chunk
            return

        # Case G: Default general knowledge / reasoning / coding / conversation
        async with aclosing(
            self._execute_conversational(
                query, session_id, chat_history, reply_to=request.reply_to
            )
        ) as stream:
            async for chunk in stream:
                yield chunk

    async def _execute_document_rag(
        self,
        query: str,
        session_id: str,
        chat_history: Optional[List[Dict[str, Any]]] = None,
        context_chunks: Optional[List[Dict[str, Any]]] = None,
        allow_fallback: bool = True,
        reply_to: Optional[Any] = None,
    ) -> AsyncGenerator[str, None]:
        session = await run_blocking(
            session_store_repo.get_or_create_session, session_id
        )

        if not session.document_ids and not context_chunks:
            if allow_fallback:
                async with aclosing(
                    self._execute_conversational(
                        query, session_id, chat_history, reply_to=reply_to
                    )
                ) as stream:
                    async for chunk in stream:
                        yield chunk
                return
            msg = "⚠️ No documents uploaded to this chat session yet! Please upload a PDF or text file first to ask document-based questions, or switch to Auto / Web Search mode."
            async for chunk in self._emit_simple_message(msg, session_id):
                yield chunk
            return

        # 1. Retrieve relevant chunks if not provided
        if context_chunks is None:
            context_chunks = await run_blocking(
                rag_service.retrieve_context_for_query, query, session_id
            )

        if not context_chunks:
            if allow_fallback:
                async with aclosing(
                    self._execute_conversational(
                        query, session_id, chat_history, reply_to=reply_to
                    )
                ) as stream:
                    async for chunk in stream:
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
                similarity_score=c.get("similarity_score", 1.0),
            )
            for c in context_chunks
        ]

        citations_data = [c.model_dump() for c in citations]
        yield f"data: {json.dumps({'event': 'citations', 'data': '', 'citations': citations_data})}\n\n"

        # 3. Stream answer token by token with chat history & accumulate
        stream_error = None
        full_answer = ""
        try:
            async with aclosing(
                llm_service.stream_rag_answer(
                    query, context_chunks, chat_history, reply_to=reply_to
                )
            ) as stream:
                async for token in stream:
                    full_answer += token
                    yield f"data: {json.dumps({'event': 'token', 'data': token})}\n\n"
        except Exception as e:
            logger.exception(f"Error during LLM streaming: {e}")
            err_str = (
                str(e)
                if isinstance(e, TextGenerationError)
                else "The AI response could not be completed. Please try again."
            )
            stream_error = err_str
            full_answer = "\n\n".join(
                filter(None, [full_answer, f"Response interrupted: {err_str}"])
            )

        # 4. Persist completed assistant message with citations to SQLite & in-memory
        yield (
            await run_blocking(
                self._persist_message,
                session_id=session_id,
                role="assistant",
                content=full_answer,
                citations=citations_data,
            )
        )
        if stream_error is not None:
            yield f"data: {json.dumps({'event': 'error', 'data': stream_error})}\n\n"
            return

        yield f"data: {json.dumps({'event': 'done', 'data': '[DONE]'})}\n\n"

    async def _execute_web_search(
        self,
        query: str,
        session_id: str,
        chat_history: Optional[List[Dict[str, Any]]] = None,
        reply_to: Optional[Any] = None,
    ) -> AsyncGenerator[str, None]:
        stream_error = None
        full_answer = ""
        citations_data = []

        # 1. Handle Conversational Greetings & Continuity Follow-ups directly
        if self._is_conversational_query(query, chat_history):
            logger.info(
                f"Routing query '{query}' to conversational assistant with chat history"
            )
            async with aclosing(
                self._execute_conversational(
                    query, session_id, chat_history, reply_to=reply_to
                )
            ) as stream:
                async for chunk in stream:
                    yield chunk
            return

        # 2. Informational Search Query: Execute Search & Emit Sources
        results = await run_blocking(web_search_service.search, query)

        if results:
            citations = [
                Citation(
                    document_id="",
                    filename=r.get("title", "Web Source"),
                    page_number=None,
                    chunk_index=idx,
                    snippet=f"{r.get('url', '')}\n{r.get('snippet', '')[:160]}",
                    similarity_score=1.0,
                )
                for idx, r in enumerate(results)
                if r.get("title") and r.get("url")
            ]
            citations_data = [c.model_dump() for c in citations]
            if citations_data:
                yield f"data: {json.dumps({'event': 'citations', 'data': '', 'citations': citations_data})}\n\n"

        try:
            async with aclosing(
                llm_service.stream_web_search_answer(
                    query, results, chat_history, reply_to=reply_to
                )
            ) as stream:
                async for token in stream:
                    full_answer += token
                    yield f"data: {json.dumps({'event': 'token', 'data': token})}\n\n"
        except Exception as e:
            logger.exception(f"Error during Web Search LLM streaming: {e}")
            err_str = (
                str(e)
                if isinstance(e, TextGenerationError)
                else "The AI response could not be completed. Please try again."
            )
            stream_error = err_str
            full_answer = "\n\n".join(
                filter(None, [full_answer, f"Response interrupted: {err_str}"])
            )

        # Persist completed assistant message with citations to SQLite & in-memory
        yield (
            await run_blocking(
                self._persist_message,
                session_id=session_id,
                role="assistant",
                content=full_answer,
                citations=citations_data,
            )
        )
        if stream_error is not None:
            yield f"data: {json.dumps({'event': 'error', 'data': stream_error})}\n\n"
            return

        yield f"data: {json.dumps({'event': 'done', 'data': '[DONE]'})}\n\n"

    async def _execute_image_generation(
        self, request: ChatRequest, session_id: str
    ) -> AsyncGenerator[str, None]:
        prompt = self._clean_image_prompt(request.message or "Creative artwork")

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
                generated_media = await image_gen_service.generate_from_reference(
                    prompt=prompt,
                    reference_image_path=ref_attachment.url,
                    session_id=session_id,
                )

            if not generated_media:
                generated_media = await image_gen_service.generate_image(
                    prompt=prompt, session_id=session_id
                )

            # Send media event to client
            yield f"data: {json.dumps({'event': 'media', 'data': '', 'media': generated_media.model_dump()})}\n\n"

            done_caption = f"Here is your generated image based on: **{prompt}**"
            yield f"data: {json.dumps({'event': 'token', 'data': done_caption})}\n\n"

            # Save assistant message with generated attachment
            yield (
                await run_blocking(
                    self._persist_message,
                    session_id=session_id,
                    role="assistant",
                    content=done_caption,
                    attachments=[generated_media],
                )
            )

        except Exception as e:
            logger.exception(f"Image generation execution error: {e}")
            detail = (
                str(e)
                if isinstance(e, ImageGenerationError)
                else "Image generation could not be completed. Please try again."
            )
            err_msg = f"⚠️ Sorry, could not generate image: {detail}"
            yield (
                await run_blocking(
                    self._persist_message,
                    session_id=session_id,
                    role="assistant",
                    content=f"Response interrupted: {err_msg}",
                )
            )
            yield f"data: {json.dumps({'event': 'error', 'data': err_msg})}\n\n"
            return

        yield f"data: {json.dumps({'event': 'done', 'data': '[DONE]'})}\n\n"

    async def _execute_multimodal(
        self,
        request: ChatRequest,
        session_id: str,
        chat_history: Optional[List[Dict[str, Any]]] = None,
    ) -> AsyncGenerator[str, None]:
        stream_error = None
        full_answer = ""
        try:
            async with aclosing(
                llm_service.stream_multimodal_answer(
                    query=request.message or "",
                    attachments=request.attachments or [],
                    chat_history=chat_history,
                    reply_to=request.reply_to,
                )
            ) as stream:
                async for token in stream:
                    full_answer += token
                    yield f"data: {json.dumps({'event': 'token', 'data': token})}\n\n"
        except Exception as e:
            logger.exception(f"Multimodal vision execution error: {e}")
            err_msg = (
                str(e)
                if isinstance(e, TextGenerationError)
                else "The AI response could not be completed. Please try again."
            )
            stream_error = err_msg
            full_answer = "\n\n".join(
                filter(None, [full_answer, f"Response interrupted: {err_msg}"])
            )

        # Persist assistant response
        yield (
            await run_blocking(
                self._persist_message,
                session_id=session_id,
                role="assistant",
                content=full_answer,
            )
        )
        if stream_error is not None:
            yield f"data: {json.dumps({'event': 'error', 'data': stream_error})}\n\n"
            return
        yield f"data: {json.dumps({'event': 'done', 'data': '[DONE]'})}\n\n"


chat_orchestrator = ChatOrchestrator()
