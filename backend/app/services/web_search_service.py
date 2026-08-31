import requests
import urllib.parse
from typing import List, Dict, Any
from bs4 import BeautifulSoup
from app.core.logging import logger

class WebSearchService:
    """
    Web Search Service for real-time web query execution and context gathering.
    """
    def search(self, query: str, max_results: int = 5) -> List[Dict[str, Any]]:
        """Perform real-time query search using DuckDuckGo HTML parser with decoded direct URLs."""
        clean_query = query.strip()
        if not clean_query:
            return []

        logger.info(f"Executing web search for query: '{clean_query}'")
        results = []
        try:
            url = "https://html.duckduckgo.com/html/"
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept-Language": "en-US,en;q=0.9",
            }
            response = requests.post(url, data={"q": clean_query}, headers=headers, timeout=6)
            
            if response.status_code == 200:
                soup = BeautifulSoup(response.text, "html.parser")
                result_blocks = soup.find_all("div", class_="result")
                
                for block in result_blocks:
                    if len(results) >= max_results:
                        break
                    
                    # Ignore ads / empty results
                    if "result--ad" in block.get("class", []):
                        continue

                    title_elem = block.find("a", class_="result__a")
                    snippet_elem = block.find("a", class_="result__snippet") or block.find("div", class_="result__snippet")
                    
                    if not title_elem:
                        continue

                    title = title_elem.get_text(strip=True)
                    raw_href = title_elem.get("href", "")
                    
                    # Decode DuckDuckGo redirect link /l/?uddg=...
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
        except Exception as e:
            logger.warning(f"Web search scraping failed: {e}. Falling back to default search response.")

        if not results:
            results = [{
                "title": f"Web Search: '{clean_query}'",
                "url": "https://duckduckgo.com/?q=" + urllib.parse.quote_plus(clean_query),
                "snippet": f"Real-time web search results for query '{clean_query}'."
            }]
            
        return results

web_search_service = WebSearchService()

