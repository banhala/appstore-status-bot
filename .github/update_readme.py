from datetime import datetime

# README.md 파일 열기
with open("README.md", "r") as f:
    lines = f.readlines()

# "update date: " 라인 찾기
for i, line in enumerate(lines):
    if "update date: " in line:
        # 날짜만 표시
        lines[i] = f"update date: ({datetime.now().strftime('%Y-%m-%d')})\n"

# README.md 파일 저장
with open("README.md", "w") as f:
    f.writelines(lines)
