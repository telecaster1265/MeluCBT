import requests
import re
import json
import time
import sys

sys.stdout.reconfigure(encoding='utf-8')

# 23 exams mapping
EXAMS = [
    ('cey', '20230617', '2023-06-17'),
    ('cey', '20230321', '2023-03-21'),
    ('cey', '20221008', '2022-10-08'),
    ('cey', '20220625', '2022-06-25'),
    ('cey', '20220312', '2022-03-12'),
    ('ns', '20211015', '2021-10-15'),
    ('ns', '20210626', '2021-06-26'),
    ('ns', '20210313', '2021-03-13'),
    ('ns', '20200926', '2020-09-26'),
    ('ns', '20200627', '2020-06-27'),
    ('ns', '20200524', '2020-05-24'),
    ('ns', '20191012', '2019-10-12'),
    ('ns', '20190629', '2019-06-29'),
    ('ns', '20190309', '2019-03-09'),
    ('ns', '20181006', '2018-10-06'),
    ('ns', '20180616', '2018-06-16'),
    ('ns', '20180310', '2018-03-10'),
    ('ns', '20170923', '2017-09-23'),
    ('ns', '20170507', '2017-05-07'),
    ('ns', '20170305', '2017-03-05'),
    ('ns', '20161001', '2016-10-01'),
    ('ns', '20160508', '2016-05-08'),
    ('ns', '20160306', '2016-03-06'),
]

s = requests.Session()
s.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
    'Referer': 'https://www.comcbt.com/cbt/onlyview2.php'
})

scraped_data = {} # (examDate, q_num) -> explanation

for db, tablename, examDate in EXAMS:
    print(f"Scraping {examDate} ({db} / {tablename})...")
    data = {
        'mode': 'mode2',
        'jmode': 'jmode2',
        'dbname': db,
        'tablename': tablename,
        'startnumber': '0',
        'hack_number': '29',
        'h_db': db
    }
    try:
        r = s.post('https://www.comcbt.com/cbt/onlyview3.php', data=data, timeout=15)
        blocks = re.split(r'<div class=[\'"]grid-box[\'"]>', r.text)
        count = 0
        exp_count = 0
        for b in blocks[1:]:
            q_match = re.search(r'<b>(\d+)\.\s*</b>', b)
            if not q_match:
                continue
            q_num = int(q_match.group(1))
            count += 1
            
            exp_match = re.search(r'(?:&lt;문제 해설&gt;|<문제 해설>)(.*?)</td>', b, re.DOTALL)
            if exp_match:
                raw_exp = exp_match.group(1)
                clean_exp = re.sub(r'<br\s*/?>', '\n', raw_exp)
                clean_exp = re.sub(r'<[^>]+>', '', clean_exp)
                clean_exp = clean_exp.replace('&lt;', '<').replace('&gt;', '>').replace('&nbsp;', ' ')
                clean_exp = clean_exp.strip()
                if clean_exp:
                    scraped_data[f"{examDate}_{q_num}"] = clean_exp
                    exp_count += 1
        print(f" -> Found {count} questions, {exp_count} with explanations.")
    except Exception as e:
        print(f" -> ERROR: {e}")
    time.sleep(0.5)

print(f"\nTotal scraped explanations: {len(scraped_data)} / 2300")

with open('comcbt_explanations.json', 'w', encoding='utf-8') as f:
    json.dump(scraped_data, f, ensure_ascii=False, indent=2)

print("Saved to comcbt_explanations.json")
