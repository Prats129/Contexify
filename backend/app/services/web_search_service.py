import base64
import requests
import urllib.parse
import xml.etree.ElementTree as ET
from typing import List, Dict, Any
from bs4 import BeautifulSoup
from app.core.logging import logger

class WebSearchService:
    """
    Web Search Service for real-time web query execution and context gathering.
    Combines Google's live article search with Bing web search to deliver rich,
    concrete, up-to-the-minute details and direct destination URLs.
    """
    def _decode_bing_url(self, raw_url: str) -> str:
        """Decode Bing redirect URL (/ck/a?!&&p=...&u=a1<base64>&ntb=1) to real destination."""
        try:
            if "/ck/a?" in raw_url and "&u=" in raw_url:
                parsed = urllib.parse.urlparse(raw_url)
                qs = urllib.parse.parse_qs(parsed.query)
                if "u" in qs and qs["u"]:
                    val = qs["u"][0]
                    if val.startswith("a1"):
                        encoded = val[2:]
                        missing_padding = len(encoded) % 4
                        if missing_padding:
                            encoded += "=" * (4 - missing_padding)
                        return base64.b64decode(encoded).decode("utf-8", errors="ignore")
        except Exception:
            pass
        return raw_url

    def _fetch_google_live_articles(self, clean_query: str, max_results: int = 4) -> List[Dict[str, Any]]:
        """Fetch fresh, specific articles and breaking headlines from Google's live search feed."""
        try:
            encoded_q = urllib.parse.quote(clean_query)
            g_url = f"https://news.google.com/rss/search?q={encoded_q}&hl=en-US&gl=US&ceid=US:en"
            resp = requests.get(g_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=4)
            if resp.status_code == 200:
                root = ET.fromstring(resp.content)
                results = []
                for item in root.findall(".//item")[:max_results]:
                    title = item.find("title").text if item.find("title") is not None else ""
                    link = item.find("link").text if item.find("link") is not None else ""
                    desc = item.find("description").text if item.find("description") is not None else ""
                    desc_text = BeautifulSoup(desc, "html.parser").get_text(separator=" ", strip=True) if desc else title
                    if title:
                        results.append({
                            "title": title,
                            "url": link or "https://news.google.com",
                            "snippet": f"{title}. Details: {desc_text}"
                        })
                return results
        except Exception as e:
            logger.debug(f"Google live articles feed note: {e}")
        return []

    def _search_bing(self, clean_query: str, max_results: int = 4) -> List[Dict[str, Any]]:
        """Search Bing for general web coverage, encyclopedic data, and documentation."""
        try:
            url = f"https://www.bing.com/search?q={urllib.parse.quote(clean_query)}"
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            }
            response = requests.get(url, headers=headers, timeout=5)
            if response.status_code == 200:
                soup = BeautifulSoup(response.text, "html.parser")
                results = []
                for li in soup.find_all("li", class_="b_algo"):
                    if len(results) >= max_results:
                        break
                    h2 = li.find("h2")
                    a = h2.find("a") if h2 else None
                    p = li.find("p") or li.find("div", class_="b_caption")
                    if a and a.get("href"):
                        raw_href = a["href"]
                        clean_url = self._decode_bing_url(raw_href)
                        title = a.get_text(strip=True)
                        snippet = p.get_text(strip=True) if p else ""
                        if title and clean_url and not clean_url.startswith("#"):
                            results.append({
                                "title": title,
                                "url": clean_url,
                                "snippet": snippet or title
                            })
                return results
        except Exception as e:
            logger.debug(f"Bing search note: {e}")
        return []

    def _search_duckduckgo(self, clean_query: str, max_results: int = 4) -> List[Dict[str, Any]]:
        """Fallback search using DuckDuckGo HTML parser."""
        try:
            url = "https://html.duckduckgo.com/html/"
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept-Language": "en-US,en;q=0.9",
            }
            response = requests.post(url, data={"q": clean_query}, headers=headers, timeout=5)
            if response.status_code == 200:
                soup = BeautifulSoup(response.text, "html.parser")
                results = []
                for block in soup.find_all("div", class_="result"):
                    if len(results) >= max_results:
                        break
                    if "result--ad" in block.get("class", []):
                        continue

                    title_elem = block.find("a", class_="result__a")
                    snippet_elem = block.find("a", class_="result__snippet") or block.find("div", class_="result__snippet")
                    if not title_elem:
                        continue

                    title = title_elem.get_text(strip=True)
                    raw_href = title_elem.get("href", "")
                    clean_url = raw_href
                    if "uddg=" in raw_href:
                        parsed = urllib.parse.urlparse(raw_href)
                        qs = urllib.parse.parse_qs(parsed.query)
                        if "uddg" in qs and qs["uddg"]:
                            clean_url = qs["uddg"][0]
                    elif raw_href.startswith("//"):
                        clean_url = "https:" + raw_href

                    snippet = snippet_elem.get_text(strip=True) if snippet_elem else ""
                    if title and clean_url and clean_url != "#":
                        results.append({
                            "title": title,
                            "url": clean_url,
                            "snippet": snippet
                        })
                return results
        except Exception as e:
            logger.debug(f"DuckDuckGo fallback note: {e}")
        return []

    def search(self, query: str, max_results: int = 6) -> List[Dict[str, Any]]:
        """
        Perform real-time multi-source web search:
        Aggregates Google live articles with Bing general web coverage to give the LLM
        both specific event details and broad web context.
        """
        clean_query = query.strip()
        if not clean_query:
            return []

        logger.info(f"Executing multi-source web search for query: '{clean_query}'")
        results = []

        # 1. Fetch live Google articles (specific headlines, breaking developments)
        google_articles = self._fetch_google_live_articles(clean_query, max_results=3)
        results.extend(google_articles)

        # 2. Fetch Bing web results (encyclopedic, technical, and web pages)
        bing_results = self._search_bing(clean_query, max_results=3)
        results.extend(bing_results)

        # 3. Fallback to DuckDuckGo if both returned empty
        if not results:
            ddg_results = self._search_duckduckgo(clean_query, max_results=max_results)
            results.extend(ddg_results)

        # Deduplicate results by title similarity
        seen = set()
        deduped = []
        for r in results:
            key = r.get("title", "").lower()[:35]
            if key and key not in seen:
                seen.add(key)
                deduped.append(r)
            if len(deduped) >= max_results:
                break

        if not deduped:
            deduped = [{
                "title": f"Web Search: '{clean_query}'",
                "url": "https://www.bing.com/search?q=" + urllib.parse.quote_plus(clean_query),
                "snippet": f"Real-time web search results for query '{clean_query}'."
            }]

        return deduped

web_search_service = WebSearchService()

