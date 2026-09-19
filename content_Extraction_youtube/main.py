import os
import requests
import warnings
import time
import sys
import re
from datetime import datetime
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound
from youtube_transcript_api.formatters import SRTFormatter
import base64
from dotenv import load_dotenv
# pyrefly: ignore [missing-import]
from apscheduler.schedulers.blocking import BlockingScheduler

load_dotenv()

# Reconfigure stdout to support printing emojis and unicode characters on Windows
sys.stdout.reconfigure(encoding='utf-8')
warnings.filterwarnings("ignore")

API_KEY = os.environ.get("YOUTUBE_API_KEY")
CHANNELS = ["Mic Story"]
BASE_URL = "https://www.googleapis.com/youtube/v3"
# Configurable backend URL: set BACKEND_URL env var for deployed backends,
# falls back to localhost for local development
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")

def find_channel(channel_name):
    """Find a YouTube channel by name."""
    url = f"{BASE_URL}/search"
    params = {
        "part": "snippet",
        "q": channel_name,
        "type": "channel",
        "maxResults": 5,
        "key": API_KEY
    }

    response = requests.get(url, params=params)
    if response.status_code != 200:
        print("Error finding channel:")
        print(response.text)
        return None

    data = response.json()
    if not data.get("items"):
        print("No channel found.")
        return None

    channel = None
    for item in data["items"]:
        if item["snippet"]["title"].lower() == channel_name.lower():
            channel = item
            break
            
    if not channel:
        print(f"Exact match for '{channel_name}' not found, falling back to the first result.")
        channel = data["items"][0]

    channel_id = channel["id"]["channelId"]
    channel_title = channel["snippet"]["title"]

    print("Selected channel")
    print("-" * 60)
    print("Name      :", channel_title)
    print("Channel ID:", channel_id)

    return channel_id

def get_uploads_playlist(channel_id):
    """Get the upload playlist ID for a channel."""
    url = f"{BASE_URL}/channels"
    params = {
        "part": "contentDetails",
        "id": channel_id,
        "key": API_KEY
    }

    response = requests.get(url, params=params)
    if response.status_code != 200:
        print("Error getting channel details:")
        print(response.text)
        return None

    data = response.json()
    if not data.get("items"):
        print("Channel details not found.")
        return None

    uploads_playlist_id = data["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]

    print("\nUploads playlist")
    print("-" * 60)
    print("Playlist ID:", uploads_playlist_id)

    return uploads_playlist_id

def get_latest_long_video_id(playlist_id):
    """Get the latest uploaded long video (not a Short)."""
    url = f"{BASE_URL}/playlistItems"
    params = {
        "part": "snippet,contentDetails",
        "playlistId": playlist_id,
        "maxResults": 15,
        "key": API_KEY
    }

    response = requests.get(url, params=params)
    if response.status_code != 200:
        print("Error getting videos:")
        print(response.text)
        return None

    data = response.json()
    items = data.get("items", [])
    if not items:
        return None

    video_ids = [item["contentDetails"]["videoId"] for item in items]
    
    videos_url = f"{BASE_URL}/videos"
    videos_params = {
        "part": "snippet,contentDetails",
        "id": ",".join(video_ids),
        "key": API_KEY
    }
    
    videos_response = requests.get(videos_url, params=videos_params)
    if videos_response.status_code != 200:
        print("Error getting video details.")
        return None
        
    videos_data = videos_response.json()
    video_details = {v["id"]: v for v in videos_data.get("items", [])}

    for item in items:
        video_id = item["contentDetails"]["videoId"]
        details = video_details.get(video_id)
        if not details: continue
        
        duration = details["contentDetails"]["duration"]
        title = details["snippet"]["title"]
        
        # Accurately determine if a video is a Short by pinging the /shorts/ URL
        try:
            r = requests.head(f"https://www.youtube.com/shorts/{video_id}", allow_redirects=False, timeout=5)
            is_short = (r.status_code == 200)
        except Exception:
            # Fallback to simple duration check if network request fails
            is_short = ("M" not in duration) and ("H" not in duration)
        
        if not is_short and "#shorts" not in title.lower():
            published = details["snippet"]["publishedAt"]
            video_url = f"https://www.youtube.com/watch?v={video_id}"

            print("\nLatest Long Video")
            print("=" * 60)
            print("Title     :", title)
            print("Published :", published)
            print("Video ID  :", video_id)
            print("Duration  :", duration)
            print("URL       :", video_url)
            print("-" * 60)
            
            return {
                "video_id": video_id,
                "title": title,
                "published_at": published,
                "url": video_url
            }

    print("No long videos found in recent uploads.")
    return None

def download_audio(video_id, output_path="audio.m4a"):
    print(f"Downloading audio for video {video_id} using yt-dlp...")
    import yt_dlp
    ydl_opts = {
        'format': 'worstaudio[ext=m4a]/worstaudio/bestaudio',
        'outtmpl': output_path,
        'quiet': True,
        'no_warnings': True,
        'extractor_args': {'youtube': ['player_client=ANDROID,WEB']},
        'http_headers': {'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip'}
    }
    if os.path.exists(output_path):
        os.remove(output_path)
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([f'https://www.youtube.com/watch?v={video_id}'])
    return output_path

def run_groq_translation(audio_path):
    print("Uploading audio to Groq (Whisper Large v3) for translation...")
    
    api_key = os.environ.get("GROQ_API_KEY")
    
    with open(audio_path, "rb") as f:
        headers = {
            "Authorization": f"Bearer {api_key}"
        }
        files = {
            "file": (os.path.basename(audio_path), f, "audio/m4a")
        }
        data = {
            "model": "whisper-large-v3",
            "response_format": "text"
        }
        
        response = requests.post("https://api.groq.com/openai/v1/audio/translations", headers=headers, files=files, data=data)
        
        if response.status_code != 200:
            print("Groq API Error Response:", response.text)
            
        response.raise_for_status()
        
        result = response.text.strip()
        print("Translation complete!")
        return result

def send_to_backend(video_data, channel_name, plain_text):
    import datetime
    try:
        print("\nSending extracted text to FeedRead backend...")
        payload = {
            "source_type": "youtube",
            "source_name": channel_name,
            "source_url": video_data["url"],
            "title": video_data["title"],
            "content": plain_text,
            "published_at": video_data["published_at"],
            "fetched_at": datetime.datetime.utcnow().isoformat() + "Z"
        }
        res = requests.post(f"{BACKEND_URL}/ingest", json=payload, timeout=60)
        print(f"Backend response: {res.status_code}")
        try:
            print(res.json())
        except:
            print(res.text)
    except Exception as e:
        print(f"Failed to send to backend: {e}")

def process_video(video_data, channel_name):
    video_id = video_data["video_id"]
    print(f"\n============================================================")
    print(f"Processing Video ID: {video_id}")
    print(f"============================================================")
    
    # Try fetching English transcript
    print("Checking for English transcript...")
    try:
        api = YouTubeTranscriptApi()
        # The user's original script uses api.fetch()
        fetched_data = api.fetch(video_id, languages=["en", "en-IN", "en-GB", "en-US", "ta"])
        
        # If it returned a transcript, let's see if it's English
        lang = getattr(fetched_data, 'language_code', 'unknown')
        if not lang.startswith('en'):
            # It's Tamil or something else, we want English
            raise ValueError("Not English")
            
        print("\nTranscript found!")
        print("Language:", getattr(fetched_data, 'language', lang))
        print("Language code:", lang)
        print("Auto-generated:", getattr(fetched_data, 'is_generated', False))
        
        # Create SRT
        formatter = SRTFormatter()
        # For this specific API version, fetch() returns an iterable of snippets
        srt_text = formatter.format_transcript(fetched_data)
        
        with open(f"{video_id}.srt", "w", encoding="utf-8") as file:
            file.write(srt_text)
            
        # Create plain text (handle if snippets are dicts or objects)
        try:
            plain_text = "\n".join(snippet['text'] for snippet in fetched_data)
        except TypeError:
            plain_text = "\n".join(snippet.text for snippet in fetched_data)
        
        with open(f"{video_id}.txt", "w", encoding="utf-8") as file:
            file.write(plain_text)
            
        print("\nFiles created successfully:")
        print(f"{video_id}.srt")
        print(f"{video_id}.txt")
        send_to_backend(video_data, channel_name, plain_text)
        return
        
    except Exception as e:
        print(f"No English transcript found: {e}")
        
    print("\nFalling back to Groq Audio translation...")
    audio_file = f"{video_id}_audio.m4a"
    download_audio(video_id, audio_file)
    
    plain_text = run_groq_translation(audio_file)
    
    if not plain_text.strip():
        print("WARNING: Groq returned empty translation!")
        
    if os.path.exists(audio_file):
        os.remove(audio_file)
        
    with open(f"{video_id}.txt", "w", encoding="utf-8") as file:
        file.write(plain_text)
        
    print(f"\nFile created successfully:")
    print(f"{video_id}.txt")
    send_to_backend(video_data, channel_name, plain_text)

def ensure_backend_running():
    # If a remote backend URL is configured, skip auto-start
    if BACKEND_URL != "http://localhost:8000":
        print(f"Using remote backend: {BACKEND_URL}")
        return
    try:
        res = requests.get(f"{BACKEND_URL}/health", timeout=2)
        if res.status_code == 200:
            return
    except requests.exceptions.ConnectionError:
        pass

    print("Backend server not running. Starting it automatically...")
    
    import subprocess
    backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    
    subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--port", "8000"],
        cwd=backend_dir,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0
    )
    
    # Wait for the server to spin up
    for _ in range(15):
        time.sleep(1)
        try:
            res = requests.get("http://localhost:8000/health", timeout=1)
            if res.status_code == 200:
                print("Backend server started successfully.")
                return
        except requests.exceptions.ConnectionError:
            pass
            
    print("WARNING: Could not verify if backend server started correctly.")

def run_pipeline():
    """Run the full YouTube extraction pipeline for all channels."""
    print(f"\n{'='*60}")
    print(f"Pipeline started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}")

    ensure_backend_running()
    
    if not API_KEY:
        print("ERROR: YOUTUBE_API_KEY not set in .env")
        return

    print("FeedToRead YouTube Pipeline")
    print("=" * 60)

    for channel_name in CHANNELS:
        print("\n" + "*" * 60)
        print(f"Processing channel: {channel_name}")
        print("*" * 60)

        channel_id = find_channel(channel_name)
        if not channel_id:
            continue

        playlist_id = get_uploads_playlist(channel_id)
        if not playlist_id:
            continue

        video_data = get_latest_long_video_id(playlist_id)
        if video_data:
            video_id = video_data["video_id"]
            print(f"\nSuccessfully retrieved long video ID: {video_id} for {channel_name}")
            process_video(video_data, channel_name)

    print(f"\nPipeline finished at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

if __name__ == "__main__":
    # Run immediately on startup so you don't have to wait for 8:30 AM
    print("Running pipeline immediately on startup...")
    run_pipeline()

    # Schedule to run every day at 8:30 AM
    scheduler = BlockingScheduler()
    scheduler.add_job(
        run_pipeline,
        trigger='cron',
        hour=8,
        minute=30,
        id='daily_youtube_pipeline'
    )

    print("\nScheduler started. Pipeline will run daily at 08:30 AM.")
    print("Press Ctrl+C to stop.")

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        print("\nScheduler stopped.")
        scheduler.shutdown()
