#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=================================================="
echo "  FeedToRead Newsletter & News Ingestion Pipeline "
echo "=================================================="

# 1. Virtual environment setup
VENV_DIR="$DIR/venv"
if [ ! -d "$VENV_DIR" ]; then
    echo "[+] Creating Python virtual environment in $VENV_DIR..."
    python3 -m venv "$VENV_DIR"
fi

echo "[+] Activating virtual environment..."
source "$VENV_DIR/bin/activate"

# 2. Dependency verification and install
echo "[+] Checking requirements..."
pip install --quiet --upgrade pip
pip install --quiet -r "$DIR/requirements.txt"

# 3. Execute scraping & ingestion pipeline
echo "[+] Running ingestion service..."
python3 "$DIR/service.py"

# 4. Verification & Item Count Display
STAGE_FILE="$DIR/newsletter_stage.json"
if [ -f "$STAGE_FILE" ]; then
    ITEM_COUNT=$(python3 -c "import json; data=json.load(open('$STAGE_FILE')); print(len(data))" 2>/dev/null || echo "0")
    echo "=================================================="
    echo "  ✓ Pipeline Execution Complete"
    echo "  ✓ Staged Output: $STAGE_FILE"
    echo "  ✓ Total Items Staged for n8n: $ITEM_COUNT"
    echo "=================================================="
else
    echo "[-] Error: $STAGE_FILE was not generated."
    exit 1
fi
