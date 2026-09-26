import pdfplumber
import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

from test_parse_full import CIRCLE_MAP, extract_answer_table

pdf_dir = 'pdf_files'
pdf_files = sorted([f for f in os.listdir(pdf_dir) if f.endswith('.pdf')])

print(f"Total PDF files to inspect: {len(pdf_files)}")

results = []

for filename in pdf_files:
    path = os.path.join(pdf_dir, filename)
    date_match = re.search(r'(\d{4})(\d{2})(\d{2})', filename)
    date_str = date_match.group(0) if date_match else "unknown"
    
    try:
        with pdfplumber.open(path) as pdf:
            page_count = len(pdf.pages)
            ans_tbl = extract_answer_table(pdf)
            total_images = sum(len(p.images) for p in pdf.pages)
            results.append({
                'file': filename,
                'date': date_str,
                'pages': page_count,
                'ans_table_count': len(ans_tbl),
                'total_images': total_images
            })
            print(f"[{date_str}] Pages: {page_count:2d}, Table Answers: {len(ans_tbl):3d}/100, Images: {total_images:3d}")
    except Exception as e:
        print(f"[{date_str}] Error: {e}")
