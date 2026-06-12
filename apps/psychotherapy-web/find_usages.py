import os
import re

src_dir = r"C:\Users\Rodrigo\.gemini\antigravity\scratch\psychotherapy-frontend\src"

def search_patterns():
    patterns = {
        'alert': re.compile(r'\balert\b'),
        'confirm': re.compile(r'\bconfirm\b'),
        'any': re.compile(r'\bany\b')
    }
    
    for root, dirs, files in os.walk(src_dir):
        for file in files:
            if file.endswith('.tsx') or file.endswith('.ts'):
                path = os.path.join(root, file)
                with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                    lines = f.readlines()
                    for idx, line in enumerate(lines, 1):
                        for name, pat in patterns.items():
                            if pat.search(line):
                                print(f"{file}:{idx} ({name}): {line.strip()}")

if __name__ == '__main__':
    search_patterns()
