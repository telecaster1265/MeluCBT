import pdfplumber
import re
import os
import sys
import json

sys.stdout.reconfigure(encoding='utf-8')

CIRCLE_MAP = {
    '①': 1, '②': 2, '③': 3, '④': 4,
    '❶': 1, '❷': 2, '❸': 3, '❹': 4,
}
BOLD_CIRCLES = {'❶': 1, '❷': 2, '❸': 3, '❹': 4}
ALL_CIRCLES = set(CIRCLE_MAP.keys())

def extract_answer_table(pdf):
    answers = {}
    for p_idx in range(len(pdf.pages) - 1, max(-1, len(pdf.pages) - 3), -1):
        page = pdf.pages[p_idx]
        mid_x = page.width / 2
        for crop_box in [(mid_x, 40, page.width, 810), (0, 40, page.width, 810)]:
            try:
                cropped = page.crop(crop_box)
                text = cropped.extract_text() or ""
                lines = [l.strip() for l in text.split('\n') if l.strip()]
                for i in range(len(lines) - 1):
                    nums = lines[i].split()
                    if len(nums) >= 5 and all(n.isdigit() for n in nums):
                        ans_line = lines[i+1]
                        ans_chars = [c for c in ans_line if c in CIRCLE_MAP]
                        if len(ans_chars) == len(nums):
                            for n_str, a_char in zip(nums, ans_chars):
                                n = int(n_str)
                                if 1 <= n <= 100:
                                    answers[n] = CIRCLE_MAP[a_char]
            except Exception:
                pass
        if len(answers) >= 90:
            break
    return answers

def parse_single_pdf(pdf_path, img_output_dir="images"):
    filename = os.path.basename(pdf_path)
    # Extract examDate and year from filename (e.g. 정보통신기사20200524(교사용).pdf)
    date_match = re.search(r'(\d{4})(\d{2})(\d{2})', filename)
    if not date_match:
        raise ValueError(f"Cannot extract date from filename {filename}")
    year = date_match.group(1)
    exam_date = f"{year}-{date_match.group(2)}-{date_match.group(3)}"
    exam_slug = f"{year}{date_match.group(2)}{date_match.group(3)}"
    
    os.makedirs(img_output_dir, exist_ok=True)
    
    with pdfplumber.open(pdf_path) as pdf:
        table_answers = extract_answer_table(pdf)
        
        column_elements = []
        for p_idx, page in enumerate(pdf.pages):
            mid_x = page.width / 2
            
            # Left column
            left_crop = page.crop((0, 40, mid_x, 805))
            left_lines = left_crop.extract_text_lines() if hasattr(left_crop, 'extract_text_lines') else []
            left_images = [img for img in page.images if img['x0'] < mid_x and img['top'] >= 35 and img['bottom'] <= 810]
            column_elements.append({
                'p_idx': p_idx,
                'col_idx': 0,
                'lines': left_lines,
                'images': sorted(left_images, key=lambda x: (x['top'], x['x0']))
            })
            
            # Right column
            right_crop = page.crop((mid_x, 40, page.width, 805))
            right_lines = right_crop.extract_text_lines() if hasattr(right_crop, 'extract_text_lines') else []
            right_images = [img for img in page.images if img['x0'] >= mid_x - 15 and img['top'] >= 35 and img['bottom'] <= 810]
            column_elements.append({
                'p_idx': p_idx,
                'col_idx': 1,
                'lines': right_lines,
                'images': sorted(right_images, key=lambda x: (x['top'], x['x0']))
            })

        col_images_map = {(c['p_idx'], c['col_idx']): c['images'] for c in column_elements}

        current_subject = "디지털 전자회로"
        raw_questions = []
        current_q = None
        expected_id = 1
        
        re_subject = re.compile(r'^([1-5]과목\s*:\s*[^\n]+)')
        re_q_num = re.compile(r'^(\d{1,3})\.\s*(.*)')
        
        for col_entry in column_elements:
            p_idx = col_entry['p_idx']
            col_idx = col_entry['col_idx']
            lines = col_entry['lines']
            
            for line_obj in lines:
                text = line_obj['text'].strip()
                if not text:
                    continue
                
                # Check for answer table start or CBT promo footer
                if "전자문제집 CBT" in text or "기출문제 및 해설집" in text or "최강 자격증" in text or (p_idx >= len(pdf.pages) - 2 and text.startswith("1 2 3 4 5")):
                    if expected_id > 100:
                        break
                    # If this is footer text, ignore it
                    continue
                    
                subj_match = re_subject.match(text)
                if subj_match:
                    subj_text = subj_match.group(1).strip()
                    if ":" in subj_text:
                        current_subject = subj_text.split(":", 1)[1].strip()
                    else:
                        current_subject = subj_text
                    continue
                
                q_match = re_q_num.match(text)
                if q_match and int(q_match.group(1)) == expected_id:
                    if current_q:
                        current_q['end_loc'] = (p_idx, col_idx, line_obj['top'])
                        raw_questions.append(current_q)
                        
                    current_q = {
                        'id': expected_id,
                        'subject': current_subject,
                        'start_loc': (p_idx, col_idx, line_obj['top']),
                        'end_loc': None,
                        'lines': [(p_idx, col_idx, line_obj['top'], line_obj['bottom'], q_match.group(2))],
                    }
                    expected_id += 1
                elif current_q is not None:
                    current_q['lines'].append((p_idx, col_idx, line_obj['top'], line_obj['bottom'], text))
        
        if current_q:
            current_q['end_loc'] = (pdf.pages[-1].page_number - 1, 1, 805)
            raw_questions.append(current_q)
            
        # Now process each question into final schema
        final_questions = []
        
        for q in raw_questions:
            q_id = q['id']
            p_start, c_start, y_start = q['start_loc']
            p_end, c_end, y_end = q['end_loc']
            
            # Parse text into question body and options
            lines_q = []
            options = ["", "", "", ""]
            current_opt_idx = -1
            bold_ans = None
            opt_loc = None
            
            for p, c, top, bottom, line_text in q['lines']:
                if current_opt_idx == -1:
                    m = re.search(r'([①❶])', line_text)
                    if m:
                        opt_loc = (p, c, top)
                        q_before = line_text[:m.start()].strip()
                        if q_before:
                            lines_q.append(q_before)
                        tokens = re.split(r'([①②③④❶❷❸❹])', line_text[m.start():])
                        for t in tokens:
                            if not t:
                                continue
                            if t in ALL_CIRCLES:
                                if t in BOLD_CIRCLES:
                                    bold_ans = BOLD_CIRCLES[t]
                                current_opt_idx = CIRCLE_MAP[t] - 1
                            elif current_opt_idx >= 0:
                                options[current_opt_idx] += t
                    else:
                        lines_q.append(line_text)
                else:
                    tokens = re.split(r'([①②③④❶❷❸❹])', line_text)
                    if len(tokens) > 1:
                        for t in tokens:
                            if not t:
                                continue
                            if t in ALL_CIRCLES:
                                if t in BOLD_CIRCLES:
                                    bold_ans = BOLD_CIRCLES[t]
                                current_opt_idx = CIRCLE_MAP[t] - 1
                            elif current_opt_idx >= 0:
                                options[current_opt_idx] += t
                    else:
                        if current_opt_idx >= 0:
                            options[current_opt_idx] += " " + line_text.strip()
                            
            question_text = " ".join([l.strip() for l in lines_q if l.strip()])
            # Clean CBT footer from options if present
            cleaned_options = []
            for opt in options:
                opt = re.sub(r'전자문제집\s*CBT.*', '', opt, flags=re.DOTALL)
                opt = re.sub(r'최강\s*자격증.*', '', opt, flags=re.DOTALL)
                opt = re.sub(r'기출문제\s*및.*', '', opt, flags=re.DOTALL)
                cleaned_options.append(opt.strip())
            options = cleaned_options
            
            # Cross-verify answer
            tbl_a = table_answers.get(q_id)
            final_ans = bold_ans if bold_ans is not None else tbl_a
            if final_ans is None:
                final_ans = 1 # Fallback
                
            # Collect images for this question
            q_images = []
            for (p, c), imgs in col_images_map.items():
                if (p, c) < (p_start, c_start) or (p, c) > (p_end, c_end):
                    continue
                for im in imgs:
                    if (p, c) == (p_start, c_start) and im['bottom'] < y_start - 2:
                        continue
                    if (p, c) == (p_end, c_end) and im['top'] > y_end + 2:
                        continue
                    q_images.append((p, c, im))
                    
            q_diagram_imgs = []
            q_option_imgs = []
            
            if len(q_images) == 4 and (opt_loc or all(not o for o in options)):
                q_option_imgs = q_images
            elif len(q_images) == 5 and (opt_loc or all(not o for o in options)):
                q_images_sorted = sorted(q_images, key=lambda x: (x[0], x[1], x[2]['top']))
                q_diagram_imgs = [q_images_sorted[0]]
                q_option_imgs = q_images_sorted[1:]
            elif len(q_images) > 0:
                if opt_loc:
                    p_opt, c_opt, y_opt = opt_loc
                    for item in q_images:
                        p, c, im = item
                        if (p, c) < (p_opt, c_opt) or ((p, c) == (p_opt, c_opt) and im['bottom'] <= y_opt + 8):
                            q_diagram_imgs.append(item)
                        else:
                            q_option_imgs.append(item)
                else:
                    q_diagram_imgs = q_images
                    
            # Handle question diagram image
            has_image = False
            img_file = None
            if q_diagram_imgs:
                p = q_diagram_imgs[0][0]
                x0 = min(item[2]['x0'] for item in q_diagram_imgs if item[0] == p)
                top = min(item[2]['top'] for item in q_diagram_imgs if item[0] == p)
                x1 = max(item[2]['x1'] for item in q_diagram_imgs if item[0] == p)
                bottom = max(item[2]['bottom'] for item in q_diagram_imgs if item[0] == p)
                
                page = pdf.pages[p]
                bbox = (max(0, x0 - 4), max(0, top - 4), min(page.width, x1 + 4), min(page.height, bottom + 4))
                img_file = f"{exam_slug}_{q_id}.png"
                try:
                    page.crop(bbox).to_image(resolution=200).save(os.path.join(img_output_dir, img_file))
                    has_image = True
                except Exception as e:
                    print(f"Error saving image for Q{q_id}: {e}")
                    img_file = None
                    has_image = False
                    
            # Handle option images
            opt_img_files = None
            if len(q_option_imgs) == 4:
                p = q_option_imgs[0][0]
                page = pdf.pages[p]
                s_imgs = sorted(q_option_imgs, key=lambda x: x[2]['top'])
                if abs(s_imgs[0][2]['top'] - s_imgs[1][2]['top']) < 25 and abs(s_imgs[2][2]['top'] - s_imgs[3][2]['top']) < 25:
                    row1 = sorted([s_imgs[0], s_imgs[1]], key=lambda x: x[2]['x0'])
                    row2 = sorted([s_imgs[2], s_imgs[3]], key=lambda x: x[2]['x0'])
                    sorted_4 = [row1[0], row1[1], row2[0], row2[1]]
                else:
                    sorted_4 = s_imgs
                    
                opt_img_files = []
                for opt_idx, item in enumerate(sorted_4, 1):
                    im = item[2]
                    bbox = (max(0, im['x0'] - 3), max(0, im['top'] - 3), min(page.width, im['x1'] + 3), min(page.height, im['bottom'] + 3))
                    opt_filename = f"{exam_slug}_{q_id}_opt{opt_idx}.png"
                    try:
                        page.crop(bbox).to_image(resolution=200).save(os.path.join(img_output_dir, opt_filename))
                        opt_img_files.append(opt_filename)
                    except Exception as e:
                        print(f"Error saving opt image {opt_filename}: {e}")
                        
                if len(opt_img_files) != 4:
                    opt_img_files = None
                else:
                    # Provide default option labels if text was empty
                    if all(not o for o in options):
                        options = ["①", "②", "③", "④"]
                        
            final_questions.append({
                "id": q_id,
                "year": year,
                "examDate": exam_date,
                "subject": q['subject'],
                "question": question_text,
                "hasImage": has_image,
                "image": img_file if has_image else None,
                "options": options,
                "optionImages": opt_img_files,
                "answer": final_ans
            })
            
        print(f"Successfully processed {len(final_questions)} questions from {filename}")
        return final_questions

if __name__ == "__main__":
    qs = parse_single_pdf('pdf_files/정보통신기사20200524(교사용).pdf', 'images')
    with open('sample_20200524.json', 'w', encoding='utf-8') as f:
        json.dump(qs, f, ensure_ascii=False, indent=2)
    print("Saved sample_20200524.json with 100 questions.")
