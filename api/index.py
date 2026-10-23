"""
Vercel serverless entry point. vercel.json rewrites every /api/* request here; the actual
app (routes, database access) lives in the project-root app.py, shared with local
development. db.py connects to the PostgreSQL database named by POSTGRES_URL / DATABASE_URL.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app  # noqa: E402,F401
