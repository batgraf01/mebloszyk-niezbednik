#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import sys
import os

# Dodaj ścieżkę do aplikacji
sys.path.insert(0, os.path.dirname(__file__))

from app import app as application

if __name__ == "__main__":
    application.run()

