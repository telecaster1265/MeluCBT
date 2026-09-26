import pdfplumber
import re
import os
import sys
import json
import time

sys.stdout.reconfigure(encoding='utf-8')

from parse_pdf_to_json import parse_single_pdf

def main():
    pdf_dir = 'pdf_files'
    img_dir = 'images'
    os.makedirs(img_dir, exist_ok=True)
    
    # Sort files: 2023 -> 2016 or chronological
    pdf_files = sorted([f for f in os.listdir(pdf_dir) if f.endswith('.pdf')], reverse=True)
    print(f"Total PDF files to process: {len(pdf_files)}")
    
    all_questions = []
    summary = []
    
    start_time = time.time()
    
    for idx, fname in enumerate(pdf_files, 1):
        fpath = os.path.join(pdf_dir, fname)
        date_match = re.search(r'(\d{4})(\d{2})(\d{2})', fname)
        if not date_match:
            print(f"Skipping {fname}: no date found")
            continue
            
        exam_slug = date_match.group(0)
        year = date_match.group(1)
        print(f"\n[{idx}/{len(pdf_files)}] Processing {fname} ({exam_slug})...")
        t0 = time.time()
        
        try:
            questions = parse_single_pdf(fpath, img_output_dir=img_dir)
            t_cost = time.time() - t0
            all_questions.extend(questions)
            
            diagram_cnt = sum(1 for q in questions if q['hasImage'])
            opt_img_cnt = sum(1 for q in questions if q['optionImages'])
            
            summary.append({
                'file': fname,
                'examDate': questions[0]['examDate'] if questions else exam_slug,
                'year': year,
                'count': len(questions),
                'diagrams': diagram_cnt,
                'optionImages': opt_img_cnt,
                'time': f"{t_cost:.1f}s"
            })
            print(f"  -> Done in {t_cost:.1f}s: {len(questions)} questions (diagrams: {diagram_cnt}, optImages: {opt_img_cnt})")
        except Exception as e:
            print(f"  -> ERROR processing {fname}: {e}")
            import traceback
            traceback.print_exc()

    # Save to questions.json
    output_json_path = 'questions.json'
    with open(output_json_path, 'w', encoding='utf-8') as f:
        json.dump(all_questions, f, ensure_ascii=False, indent=2)
        
    total_time = time.time() - start_time
    print("\n" + "="*60)
    print(f"ALL EXTRACTIONS COMPLETED in {total_time:.1f} seconds!")
    print(f"Total questions gathered: {len(all_questions)}")
    print(f"Saved to {output_json_path} ({os.path.getsize(output_json_path)/1024:.1f} KB)")
    
    # Save a metadata summary file
    with open('extraction_summary.json', 'w', encoding='utf-8') as f:
        json.dump({
            'totalQuestions': len(all_questions),
            'totalFiles': len(summary),
            'totalTime': f"{total_time:.1f}s",
            'files': summary
        }, f, ensure_ascii=False, indent=2)
    print("Saved extraction_summary.json")

if __name__ == '__main__':
    main()
