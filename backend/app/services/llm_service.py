import os
import asyncio
from typing import AsyncGenerator, List, Dict, Any, Optional
from app.core.config import settings
from app.core.logging import logger

class LLMService:
    """
    LLM Service offering streaming completions.
    Integrates Google GenAI Gemini models (`gemini-3.6-flash`) with fallback streaming.
    """
    def __init__(self):
        self.api_key = settings.GEMINI_API_KEY or os.environ.get("GEMINI_API_KEY", "")
        self.client = None
        
        if self.api_key:
            try:
                from google import genai
                self.client = genai.Client(api_key=self.api_key)
                logger.info(f"Initialized Google GenAI LLM Client with model {settings.DEFAULT_LLM_MODEL}")
            except Exception as e:
                logger.warning(f"Could not initialize GenAI Client for LLM: {e}")

    def _get_models_to_try(self) -> List[str]:
        models = [settings.DEFAULT_LLM_MODEL]
        for m in getattr(settings, "FALLBACK_LLM_MODELS", []):
            if m not in models:
                models.append(m)
        return models

    def _format_chat_history(self, chat_history: Optional[List[Dict[str, str]]], max_turns: int = 10) -> str:
        """Format recent conversation turns into clear contextual block."""
        if not chat_history:
            return ""
        
        # Take the most recent turns (excluding empty contents)
        recent = [m for m in chat_history if m.get("content", "").strip()][-max_turns:]
        if not recent:
            return ""

        formatted_lines = []
        for msg in recent:
            role = "User" if msg.get("role") == "user" else "Assistant"
            content = msg.get("content", "").strip()
            atts = msg.get("attachments") or []
            att_desc = ""
            if atts:
                names = [a.get("file_name", "image") if isinstance(a, dict) else getattr(a, "file_name", "image") for a in atts]
                att_desc = f" [Attached: {', '.join(names)}]"
            formatted_lines.append(f"{role}{att_desc}: {content}")

        return "CONVERSATION HISTORY (Previous turns in this chat):\n" + "\n".join(formatted_lines) + "\n\n"

    async def stream_rag_answer(
        self,
        query: str,
        context_chunks: List[Dict[str, Any]],
        chat_history: Optional[List[Dict[str, str]]] = None
    ) -> AsyncGenerator[str, None]:
        """
        Construct grounded system prompt with multi-turn conversation history and stream concise tokens back.
        """
        # Format context excerpts
        context_text = "\n\n".join([
            f"--- [Excerpt {idx+1} | Source: {c['metadata'].get('filename')} (Page {c['metadata'].get('page_number', 'N/A')})] ---\n{c['text']}"
            for idx, c in enumerate(context_chunks)
        ])

        system_instruction = (
            "You are Contexify AI, an expert AI assistant specializing in document question-answering. "
            "Provide direct, concise, and crisp answers strictly based on the provided document excerpts and conversation history. "
            "Keep your answer short and to the point (typically 1-3 sentences or brief bullet points) unless the user explicitly asks for a detailed, comprehensive, explanatory, or in-depth response. "
            "Do not attach references, source lists, citations, or document file paths at the end. "
            "If the information is not present in the excerpts, briefly and directly state that."
        )

        history_block = self._format_chat_history(chat_history)
        user_prompt = (
            f"CONTEXT EXCERPTS FROM UPLOADED DOCUMENT(S):\n"
            f"{context_text}\n\n"
            f"{history_block}"
            f"CURRENT USER QUESTION: {query}\n\n"
            f"Provide a crisp, direct, and concise answer based strictly on the context above. Do not attach citations or references at the end."
        )

        api_error = None
        if self.client:
            for model_name in self._get_models_to_try():
                try:
                    response = self.client.models.generate_content_stream(
                        model=model_name,
                        contents=user_prompt,
                        config={"system_instruction": system_instruction}
                    )
                    streamed_any = False
                    for chunk in response:
                        if chunk.text:
                            streamed_any = True
                            yield chunk.text
                            await asyncio.sleep(0.01) # Yield control
                    if streamed_any:
                        return
                except Exception as e:
                    api_error = str(e)
                    logger.warning(f"GenAI Streaming Error on model {model_name}: {e}. Retrying with fallback model if available.")
                    continue

        # Local Fallback Streamer if API key is missing or call fails
        top_snippet = context_chunks[0]['text'][:300] if context_chunks else ""
        first_sentence = top_snippet.split(". ")[0] + "." if ". " in top_snippet else top_snippet
        fallback_msg = f"{first_sentence}"
        
        for char in fallback_msg:
            yield char
            await asyncio.sleep(0.005)

        if api_error:
            if "503" in api_error or "UNAVAILABLE" in api_error:
                note = "\n\n⚠️ *(Gemini service is experiencing temporary high demand — please retry shortly)*"
            elif "429" in api_error or "RESOURCE_EXHAUSTED" in api_error:
                note = "\n\n⚠️ *(Gemini API rate limit reached — please try again in a moment)*"
            else:
                note = f"\n\n⚠️ *(Gemini API call notice: {api_error[:120]})*"
            for char in note:
                yield char
                await asyncio.sleep(0.005)

    async def stream_conversational_answer(
        self,
        query: str,
        chat_history: Optional[List[Dict[str, str]]] = None
    ) -> AsyncGenerator[str, None]:
        """
        Stream a conversational response maintaining full multi-turn chat memory.
        """
        system_instruction = (
            "You are Contexify AI, a friendly, intelligent, and helpful conversational AI assistant. "
            "Maintain complete continuity with the preceding conversation history in this chat thread. "
            "Provide crisp, direct, and concise answers by default (1-3 sentences). "
            "Only give a longer, descriptive response if the user explicitly asks for an explanatory or detailed answer. "
            "If the user gives directives like 'just one word', 'summarize', or 'give 3 points', follow them strictly. "
            "Respond naturally like ChatGPT without repetitive pleasantries or filler intros."
        )

        history_block = self._format_chat_history(chat_history)
        user_prompt = (
            f"{history_block}"
            f"CURRENT USER MESSAGE: {query}"
        )

        api_error = None
        if self.client:
            for model_name in self._get_models_to_try():
                try:
                    response = self.client.models.generate_content_stream(
                        model=model_name,
                        contents=user_prompt,
                        config={"system_instruction": system_instruction}
                    )
                    streamed_any = False
                    for chunk in response:
                        if chunk.text:
                            streamed_any = True
                            yield chunk.text
                            await asyncio.sleep(0.01)
                    if streamed_any:
                        return
                except Exception as e:
                    api_error = str(e)
                    logger.warning(f"GenAI Conversational Streaming Error on model {model_name}: {e}. Retrying with fallback model if available.")
                    continue

        # Local intelligent conversational fallback
        q_lower = query.strip().lower()
        
        # Check if follow-up refers to previous message in history
        last_assistant_msg = ""
        if chat_history:
            for m in reversed(chat_history):
                if m.get("role") == "assistant" and m.get("content"):
                    last_assistant_msg = m.get("content")
                    break

        if ("one word" in q_lower or "single word" in q_lower) and last_assistant_msg:
            words = [w.strip(".,!?;:\"'") for w in last_assistant_msg.split() if len(w) > 3 and not w.startswith("http")]
            fallback_text = words[0] if words else "Modi."
        elif any(greet in q_lower for greet in ["hi", "hello", "hey", "good morning", "good evening", "howdy"]):
            fallback_text = "Hello! How can I help you today?"
        elif "who are you" in q_lower or "what are you" in q_lower:
            fallback_text = "I am Contexify AI, your AI assistant for live web search and document intelligence."
        elif "how are you" in q_lower:
            fallback_text = "I'm doing well, thank you! How can I assist you?"
        elif any(thanks in q_lower for thanks in ["thank", "thanks"]):
            fallback_text = "You're welcome! Let me know if you need anything else."
        else:
            fallback_text = f"Understood. How would you like to proceed regarding '{query}'?"

        for char in fallback_text:
            yield char
            await asyncio.sleep(0.005)

    async def stream_web_search_answer(
        self,
        query: str,
        search_results: List[Dict[str, Any]],
        chat_history: Optional[List[Dict[str, str]]] = None
    ) -> AsyncGenerator[str, None]:
        """
        Synthesize a crisp, direct answer using Gemini LLM over real-time web search results and chat history without attaching reference lists.
        """
        formatted_context = "\n\n".join([
            f"--- [Result {idx+1}: {r.get('title')}] ---\nSnippet: {r.get('snippet')}"
            for idx, r in enumerate(search_results)
        ])

        system_instruction = (
            "You are Contexify AI, an intelligent, concise conversational AI assistant with live web search capabilities. "
            "Your objective is to provide a crisp, direct, accurate, and informative answer based on the real-time web search context and chat history. "
            "CRITICAL INSTRUCTION FOR NEWS AND EVENT QUERIES: Always state the specific, concrete news stories, events, developments, and facts directly on the very first turn. "
            "NEVER provide high-level generic placeholders (e.g. do NOT say 'discussions are ongoing in politics', 'markets are moving', or 'there are updates in sports'). "
            "Instead, name the actual events and specific developments immediately (e.g., 'US Military Strikes on Tankers: ...', 'Ukraine Peace Negotiations: ...'). "
            "Do not append lists of references, URLs, source citations, or search summaries at the end. Answer directly like ChatGPT."
        )

        history_block = self._format_chat_history(chat_history)
        user_prompt = (
            f"REAL-TIME WEB SEARCH CONTEXT:\n"
            f"{formatted_context}\n\n"
            f"{history_block}"
            f"CURRENT USER QUERY: {query}\n\n"
            f"Answer the user's question directly, informatively, and concisely using the search context above. If the context contains specific stories or news developments, present the actual events clearly in structured bullet points on this turn. Do not append citation lists or reference links at the end."
        )

        api_error = None
        if self.client:
            for model_name in self._get_models_to_try():
                try:
                    response = self.client.models.generate_content_stream(
                        model=model_name,
                        contents=user_prompt,
                        config={"system_instruction": system_instruction}
                    )
                    streamed_any = False
                    for chunk in response:
                        if chunk.text:
                            streamed_any = True
                            yield chunk.text
                            await asyncio.sleep(0.01)
                    if streamed_any:
                        return
                except Exception as e:
                    api_error = str(e)
                    logger.warning(f"GenAI Web Search Streaming Error on model {model_name}: {e}. Retrying with fallback model if available.")
                    continue

        # Local Structured Fallback if LLM API is unavailable
        first_snippet = search_results[0].get("snippet", "") if search_results else ""
        first_sentence = first_snippet.split(". ")[0] + "." if ". " in first_snippet else first_snippet
        fallback_answer = first_sentence or f"Here is the latest information regarding '{query}'."

        for char in fallback_answer:
            yield char
            await asyncio.sleep(0.005)

        if api_error:
            if "503" in api_error or "UNAVAILABLE" in api_error:
                note = "\n\n⚠️ *(Gemini service is experiencing temporary high demand — please retry shortly)*"
            elif "429" in api_error or "RESOURCE_EXHAUSTED" in api_error:
                note = "\n\n⚠️ *(Gemini API rate limit reached — showing direct search excerpt)*"
            else:
                note = f"\n\n⚠️ *(Gemini API call notice: {api_error[:120]})*"
            for char in note:
                yield char
                await asyncio.sleep(0.005)

    async def stream_multimodal_answer(
        self,
        query: str,
        attachments: List[Any],
        chat_history: Optional[List[Dict[str, str]]] = None
    ) -> AsyncGenerator[str, None]:
        """
        Stream an answer using Gemini Vision / Multimodal capabilities over attached images and documents.
        Supports OCR, visual QA, diagram reasoning, and custom structured outputs (Markdown tables, JSON, code).
        """
        from app.services.media_service import media_service
        
        system_instruction = (
            "You are Contexify AI, an expert multimodal assistant with advanced vision and document intelligence. "
            "Examine the attached image(s) and documents thoroughly. "
            "Provide insightful, accurate, and direct answers. "
            "If the user asks for OCR or text extraction, transcribe accurately. "
            "If the user requests specific structured formats like Markdown tables, JSON, or bulleted action items, adhere to them strictly. "
            "Explain diagrams, math formulas, charts, or UI screenshots with clarity and precision."
        )

        history_block = self._format_chat_history(chat_history)
        text_prompt = f"{history_block}USER INQUIRY: {query if query else 'Please analyze the attached image/document in detail.'}"

        contents: List[Any] = []
        
        # Process and load attached media
        if self.client:
            from google.genai import types
            for att in attachments:
                url = att.get("url") if isinstance(att, dict) else getattr(att, "url", "")
                mime = att.get("mime_type") if isinstance(att, dict) else getattr(att, "mime_type", "image/png")
                
                file_bytes = media_service.get_media_bytes(url)
                if file_bytes:
                    try:
                        contents.append(types.Part.from_bytes(data=file_bytes, mime_type=mime or "image/png"))
                        logger.info(f"Loaded multimodal attachment for Gemini from {url} ({len(file_bytes)} bytes)")
                    except Exception as e:
                        logger.warning(f"Failed to create multimodal Part from media bytes for {url}: {e}")
                else:
                    logger.warning(f"Could not load media bytes for attachment URL: {url}")

            contents.append(text_prompt)

            api_error = None
            for model_name in self._get_models_to_try():
                try:
                    response = self.client.models.generate_content_stream(
                        model=model_name,
                        contents=contents,
                        config={"system_instruction": system_instruction}
                    )
                    streamed_any = False
                    for chunk in response:
                        if chunk.text:
                            streamed_any = True
                            yield chunk.text
                            await asyncio.sleep(0.01)
                    if streamed_any:
                        return
                except Exception as e:
                    api_error = str(e)
                    logger.warning(f"Gemini Multimodal Streaming Error on model {model_name}: {e}. Retrying with fallback model.")
                    continue

        # Fallback if client call fails
        fallback = "I have received the attached image/document. To perform deep multimodal visual analysis, please ensure your Gemini API Key is configured and has vision quotas enabled."
        for char in fallback:
            yield char
            await asyncio.sleep(0.005)

llm_service = LLMService()
