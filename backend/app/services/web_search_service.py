"""Bounded search excerpts from fixed search endpoints, never full-page evidence."""

import base64
import binascii
import ipaddress
import time
import urllib.parse
import xml.etree.ElementTree as ET
from typing import Any, Dict, List

import requests
from bs4 import BeautifulSoup

from app.core.errors import WebSearchError
from app.core.logging import logger


class WebSearchService:
    MAX_RESULTS = 6
    MAX_RESPONSE_BYTES = 1_048_576
    SEARCH_TIMEOUT_SECONDS = 15

    def _read_response(self, method: str, url: str, deadline: float, **kwargs) -> bytes:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise WebSearchError()
        # Only fixed provider endpoints are fetched. Result URLs are never fetched.
        with requests.request(
            method,
            url,
            headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9"},
            timeout=min(4, remaining),
            stream=True,
            allow_redirects=False,
            **kwargs,
        ) as response:
            if response.status_code != 200 or time.monotonic() >= deadline:
                raise WebSearchError()
            body = bytearray()
            for chunk in response.iter_content(chunk_size=16_384):
                if (
                    time.monotonic() >= deadline
                    or len(body) + len(chunk) > self.MAX_RESPONSE_BYTES
                ):
                    raise WebSearchError()
                body.extend(chunk)
            return bytes(body)

    @staticmethod
    def _decode_bing_url(raw_url: str) -> str:
        parsed = urllib.parse.urlsplit(raw_url)
        if parsed.hostname in ("www.bing.com", "bing.com") and parsed.path == "/ck/a":
            value = urllib.parse.parse_qs(parsed.query).get("u", [""])[0]
            if value.startswith("a1"):
                encoded = value[2:]
                try:
                    return base64.urlsafe_b64decode(
                        encoded + "=" * (-len(encoded) % 4)
                    ).decode("utf-8")
                except (ValueError, UnicodeError, binascii.Error):
                    return ""
            return ""
        return raw_url

    @staticmethod
    def _public_url(raw_url: str) -> str:
        """Accept navigable public HTTP(S) links without resolving/fetching them."""
        try:
            if (
                any(char.isspace() or ord(char) < 32 for char in raw_url)
                or "\\" in raw_url
            ):
                return ""
            parsed = urllib.parse.urlsplit(raw_url)
            host = (parsed.hostname or "").lower().rstrip(".")
            if (
                parsed.scheme not in ("http", "https")
                or not host
                or parsed.username
                or parsed.password
            ):
                return ""
            if parsed.port not in (None, 80, 443):
                return ""
            try:
                if not ipaddress.ip_address(host).is_global:
                    return ""
            except ValueError:
                if "." not in host or host.endswith(
                    (".localhost", ".local", ".internal")
                ):
                    return ""
            if host in (
                "bing.com",
                "www.bing.com",
                "duckduckgo.com",
                "html.duckduckgo.com",
            ):
                return ""
            if host == "news.google.com" and not parsed.path.startswith(
                "/rss/articles/"
            ):
                return ""
            return urllib.parse.urlunsplit(parsed._replace(fragment=""))
        except ValueError:
            return ""

    def _fetch_google_live_articles(
        self, query: str, max_results: int, deadline: float
    ) -> List[Dict[str, Any]]:
        content = self._read_response(
            "GET",
            "https://news.google.com/rss/search",
            deadline,
            params={"q": query, "hl": "en-US", "gl": "US", "ceid": "US:en"},
        )
        # RSS must not expand attacker-controlled DTD/entity definitions.
        if (
            b"\x00" in content
            or b"<!DOCTYPE" in content.upper()
            or b"<!ENTITY" in content.upper()
        ):
            raise WebSearchError()
        root = ET.fromstring(content)
        if root.tag != "rss":
            raise WebSearchError()
        results = []
        for item in root.findall("./channel/item")[:max_results]:
            title = item.findtext("title") or ""
            description = item.findtext("description") or ""
            results.append(
                {
                    "title": title,
                    "url": item.findtext("link") or "",
                    "snippet": BeautifulSoup(description, "html.parser").get_text(
                        " ", strip=True
                    ),
                }
            )
        return results

    def _search_bing(
        self, query: str, max_results: int, deadline: float
    ) -> List[Dict[str, Any]]:
        content = self._read_response(
            "GET", "https://www.bing.com/search", deadline, params={"q": query}
        )
        soup = BeautifulSoup(content, "html.parser")
        if not soup.find("li", class_="b_algo") and not soup.select_one(
            "#b_results, .b_no"
        ):
            raise WebSearchError()
        results = []
        for item in soup.find_all("li", class_="b_algo"):
            heading = item.find("h2")
            link = heading.find("a") if heading else None
            excerpt = item.find("p") or item.find("div", class_="b_caption")
            if link:
                results.append(
                    {
                        "title": link.get_text(" ", strip=True),
                        "url": self._decode_bing_url(str(link.get("href", ""))),
                        "snippet": excerpt.get_text(" ", strip=True) if excerpt else "",
                    }
                )
            if len(results) >= max_results:
                break
        return results

    def _search_duckduckgo(
        self, query: str, max_results: int, deadline: float
    ) -> List[Dict[str, Any]]:
        content = self._read_response(
            "POST", "https://html.duckduckgo.com/html/", deadline, data={"q": query}
        )
        soup = BeautifulSoup(content, "html.parser")
        if not soup.select_one(".result, .no-results, .no-results__message"):
            raise WebSearchError()
        results = []
        for item in soup.find_all("div", class_="result"):
            if "result--ad" in (item.get("class") or []):
                continue
            link = item.find("a", class_="result__a")
            excerpt = item.find(class_="result__snippet")
            if not link:
                continue
            raw_url = str(link.get("href", ""))
            parsed = urllib.parse.urlsplit(raw_url)
            if (
                parsed.hostname
                in ("duckduckgo.com", "www.duckduckgo.com", "html.duckduckgo.com")
                or not parsed.netloc
            ):
                raw_url = urllib.parse.parse_qs(parsed.query).get("uddg", [raw_url])[0]
            if raw_url.startswith("//"):
                raw_url = "https:" + raw_url
            results.append(
                {
                    "title": link.get_text(" ", strip=True),
                    "url": raw_url,
                    "snippet": excerpt.get_text(" ", strip=True) if excerpt else "",
                }
            )
            if len(results) >= max_results:
                break
        return results

    def _normalize_results(
        self, results: List[Dict[str, Any]], limit: int
    ) -> List[Dict[str, Any]]:
        seen = set()
        normalized = []
        for result in results:
            title = " ".join(str(result.get("title") or "").split())[:300]
            snippet = " ".join(str(result.get("snippet") or "").split())[:2000]
            url = self._public_url(str(result.get("url") or ""))
            # Headlines alone are not evidence; deduplicate by destination, not title prefix.
            if not title or not snippet or not url or url in seen:
                continue
            seen.add(url)
            normalized.append({"title": title, "url": url, "snippet": snippet})
            if len(normalized) >= limit:
                break
        return normalized

    def search(self, query: str, max_results: int = 6) -> List[Dict[str, Any]]:
        query = query.strip()
        if not query or max_results <= 0:
            return []
        limit = min(max_results, self.MAX_RESULTS)
        deadline = time.monotonic() + self.SEARCH_TIMEOUT_SECONDS
        results = []
        failed = False
        providers = (
            self._fetch_google_live_articles,
            self._search_bing,
            self._search_duckduckgo,
        )
        for index, provider in enumerate(providers):
            if index == 2 and results:
                break
            try:
                found = provider(query, limit, deadline)
                results = self._normalize_results(results + found, limit)
            except (
                requests.RequestException,
                ET.ParseError,
                ValueError,
                WebSearchError,
            ):
                failed = True
                logger.warning("Web search adapter %s unavailable", index + 1)
        if not results and failed:
            raise WebSearchError()
        return results


web_search_service = WebSearchService()
