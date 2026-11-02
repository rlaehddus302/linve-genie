// 라벨 그림을 공유 시트로 제조사 앱에 보낸다 (PR-07). 시트에서 판매자가 앱을 고른다 — 우리 앱은 파일만 만들어 넘긴다.
// 네이티브 모듈은 부를 때 불러온다(시험·웹 번들이 expo 모듈을 끌어오지 않게).
export type ShareLabelImage = (png: Uint8Array, name: string) => Promise<void>

export const shareLabelImage: ShareLabelImage = async (png, name) => {
  const [{ File, Paths }, Sharing] = await Promise.all([import('expo-file-system'), import('expo-sharing')])
  if (!(await Sharing.isAvailableAsync())) throw new Error('SHARE_UNAVAILABLE')
  const file = new File(Paths.cache, name)
  file.create({ overwrite: true })
  file.write(png)
  await Sharing.shareAsync(file.uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: '제조사 앱으로 보내기' })
}

/** 서버가 만든 파일(운송장 PDF 등)을 공유 시트로 넘긴다 — 판매자가 프린트·카톡·드라이브 중 고른다 (D-APPX-01) */
export type ShareFile = (bytes: Uint8Array, name: string, mimeType: string) => Promise<void>

export const shareFile: ShareFile = async (bytes, name, mimeType) => {
  const [{ File, Paths }, Sharing] = await Promise.all([import('expo-file-system'), import('expo-sharing')])
  if (!(await Sharing.isAvailableAsync())) throw new Error('SHARE_UNAVAILABLE')
  const file = new File(Paths.cache, name)
  file.create({ overwrite: true })
  file.write(bytes)
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name })
}
