-- EP1 우체국 비회원 신청 비밀번호 (PARCEL_RULES PC-9 8, D-EP1-14): 설정 "택배"에 암호문 칸 하나. 다시 적용해도 되게 IF NOT EXISTS
ALTER TABLE "parcel_settings" ADD COLUMN IF NOT EXISTS "epost_pw_enc" text;
