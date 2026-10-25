// 밴드 글 댓글 모듈 (BND1, PLT-04). 서버 조립(server.ts)이 BandService를 만들고 경로(routes.ts)·기록 경로의 txHook·운영 상태에 잇는다.
export { bandBatch, bandComment, bandFirstLine, bandText, BAND_SKIP_CODES, BAND_TEXT_MAX, type BandChatFields, type BandSkipCode } from './comment.ts'
export { BandClient, classifyBandCode, pagingParams, type BandFailure, type BandFailureKind } from './client.ts'
export { bandSettings, readBandConfig, secureBandUrl, BAND_API_URL, BAND_AUTH_URL, type BandSettings } from './config.ts'
export { BAND_ALLOWED_PATHS, BAND_REQUESTS, bandRequestUrl, BandRequestRefused, type BandOp } from './endpoints.ts'
export { FakeBand, type FakeBandFault, type FakeBandLogin, type FakeBandRequest } from './fake.ts'
export { BAND_CALLBACK_RESULTS, BAND_MESSAGES } from './messages.ts'
export { BandService, BAND_TIMING, type BandAccountView, type BandClock, type BandHooks, type BandLinkView, type BandServiceOptions, type BandTiming } from './service.ts'
