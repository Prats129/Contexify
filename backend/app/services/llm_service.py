import os
import asyncio
from typing import AsyncGenerator, List, Dict, Any
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

    async def stream_rag_answer(
        self,
        query: str,
        context_chunks: List[Dict[str, Any]]
    ) -> AsyncGenerator[str, None]:
        """
        Construct grounded system prompt and stream tokens back.
        """
        # Format context excerpts
        context_text = "\n\n".join([
            f"--- [Excerpt {idx+1} | Source: {c['metadata'].get('filename')} (Page {c['metadata'].get('page_number', 'N/A')})] ---\n{c['text']}"
            for idx, c in enumerate(context_chunks)
        ])

        system_instruction = (
            "You are an expert AI Assistant specializing in document context question-answering. "
            "Your objective is to provide precise, accurate, and comprehensive answers strictly based "
            "on the provided document excerpts. If the information is not present in the excerpts, "
            "explicitly state that the provided document does not contain enough information to answer."
        )

        user_prompt = (
            f"CONTEXT EXCERPTS FROM UPLOADED DOCUMENT(S):\n"
            f"{context_text}\n\n"
            f"USER QUESTION: {query}\n\n"
            f"Provide a clear, detailed, structured answer grounded strictly in the context above."
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

    async def stream_web_search_answer(
        self,
        query: str,
        search_results: List[Dict[str, Any]]
    ) -> AsyncGenerator[str, None]:
        """Stream response for Web Search Mode (Priority 2)."""
        header = f"🌐 **Web Search Results for:** *'{query}'*\n\n"
        for char in header:
            yield char
            await asyncio.sleep(0.005)

        for res in search_results:
            text = f"### [{res.get('title')}]({res.get('url')})\n{res.get('snippet')}\n\n"
            for char in text:
                yield char
                await asyncio.sleep(0.005)

llm_service = LLMService()
