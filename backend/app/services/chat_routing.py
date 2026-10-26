"""Pure intent and context policy; no providers, persistence, or application startup."""

import re
from typing import Any, Dict, List, Optional

from app.schemas.chat import ChatMode, ChatRequest


class ChatRoutingPolicy:
    @staticmethod
    def instruction(query: str) -> str:
        q = " ".join(query.lower().strip().split())
        return re.sub(
            r"^(?:(?:please|kindly)\s+|(?:can|could|would|will)\s+you\s+|i\s+(?:want|would like)\s+you\s+to\s+)+",
            "",
            q,
        )

    def is_image_gen_intent(self, query: str) -> bool:
        """Only explicit image commands or visual creation requests spend image quota."""
        q = self.instruction(query)
        if re.match(r"^/(?:imagine|image)(?:\s|$)|^(?:image|draw|generate):", q):
            return True
        # Requests to produce code/vector markup belong to the text model.
        if re.search(
            r"\b(?:using|with|in|as)\s+(?:python|javascript|typescript|html|css|svg|mermaid|code)\b",
            q,
        ):
            return False
        if re.match(
            r"^(?:draw|sketch|illustrate)\s+(?:(?:me|a|an|the)\s+)*(?:conclusion|comparison|parallels?|plan|function|script|algorithm|python|javascript|sql)\b",
            q,
        ):
            return False
        if re.match(r"^(?:draw\s+up|sketch\s+out)\b", q):
            return False
        if re.match(
            r"^(?:generate|create|make|build|design)\s+(?:an?\s+)?(?:image|photo|picture)\s+(?:classifier|classification|recognition|processing|compression|generation|upload|download|search)\b",
            q,
        ):
            return False
        visual = r"(?:images?|pictures?|photos?|illustrations?|artwork|drawings?|paintings?|logos?|portraits?|sketches?|wallpapers?|posters?|icons?|infographics?|thumbnails?)"
        return bool(
            re.match(
                rf"^(?:generate|create|make|produce|render|design)\s+(?:me\s+)?(?:(?:an?|some|the|\d+)\s+)?{visual}\b",
                q,
            )
            or re.match(r"^(?:draw|paint|sketch|illustrate)\s+", q)
            or re.match(rf"^{visual}\s+of\s+", q)
            or re.match(
                rf"^(?:edit|modify|change|transform|turn|convert|remix|recreate)\s+(?:this|that|the|my)\s+{visual}\b",
                q,
            )
        )

    def is_image_edit_followup(self, query: str) -> bool:
        q = self.instruction(query)
        return bool(
            re.match(
                r"^(?:make|turn|change|transform)\s+(?:it|this|that)\s+(?:into\s+)?(?:brighter|darker|larger|smaller|black and white|watercolou?r|a |an |more |less )"
                r"|^(?:remove|replace|change)\s+(?:the\s+)?background\b",
                q,
            )
        )

    def clean_image_prompt(self, query: str) -> str:
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

    def is_visual_query(self, query: str) -> bool:
        q = self.instruction(query)
        visual = r"(?:image|picture|photo|screenshot|diagram|chart|receipt|drawing)"
        return bool(
            re.search(
                rf"\b(?:this|that|the|attached|uploaded|previous|earlier|these|those)\s+{visual}s?\b",
                q,
            )
            or re.match(
                rf"^(?:describe|analy[sz]e|review|read|explain|inspect|compare|transcribe)\s+(?:an?\s+)?{visual}s?\b",
                q,
            )
            or re.fullmatch(
                r"(?:what do you see|what is (?:in )?this|what does it say|ocr|read the text)[?!.]*",
                q,
            )
        )

    @staticmethod
    def has_document_reference(query: str) -> bool:
        return bool(
            re.search(
                r"\b(?:this|that|my|our|attached|uploaded|these|those|provided|previous|earlier)\s+(?:\w+\s+){0,2}(?:documents?|files?|pdfs?|reports?|books?|chapters?|excerpts?)\b"
                r"|\bthe\s+(?:documents?|pdfs?|reports?|books?|chapters?|excerpts?)\b"
                r"|^(?:summari[sz]e|review|analy[sz]e|read)\s+(?:the\s+)?(?:documents?|files?|pdfs?|reports?|books?|chapters?|excerpts?)\b",
                query.strip().lower(),
            )
        )

    def is_code_request(self, query: str) -> bool:
        return bool(
            re.search(
                r"^(?:write|create|generate|build|implement|develop|design|draw|render|make)\b.*\b(?:function|script|code|program|component|class|regex|algorithm|python|javascript|typescript|sql|svg|html|css|mermaid|plantuml|unit tests?)\b",
                self.instruction(query),
            )
        )

    def needs_web_search(self, query: str) -> bool:
        q = self.instruction(query)
        return bool(
            re.search(
                r"\b(?:latest|today|yesterday|breaking news|weather|current (?:president|prime minister|ceo|exchange rate)|stock price|match result|who won|release date|election results|live scores?)\b"
                r"|\b(?:search|browse|look up)\s+(?:the\s+)?(?:web|internet|online)\b"
                r"|^(?:google|browse|look up|search for)\s+"
                r"|\b(?:recent|current)\s+(?:news|events|prices|results|updates)\b",
                q,
            )
        )

    @staticmethod
    def is_conversational_query(query: str, chat_history=None) -> bool:
        """Social messages only; a greeting prefix cannot hide a substantive request."""
        q = re.sub(r"[^\w\s]", " ", query.lower())
        q = " ".join(q.split())
        return bool(
            re.fullmatch(
                r"(?:hi|hello|hey|hola|howdy|sup|good (?:morning|afternoon|evening|night)|"
                r"how (?:are|r) (?:you|u)(?: doing| today)?|who are you|what are you|"
                r"what is your name|what can you do|help me|can you help me|thank you(?: very much)?|thanks(?: a lot)?|"
                r"thx|ty|bye|goodbye|nice to meet you|what s up|whats up|tell me a joke)",
                q,
            )
        )

    @staticmethod
    def is_followup_query(query: str) -> bool:
        q = re.sub(r"[^\w\s]", " ", query.lower())
        q = " ".join(q.split())
        return bool(
            re.fullmatch(
                r"(?:why|why is that|how so|what is this|what does it mean|is that correct|continue|go on|describe|summari[sz]e(?: (?:it|this|that))?|"
                r"(?:tell me|explain)(?: more| again| (?:it|this|that))?(?: in (?:detail|simple terms))?|"
                r"(?:make|keep) (?:it|this|that) (?:shorter|longer|simpler)|"
                r"(?:a )?short answer|(?:just |in )?(?:one|a single) word|"
                r"give me \d+ (?:points|examples)|translate (?:it|this|that)(?: into \w+)?)",
                q,
            )
        )

    @staticmethod
    def reply_history(
        history: List[Dict[str, Any]], reply_to=None
    ) -> List[Dict[str, Any]]:
        if reply_to is None:
            return history
        index = next(
            (
                i
                for i, message in enumerate(history)
                if message.get("id") == reply_to.id
            ),
            None,
        )
        return history[: index + 1] if index is not None else []

    def history_source(
        self, history: List[Dict[str, Any]], reply_to=None
    ) -> tuple[Optional[ChatMode], List[str]]:
        """Infer follow-up scope from evidence, stopping at unrelated text turns."""
        history = self.reply_history(history, reply_to)
        for message in reversed(history):
            attachments = message.get("attachments") or []
            docs = [
                a.get("id")
                for a in attachments
                if isinstance(a, dict)
                and a.get("file_type") == "document"
                and a.get("id")
            ]
            if docs:
                return ChatMode.DOCUMENT_RAG, docs
            if any(
                isinstance(a, dict) and a.get("file_type") == "image"
                for a in attachments
            ):
                return ChatMode.MULTIMODAL, []
            citations = message.get("citations") or []
            if citations:
                docs = [c.get("document_id") for c in citations if c.get("document_id")]
                return (
                    (ChatMode.DOCUMENT_RAG, list(dict.fromkeys(docs)))
                    if docs
                    else (ChatMode.WEB_SEARCH, [])
                )
            if message.get("role") == "user" and not (
                self.is_followup_query(message.get("content", ""))
                or self.is_image_edit_followup(message.get("content", ""))
                or self.is_visual_query(message.get("content", ""))
            ):
                return ChatMode.AUTO, []
        return None, []

    def choose_route(
        self,
        request: ChatRequest,
        mode: ChatMode,
        document_ids: List[str],
        history: List[Dict[str, Any]],
    ) -> tuple[ChatMode, Optional[List[str]]]:
        """Keep mode/source precedence explicit; do not dispatch providers here."""
        query = request.message or ""
        selected = [
            a.id
            for a in request.attachments or []
            if a.file_type == "document" and a.id
        ]
        has_images = any(a.file_type == "image" for a in request.attachments or [])
        source, source_documents = self.history_source(history, request.reply_to)
        followup = self.is_followup_query(query)
        scope = selected or (source_documents if followup or request.reply_to else None)
        if self.is_conversational_query(query) and not request.attachments:
            return ChatMode.AUTO, None
        if mode == ChatMode.IMAGE_GENERATION and re.match(
            r"^(?:do not|don't|never|stop)\s+(?:generate|create|make|draw|paint|render)\b|^no images?\b",
            self.instruction(query),
        ):
            return (
                (ChatMode.DOCUMENT_RAG, selected)
                if selected
                else (
                    (ChatMode.MULTIMODAL, None) if has_images else (ChatMode.AUTO, None)
                )
            )
        if mode != ChatMode.AUTO:
            if (
                mode == ChatMode.IMAGE_GENERATION
                and followup
                and not request.attachments
            ):
                return (
                    (ChatMode.MULTIMODAL, None)
                    if source == ChatMode.MULTIMODAL
                    else (ChatMode.AUTO, None)
                )
            if mode == ChatMode.MULTIMODAL and selected:
                return ChatMode.DOCUMENT_RAG, scope
            return mode, scope
        if selected or self.has_document_reference(query):
            return ChatMode.DOCUMENT_RAG, scope
        if self.is_image_gen_intent(query) or (
            source == ChatMode.MULTIMODAL and self.is_image_edit_followup(query)
        ):
            return ChatMode.IMAGE_GENERATION, None
        explicit_visual = bool(
            re.search(
                r"\b(?:images?|pictures?|photos?|screenshots?|diagrams?|charts?|receipts?|ocr)\b",
                query.lower(),
            )
        )
        if has_images or (
            self.is_visual_query(query)
            and (explicit_visual or source in (None, ChatMode.MULTIMODAL))
        ):
            return ChatMode.MULTIMODAL, None
        if self.is_code_request(query):
            return ChatMode.AUTO, None
        if self.needs_web_search(query):
            return ChatMode.WEB_SEARCH, None
        if (followup or request.reply_to) and source is not None:
            return source, scope
        # An uploaded document is available context, not a permanent routing mode.
        if followup and source is None and document_ids and not request.reply_to:
            return ChatMode.DOCUMENT_RAG, None
        return ChatMode.AUTO, None

    def retrieval_query(
        self, request: ChatRequest, history: List[Dict[str, Any]]
    ) -> str:
        query = request.message or ""
        if not self.is_followup_query(query):
            return query
        history = self.reply_history(history, request.reply_to)
        for message in reversed(history):
            content = message.get("content", "")
            if (
                message.get("role") == "user"
                and content
                and not self.is_followup_query(content)
            ):
                return f"{query}\nPrevious question: {content[:1000]}"
        return query
