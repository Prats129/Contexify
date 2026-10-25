import asyncio
import json
import re
from contextlib import aclosing
from contextvars import ContextVar
from typing import Any, AsyncGenerator, Dict, List, Literal, Optional

from anyio import CancelScope

from app.core.concurrency import run_blocking
from app.core.errors import (
    EmbeddingError,
    ImageGenerationError,
    TextGenerationError,
    WebSearchError,
)
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
from app.services.chat_routing import ChatRoutingPolicy
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

    def __init__(self, routing: Optional[ChatRoutingPolicy] = None):
        self.routing = routing if routing is not None else ChatRoutingPolicy()

    def _find_recent_image_attachments(
        self,
        chat_history: Optional[List[Dict[str, Any]]],
        principal,
        *,
        focused: bool = True,
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
            if focused and (
                image_atts
                or (
                    msg.get("role") == "user"
                    and (
                        raw_atts
                        or not (
                            self.routing.is_followup_query(msg.get("content", ""))
                            or self.routing.is_image_edit_followup(
                                msg.get("content", "")
                            )
                            or self.routing.is_visual_query(msg.get("content", ""))
                        )
                    )
                )
            ):
                return []
        return []

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
            citations=citations,
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
        except Exception as error:
            logger.exception("Chat streaming failed")
            detail = (
                str(error)
                if isinstance(error, EmbeddingError)
                else "The response could not be completed. Please try again."
            )
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
            session_store_repo.get_history_messages,
            session_id,
            reply_to_id=request.reply_to.id if request.reply_to else None,
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
                chat_history_service.update_session_title,
                session_id,
                summary_title,
                only_if_default=True,
            )

        query = request.message or ""
        route, document_scope = self.routing.choose_route(
            request, mode, session.document_ids, chat_history
        )
        lookup_query = self.routing.retrieval_query(request, chat_history)
        has_new_attachments = bool(request.attachments)
        # Only images enter vision/reference APIs; document IDs scope RAG retrieval.
        request = request.model_copy(
            update={
                "attachments": [
                    a for a in request.attachments or [] if a.file_type == "image"
                ]
            }
        )
        if (
            route == ChatMode.DOCUMENT_RAG
            and document_scope
            and not set(document_scope).issubset(session.document_ids)
        ):
            async for frame in self._emit_simple_message(
                "A referenced document is no longer available in this chat. Please attach an available document to continue.",
                session_id,
            ):
                yield frame
            return
        if route == ChatMode.DOCUMENT_RAG:
            if (
                not has_new_attachments
                and document_scope
                and (self.routing.is_followup_query(query) or request.reply_to)
            ):
                images = await run_blocking(
                    self._find_recent_image_attachments,
                    self.routing.reply_history(chat_history, request.reply_to),
                    principal,
                )
                request = request.model_copy(update={"attachments": images})
            context = None
            if document_scope:
                context = await run_blocking(
                    rag_service.retrieve_context_for_query,
                    lookup_query,
                    session_id,
                    document_ids=document_scope,
                )
            elif session.document_ids:
                context = await run_blocking(
                    rag_service.retrieve_context_for_query, lookup_query, session_id
                )
            stream = self._execute_document_rag(
                query,
                session_id,
                chat_history,
                context_chunks=context,
                allow_fallback=False,
                reply_to=request.reply_to,
                retrieval_query=lookup_query,
                attachments=request.attachments,
            )
        elif route in (ChatMode.MULTIMODAL, ChatMode.IMAGE_GENERATION):
            needs_reference = (
                route == ChatMode.MULTIMODAL
                or self.routing.is_image_edit_followup(query)
                or self.routing.is_visual_query(query)
            )
            if not request.attachments and needs_reference:
                history = self.routing.reply_history(chat_history, request.reply_to)
                allow_older = not request.reply_to and bool(
                    re.search(
                        r"\b(?:earlier|previous|old)\s+(?:image|picture|photo)\b",
                        query.lower(),
                    )
                )
                recent_images = await run_blocking(
                    self._find_recent_image_attachments,
                    history,
                    principal,
                    focused=not allow_older,
                )
                request = request.model_copy(update={"attachments": recent_images})
            if not request.attachments and needs_reference:
                stream = self._emit_simple_message(
                    "Please attach an image to analyze or edit, or reply to a message containing an available image.",
                    session_id,
                )
            elif route == ChatMode.IMAGE_GENERATION:
                stream = self._execute_image_generation(request, session_id)
            else:
                stream = self._execute_multimodal(request, session_id, chat_history)
        elif route == ChatMode.WEB_SEARCH:
            stream = self._execute_web_search(
                query,
                session_id,
                chat_history,
                reply_to=request.reply_to,
                search_query=lookup_query,
            )
        else:
            stream = self._execute_conversational(
                query, session_id, chat_history, reply_to=request.reply_to
            )
        async with aclosing(stream):
            async for frame in stream:
                yield frame

    async def _execute_document_rag(
        self,
        query: str,
        session_id: str,
        chat_history: Optional[List[Dict[str, Any]]] = None,
        context_chunks: Optional[List[Dict[str, Any]]] = None,
        allow_fallback: bool = True,
        reply_to: Optional[Any] = None,
        retrieval_query: Optional[str] = None,
        attachments: Optional[List[MediaAttachment]] = None,
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
                rag_service.retrieve_context_for_query,
                retrieval_query or query,
                session_id,
            )

        if not context_chunks:
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
                    query,
                    context_chunks,
                    chat_history,
                    reply_to=reply_to,
                    attachments=attachments,
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
        search_query: Optional[str] = None,
    ) -> AsyncGenerator[str, None]:
        stream_error = None
        full_answer = ""
        citations_data = []

        # 1. Handle Conversational Greetings & Continuity Follow-ups directly
        if self.routing.is_conversational_query(query, chat_history):
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
        try:
            results = await run_blocking(
                web_search_service.search, search_query or query
            )
        except WebSearchError as error:
            async for frame in self._emit_simple_message(str(error), session_id):
                yield frame
            return
        if not results:
            async for frame in self._emit_simple_message(
                "I could not find usable web search excerpts for this question. Try a more specific search; I could not verify an answer.",
                session_id,
            ):
                yield frame
            return

        if results:
            citations = [
                Citation(
                    document_id="",
                    filename=r.get("title", "Web Source"),
                    page_number=None,
                    chunk_index=idx,
                    snippet=f"{r.get('url', '')}\nSearch excerpt (full page not retrieved): {r.get('snippet', '')[:160]}",
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
        prompt = self.routing.clean_image_prompt(request.message or "Creative artwork")

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
