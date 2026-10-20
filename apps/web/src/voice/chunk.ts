// 음성 조각 주소 자리 (AC-I4-12 "다시 켤 수 있다", TE-I4-002). 운영용 빌드(vite.config.ts voiceChunkAddress)가 이 글자를
// 음성 조각 파일의 상대 주소(이 글자가 든 조각에서 본 주소, 예: "./src-abc.js")로 바꿔 넣는다. 개발 서버·시험에선 그대로 남는다.
export const VOICE_CHUNK_PLACEHOLDER = '__LIVEJJIM_VOICE_CHUNK__'
