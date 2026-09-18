#!/usr/bin/env python3
"""
FeedToRead Newsletter & Digital News Ingestion Service
Pipeline: Fetch/Parse RSS -> Full-text Scraping Fallback -> Language Detection & Tamil-to-English Translation -> Save Staged JSON for n8n.
"""

import os
import sys
import json
import time
import logging
import re
from datetime import datetime
from pathlib import Path

import requests
import feedparser
import trafilatura
from urllib.parse import urljoin
from bs4 import BeautifulSoup
from langdetect import detect, DetectorFactory
from deep_translator import GoogleTranslator

# Enforce deterministic results from langdetect
DetectorFactory.seed = 0

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger("NewsletterIngestion")

BASE_DIR = Path(__file__).resolve().parent
SOURCES_FILE = BASE_DIR / "sources.json"
OUTPUT_FILE = BASE_DIR / "newsletter_stage.json"

DEFAULT_SOURCES = [
    {
        "name": "The Hindu (Tech)",
        "url": "https://www.thehindu.com/sci-tech/technology/feeder/default.rss"
    },
    {
        "name": "Times of India (Tech)",
        "url": "https://timesofindia.indiatimes.com/rssfeeds/66949542.cms"
    },
    {
        "name": "Daily Thanthi (Tamil)",
        "url": "https://news.google.com/rss/search?q=site:dailythanthi.com&hl=ta&gl=IN&ceid=IN:ta"
    },
    {
        "name": "Dinamani (Tamil)",
        "url": "https://www.dinamani.com/tamilnadu/rss/"
    },
    {
        "name": "The Verge (Tech)",
        "url": "https://www.theverge.com/rss/index.xml"
    }
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
}



def load_sources():
    """Load news sources from sources.json or fallback to defaults."""
    if SOURCES_FILE.exists():
        try:
            with open(SOURCES_FILE, "r", encoding="utf-8") as f:
                sources = json.load(f)
                if isinstance(sources, list) and len(sources) > 0:
                    logger.info(f"Loaded {len(sources)} sources from {SOURCES_FILE.name}")
                    return sources
        except Exception as e:
            logger.warning(f"Could not parse {SOURCES_FILE.name} ({e}). Using default sources.")
    return DEFAULT_SOURCES


def clean_html_tags(raw_html):
    """Clean basic HTML tags if fallback summary contains raw tags."""
    if not raw_html:
        return ""
    clean_text = re.sub(r'<[^>]+>', ' ', raw_html)
    return " ".join(clean_text.split())


def extract_article_media(article_url):
    try:
        # 1. Follow redirects so Google News links resolve to the actual dailythanthi.com URL
        session = requests.Session()
        res = session.get(article_url, headers=HEADERS, timeout=12, allow_redirects=True)
        if res.status_code != 200:
            return None

        actual_url = res.url
        soup = BeautifulSoup(res.text, "html.parser")

        # 2. Check Open Graph image, but reject Google News fallback assets
        og_img = (
            soup.find("meta", property="og:image")
            or soup.find("meta", attrs={"name": "twitter:image"})
        )
        if og_img and og_img.get("content"):
            img_candidate = og_img["content"].strip()
            # Ignore Google News placeholder icons
            if not any(bad in img_candidate.lower() for bad in ["google", "gstatic", "default_news", "placeholder", "logo"]):
                return img_candidate

        # 3. Target Daily Thanthi / News Site Lead Image containers directly
        lead_img_selectors = [
            ".article-lead-image img",
            ".story-image img",
            ".lead-img img",
            ".artImg img",
            "picture img",
            "figure img",
            ".detail-image img"
        ]
        
        for selector in lead_img_selectors:
            target = soup.select_one(selector)
            if target:
                src = target.get("src") or target.get("data-src") or target.get("data-original")
                if src and not any(bad in src.lower() for bad in ["logo", "icon", "advert", "avatar", "google"]):
                    return urljoin(actual_url, src.strip())

        # 4. General fallback: top body image with sensible news dimensions
        for img in soup.find_all("img"):
            src = img.get("src") or img.get("data-src") or img.get("data-original")
            if not src:
                continue
            src_lower = src.lower()
            if any(bad in src_lower for bad in ["logo", "icon", "ad-", "tracking", "avatar", "google", "gstatic"]):
                continue
            
            full_url = urljoin(actual_url, src.strip())
            if full_url.startswith("http"):
                return full_url

    except Exception as e:
        print(f"Error scraping image from {article_url}: {e}")
        
    return None



def scrape_full_text(url, fallback_summary=""):
    """
    Scrape full article text using trafilatura with custom headers.
    Falls back to RSS summary/content if scraping fails or returns minimal content.
    Returns (extracted_text, raw_html).
    """
    downloaded = None
    try:
        downloaded = trafilatura.fetch_url(url, config=trafilatura.settings.use_config())
        if not downloaded:
            # Secondary fetch with requests session and custom headers
            resp = requests.get(url, headers=HEADERS, timeout=12)
            if resp.status_code == 200:
                downloaded = resp.text

        if downloaded:
            extracted = trafilatura.extract(
                downloaded,
                include_comments=False,
                include_tables=False,
                no_fallback=False
            )
            if extracted and len(extracted.strip()) > 120:
                return extracted.strip(), downloaded
    except Exception as e:
        logger.debug(f"Trafilatura extraction failed for {url}: {e}")

    # Fallback to cleaned RSS entry summary
    return clean_html_tags(fallback_summary), downloaded


def detect_language_safe(text):
    """Detect language code safely using langdetect, defaulting to 'en'."""
    if not text or len(text.strip()) < 10:
        return "en"
    try:
        # Sample first 500 characters for robust detection
        sample = text.strip()[:500]
        return detect(sample)
    except Exception:
        return "en"


def translate_tamil_to_english(text):
    """
    Translates Tamil text to English using GoogleTranslator in chunks
    under 3000 characters with retry logic.
    """
    if not text or not text.strip():
        return ""

    try:
        translator = GoogleTranslator(source="ta", target="en")

        # Split text into chunks <= 2500 chars (by paragraphs)
        paragraphs = text.split("\n")
        chunks = []
        current_chunk = []
        current_len = 0

        for p in paragraphs:
            p_str = p.strip()
            if not p_str:
                continue
            if current_len + len(p_str) + 1 > 2500:
                chunks.append("\n".join(current_chunk))
                current_chunk = [p_str]
                current_len = len(p_str)
            else:
                current_chunk.append(p_str)
                current_len += len(p_str) + 1

        if current_chunk:
            chunks.append("\n".join(current_chunk))

        translated_chunks = []
        for chunk in chunks:
            if not chunk.strip():
                continue
            translated = None
            for attempt in range(3):
                try:
                    translated = translator.translate(chunk)
                    if translated:
                        break
                except Exception as ex:
                    time.sleep(1.0 * (attempt + 1))
            if translated:
                translated_chunks.append(translated)
            else:
                translated_chunks.append(chunk)
            time.sleep(0.5)

        return "\n\n".join(translated_chunks) if translated_chunks else text
    except Exception as e:
        logger.warning(f"Translation failed: {e}. Preserving original content.")
        return text


def parse_published_date(entry):
    """Extract standard ISO-8601 published date or fallback to now."""
    if hasattr(entry, "published_parsed") and entry.published_parsed:
        try:
            return datetime(*entry.published_parsed[:6]).isoformat() + "Z"
        except Exception:
            pass
    if hasattr(entry, "published") and entry.published:
        return str(entry.published)
    return datetime.utcnow().isoformat() + "Z"


def process_feed(source_info, max_items_per_feed=5):
    """Fetches feed and processes top items."""
    source_name = source_info.get("name", "Unknown Source")
    feed_url = source_info.get("url")

    logger.info(f"Parsing feed [{source_name}] -> {feed_url}")
    articles = []

    try:
        # Fetch with custom headers
        resp = requests.get(feed_url, headers=HEADERS, timeout=15)
        feed = feedparser.parse(resp.content if resp.status_code == 200 else feed_url)

        if not feed.entries:
            logger.warning(f"No entries found in feed: {source_name}")
            return []

        entries_to_process = feed.entries[:max_items_per_feed]

        for entry in entries_to_process:
            headline = entry.get("title", "").strip() if hasattr(entry, "get") else getattr(entry, "title", "").strip()
            link = entry.get("link", "").strip() if hasattr(entry, "get") else getattr(entry, "link", "").strip()

            if not headline or not link:
                continue

            summary_candidate = entry.get("summary", "") if hasattr(entry, "get") else getattr(entry, "summary", "")
            if not summary_candidate and hasattr(entry, "content") and entry.content:
                summary_candidate = entry.content[0].get("value", "")

            # Step 1: Scrape full-text or fallback
            content, raw_html = scrape_full_text(link, fallback_summary=summary_candidate)
            if not content:
                content = headline

            # Step 2: Extract lead image from OG tags, RSS enclosure or body <img>
            image_url = extract_article_media(link)
            if not image_url:
                if hasattr(entry, "media_content") and entry.media_content:
                    image_url = entry.media_content[0].get("url")
                elif hasattr(entry, "enclosures") and entry.enclosures:
                    image_url = entry.enclosures[0].get("href")

            # Step 3: Language detection
            detected_lang = detect_language_safe(content)

            # Step 4: Tamil to English translation if needed
            if detected_lang == "ta":
                logger.info(f"Detected Tamil (ta) for '{headline[:40]}...'. Translating to English...")
                content = translate_tamil_to_english(content)
                # Translate headline too if detected in Tamil
                if detect_language_safe(headline) == "ta":
                    try:
                        headline = GoogleTranslator(source="ta", target="en").translate(headline)
                    except Exception:
                        pass
            elif detected_lang == "en":
                # Leave unchanged
                pass

            articles.append({
                "source": source_name,
                "headline": headline,
                "url": entry.get("link", "").strip() if hasattr(entry, "get") else getattr(entry, "link", "").strip(),
                "published_at": parse_published_date(entry),
                "image_url": image_url,
                "language_detected": detected_lang,
                "content": content
            })

            logger.info(f"  ✓ Processed: {headline[:50]}... [{detected_lang}]")

    except Exception as e:
        logger.error(f"Error processing feed {source_name}: {e}")

    return articles


def main():
    logger.info("=== FeedToRead Newsletter Ingestion Pipeline Starting ===")
    start_time = time.time()

    sources = load_sources()
    all_staged_articles = []

    for src in sources:
        feed_articles = process_feed(src, max_items_per_feed=4)
        all_staged_articles.extend(feed_articles)

    # Save staged JSON for n8n
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(all_staged_articles, f, indent=2, ensure_ascii=False)

    elapsed = round(time.time() - start_time, 2)
    logger.info(f"Pipeline completed in {elapsed}s.")
    logger.info(f"Total articles staged: {len(all_staged_articles)}")
    logger.info(f"Output saved to: {OUTPUT_FILE}")

    return len(all_staged_articles)


if __name__ == "__main__":
    count = main()
    sys.exit(0 if count >= 0 else 1)
