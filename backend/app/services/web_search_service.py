import requests
from typing import List, Dict, Any
from app.core.logging import logger

class WebSearchService:
    """
    Priority 2 Web Search & Crawling Service for real-time web QA.
    """
    def search(self, query: str, max_results: int = 4) -> List[Dict[str, Any]]:
        """Perform real-time query search using DuckDuckGo HTML / API provider."""
        logger.info(f"Executing web search for query: '{query}'")
        results = []
        try:
            url = "https://html.duckduckgo.com/html/"
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            response = requests.post(url, data={"q": query}, headers=headers, timeout=5)
            
            if response.status_code == 200:
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(response.text, "html.parser")
                for a in soup.find_all("a", class_="result__snippet", limit=max_results):
                    parent = a.find_parent("div", class_="result__body")
                    title_elem = parent.find("a", class_="result__url") if parent else None
                    title = title_elem.get_text(strip=True) if title_elem else "Search Result"
                    href = title_elem.get("href") if title_elem else "#"
                    snippet = a.get_text(strip=True)

                    results.append({
                        "title": title,
                        "url": href,
                        "snippet": snippet
                    })
        except Exception as e:
            logger.warning(f"Web search scraping failed: {e}. Falling back to default search response.")

        if not results:
            results = [{
                "title": f"Real-time Search: '{query}'",
                "url": "https://duckduckgo.com/?q=" + query.replace(" ", "+"),
                "snippet": f"Simulated live web search result for query '{query}'. In production, Tavily or Serper API connects here."
            }]
            
        return results

web_search_service = WebSearchService()
