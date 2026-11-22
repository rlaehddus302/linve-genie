-- 받는 분 이름에 손님 닉네임 같이 적기 (PARCEL_RULES PC-6, D-PARCEL-NICK-01): 설정 "택배"에 켜기 칸 하나. 기본 꺼짐(지금처럼 이름만). 다시 적용해도 되게 IF NOT EXISTS
ALTER TABLE "parcel_settings" ADD COLUMN IF NOT EXISTS "nick_in_name" boolean DEFAULT false NOT NULL;
