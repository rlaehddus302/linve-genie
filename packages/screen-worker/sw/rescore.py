# 보스·럭셔리·다육홀릭·경성(믿을 만한 정답 있는 4방송): 저장된 화면 읽기·받아쓰기로 지금 규칙을 다시 판정해 정답과 맞춘다(LLM 없음, 몇 초).
# 규칙을 고칠 때마다 sw.regress(회귀 5방송)와 같이 돌린다.
# 사용: python -m sw.rescore
import csv
import os

from .paths import FIRST
from .run_regress import run

SHARE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "share")
SETS = [("보스", "now_boss_flK4emzquko", "보스다육_20261108_정답지.csv"), ("럭셔리", "now_luxury_CTpU2iLAIdA", "럭셔리다육_20261104_정답지.csv"),
        ("다육홀릭", "now_dayukholic_04n9t0Md9U0", "다육홀릭_20261103_정답지.csv"), ("경성", "now_gyeongseong_1aKI6G8j3Vs", "경성다육_20261102_정답지.csv"),
        ("금화", "bossfix_pHoACV8knTY", "금화_20261102_정답지.csv"),   # 금화 11/2(pHoACV8knTY): 11/8 저장 STT·OCR, 사용자 정답지 2026-11-10
        ("천동", "now_cheondong_8Tw1PMuw7Nc", "천동_20261110_정답지.csv"),   # 천동 11/10(8Tw1PMuw7Nc, 강남다육 2부): 유튜브 주소에서 바로 일꾼, 사용자 정답지 2026-11-10
        ("정성", "now_jeongseong_Pq_df8gow_8", "정성_20261108_정답지.csv"),
        ("수정", "reg_sujeong_20261103_ehT8SyVBNXY", "수정다육_20261103_정답지.csv"),   # 수정 11/3: 관리자 채팅 "N번 품종 가격" 글로 만든 정답지(2026-11-11, 품종 검증용)   # 정성 11/8(Pq_df8gow_8): 사용자 정답지 2026-11-11, 안 본 방송
        ("마태", "now_matae__9epGQSWvlg", "마태다육_20261109_정답지.csv"),
        ("홍사랑", "now_hongsarang_9JBi5q5NTh0", "홍사랑_20261107_정답지.csv")]   # 홍사랑다육 11/7 2부(9JBi5q5NTh0, 천동다육 채널): 사용자 정답지 2026-11-11(품종 확인 필요 21개는 품종 비움)   # 마태다육 11/9(_9epGQSWvlg): 관리자 채팅 【찜】 글로 만든 정답지(2026-11-11, 안 본 방송, 찜 받은 상품만)


def main():
    for k, run_, tr in SETS:
        T = {int(r["번호"]) for r in csv.DictReader(open(os.path.join(SHARE, tr), encoding="utf-8-sig"))}
        got, rev = run(os.path.join(FIRST, "runs", run_))
        A = {x["no"] for x in got}
        ask = {g["no"] for g in rev} - A
        print(f"{k}: 맞게 확정 {len(A & T)}/{len(T)} · 정답에 없는 확정 {len(A - T)} · 확인요청 {len(ask)}(정답 {len(ask & T)} {sorted(ask & T)}) · 놓침 {len(T - A - ask)} {sorted(T - A - ask)}")


if __name__ == "__main__":
    main()
