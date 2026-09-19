"""
main_once.py — Single-run version of the pipeline.
Used by GitHub Actions and other CI/CD triggers.
No scheduler, just runs once and exits.
"""
import os
import sys

# Allow importing from same directory
sys.path.insert(0, os.path.dirname(__file__))

from main import run_pipeline

if __name__ == "__main__":
    run_pipeline()
