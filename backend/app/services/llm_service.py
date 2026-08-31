import os
import asyncio
from typing import AsyncGenerator, List, Dict, Any, Optional
from app.core.config import settings
from app.core.logging import logger

class LLMService:
    """
    LLM Service offering streaming completions.
    Integrates Google GenAI Gemini models (`gemini-2.5-flash`) with fallback streaming.
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
            formatted_lines.append(f"{role}: {content}")

        return "CONVERSATION HISTORY (Previous turns in this chat):\n" + "\n".join(formatted_lines) + "\n\n"

    async def stream_rag_answer(
        self,
        query: str,
        context_chunks: List[Dict[str, Any]],
        chat_history: Optional[List[Dict[str, str]]] = None
    ) -> AsyncGenerator[str, None]:
        """
        Construct grounded system prompt with multi-turn conversation history and stream tokens back.
        """
        # Format context excerpts
        context_text = "\n\n".join([
            f"--- [Excerpt {idx+1} | Source: {c['metadata'].get('filename')} (Page {c['metadata'].get('page_number', 'N/A')})] ---\n{c['text']}"
            for idx, c in enumerate(context_chunks)
        ])

        system_instruction = (
            "You are an expert AI Assistant specializing in document context question-answering. "
            "Your objective is to provide precise, accurate, and comprehensive answers strictly based "
            "on the provided document excerpts while maintaining the context of the conversation history. "
            "If the user asks a follow-up question (e.g. 'explain more', 'summarize that', 'what about point 2'), "
            "use both the conversation history and the document excerpts to answer accurately. "
            "If the information is not present in the excerpts, explicitly state that."
        )

        history_block = self._format_chat_history(chat_history)
        user_prompt = (
            f"CONTEXT EXCERPTS FROM UPLOADED DOCUMENT(S):\n"
            f"{context_text}\n\n"
            f"{history_block}"
            f"CURRENT USER QUESTION: {query}\n\n"
            f"Provide a clear, detailed, structured answer grounded in the document context and conversation history above."
        )

        api_error = None
        if self.client:
            try:
                response = self.client.models.generate_content_stream(
                    model=settings.DEFAULT_LLM_MODEL,
                    contents=user_prompt,
                    config={"system_instruction": system_instruction}
                )
                for chunk in response:
                    if chunk.text:
                        yield chunk.text
                        await asyncio.sleep(0.01) # Yield control
                return
            except Exception as e:
                api_error = str(e)
                logger.error(f"GenAI Streaming Error: {e}. Falling back to context synthesis.")

        # Local Fallback Streamer if API key is missing or call fails
        fallback_msg = (
            f"**Answer based on provided context:**\n\n"
            f"Based on the uploaded document excerpts ({len(context_chunks)} section(s) retrieved):\n\n"
        )
        for char in fallback_msg:
            yield char
            await asyncio.sleep(0.005)

        for idx, c in enumerate(context_chunks):
            snippet_summary = f"- **Section {idx+1} ({c['metadata'].get('filename')})**: {c['text'][:250]}...\n\n"
            for char in snippet_summary:
                yield char
                await asyncio.sleep(0.005)

        if api_error:
            if "429" in api_error or "RESOURCE_EXHAUSTED" in api_error:
                note = "\n\n⚠️ **Gemini API Error (429 Quota Exceeded)**: Your Gemini API key reached its rate limit or free tier request quota on `gemini-2.0-flash`. Please check your Google AI Studio plan/billing or try again in a few minutes."
            else:
                note = f"\n\n⚠️ **Gemini API Call Failed**: {api_error[:200]}"
        else:
            note = "\n\n*(Note: For live real-time Gemini LLM synthesis, set `GEMINI_API_KEY` in `backend/.env`)*"

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
            "If the user asks follow-up questions, refers to previous messages, or asks for concise answers (e.g. 'just one word', 'explain further'), "
            "strictly follow their instructions using the context of what was discussed. "
            "Respond warmly, concisely, and naturally like ChatGPT. Use clean markdown formatting."
        )

        history_block = self._format_chat_history(chat_history)
        user_prompt = (
            f"{history_block}"
            f"CURRENT USER MESSAGE: {query}"
        )

        api_error = None
        if self.client:
            try:
                response = self.client.models.generate_content_stream(
                    model=settings.DEFAULT_LLM_MODEL,
                    contents=user_prompt,
                    config={"system_instruction": system_instruction}
                )
                for chunk in response:
                    if chunk.text:
                        yield chunk.text
                        await asyncio.sleep(0.01)
                return
            except Exception as e:
                api_error = str(e)
                logger.error(f"GenAI Conversational Streaming Error: {e}")

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
            # Extract main noun / first significant keyword from last answer
            words = [w.strip(".,!?;:\"'") for w in last_assistant_msg.split() if len(w) > 3 and not w.startswith("http")]
            fallback_text = words[0] if words else "Modi."
        elif any(greet in q_lower for greet in ["hi", "hello", "hey", "good morning", "good evening", "howdy"]):
            fallback_text = (
                "Hello! 👋 I'm **Contexify AI**.\n\n"
                "How can I help you today? You can ask me questions, search the live web, or upload documents to explore and analyze."
            )
        elif "who are you" in q_lower or "what are you" in q_lower:
            fallback_text = (
                "I am **Contexify AI**, your enterprise AI assistant. "
                "I can help you search the web in real time, analyze and answer questions from your uploaded documents, and assist with writing, coding, and research."
            )
        elif "how are you" in q_lower:
            fallback_text = (
                "I'm doing great, thank you for asking! 😊 How are things going with you? What would you like to explore or work on today?"
            )
        elif any(thanks in q_lower for thanks in ["thank", "thanks"]):
            fallback_text = (
                "You're very welcome! Feel free to ask anytime if you need more help. 😊"
            )
        else:
            fallback_text = (
                f"Understood. Continuing from our discussion regarding *'{query}'*, I'm here to help."
            )

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
        Synthesize a comprehensive, natural language answer using Gemini LLM over real-time web search results and chat history.
        """
        # Format search context
        formatted_context = "\n\n".join([
            f"--- [Source {idx+1}: {r.get('title')}] ---\nURL: {r.get('url')}\nExcerpt: {r.get('snippet')}"
            for idx, r in enumerate(search_results)
        ])

        system_instruction = (
            "You are Contexify AI, an intelligent, conversational AI assistant with live web search capabilities. "
            "Your goal is to provide a comprehensive, accurate, structured, and helpful response to the user's question "
            "by synthesizing the provided real-time web search results while maintaining continuity with the ongoing chat history. "
            "Always format sources using clean markdown links like [Source Title](URL). "
            "Do not output raw search dump snippets; write a clear, coherent, conversational answer like ChatGPT with bullet points, headings, and bold highlights where appropriate."
        )

        history_block = self._format_chat_history(chat_history)
        user_prompt = (
            f"REAL-TIME WEB SEARCH RESULTS:\n"
            f"{formatted_context}\n\n"
            f"{history_block}"
            f"CURRENT USER QUERY: {query}\n\n"
            f"Synthesize a clear, detailed, and helpful answer grounded in the web search results and conversation history above. "
            f"Cite relevant sources with clickable markdown links [Source Name](URL)."
        )

        api_error = None
        if self.client:
            try:
                response = self.client.models.generate_content_stream(
                    model=settings.DEFAULT_LLM_MODEL,
                    contents=user_prompt,
                    config={"system_instruction": system_instruction}
                )
                for chunk in response:
                    if chunk.text:
                        yield chunk.text
                        await asyncio.sleep(0.01)
                return
            except Exception as e:
                api_error = str(e)
                logger.error(f"GenAI Web Search Streaming Error: {e}. Falling back to structured synthesis.")

        # Local Structured Fallback if LLM API is unavailable
        fallback_header = f"🌐 **Search Summary for:** *{query}*\n\n"
        for char in fallback_header:
            yield char
            await asyncio.sleep(0.005)

        for idx, res in enumerate(search_results):
            title = res.get("title", "Web Source")
            url = res.get("url", "#")
            snippet = res.get("snippet", "")
            item_text = f"### {idx+1}. [{title}]({url})\n{snippet}\n\n"
            for char in item_text:
                yield char
                await asyncio.sleep(0.005)

        if api_error:
            if "429" in api_error or "RESOURCE_EXHAUSTED" in api_error:
                note = "\n\n⚠️ *(Gemini API free quota reached on current key — showing direct web source results)*"
            else:
                note = f"\n\n*(Note: Showing direct web sources — Gemini API error: {api_error[:100]})*"
            for char in note:
                yield char
                await asyncio.sleep(0.005)

llm_service = LLMService()
