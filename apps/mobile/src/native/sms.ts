// 판매자 휴대폰 문자 앱을 손님 번호·글로 채워 연다 (D-REAL-05). 판매자가 보내기를 누르면 판매자 번호로 간다.
// 확인서는 링크 대신 사진(JPG)을 붙인다 (D-REAL-13 — 링크 문자는 스팸·스미싱으로 보일 수 있다).
// 아이폰은 앱 안 문자 창(보냄·닫음을 알려 준다), 안드로이드는 기본 문자 앱(결과를 알려 주지 않아 'unknown').
// 네이티브 모듈은 부를 때 불러온다(시험·웹 번들이 expo 모듈을 끌어오지 않게).
// react-native는 맨 위에서 바로 불러온다 — `import('react-native')`는 react-native의 모든 모듈을 한꺼번에 깨워(importAll)
// 아이폰에서 옛 알림 모듈(PushNotificationIOS)이 오류를 던지고, 정식 앱은 그 오류로 꺼진다 (D-UX4-127, 사용자 신고 "문자 보내기 하면 앱이 꺼져").
import { Platform } from 'react-native'

export type SmsResult = 'sent' | 'cancelled' | 'unknown'

/** 문자에 붙일 그림 (영문 파일 이름 — 문자 앱이 한글 이름을 깨뜨리지 않게) */
export interface SmsImage {
  readonly mimeType?: 'image/png' | 'image/jpeg'
  readonly bytes: Uint8Array
  readonly name: string
}

export interface NativeSms {
  /** 이 기기에서 문자를 보낼 수 있나 (유심 없는 아이패드 등은 false) */
  available(): Promise<boolean>
  compose(phone: string, text: string, image?: SmsImage): Promise<SmsResult>
}

export const deviceSms: NativeSms = {
  async available() {
    try {
      const SMS = await import('expo-sms')
      return await SMS.isAvailableAsync()
    } catch {
      return false
    }
  },
  async compose(phone, text, image) {
    const SMS = await import('expo-sms')
    if (image === undefined) {
      const { result } = await SMS.sendSMSAsync([phone], text)
      return result
    }
    const { File, Paths } = await import('expo-file-system')
    const file = new File(Paths.cache, image.name)
    file.create({ overwrite: true })
    file.write(image.bytes)
    // 안드로이드: 문자 앱이 우리 앱 파일을 읽도록 content:// 주소(expo-file-system FileProvider, 캐시 폴더 허용).
    // 아이폰: expo-sms가 file:// 주소를 직접 읽어 문자 창에 붙인다. 아이폰 문자 창은 종류 이름을 UTI('public.jpeg')로 받는다
    // (expo-sms가 mimeType 칸을 그대로 넘긴다 — 'image/jpeg'이면 붙이기에 실패할 수 있다). 안드로이드는 MIME 그대로.
    const android = Platform.OS === 'android'
    const uri = android ? file.contentUri : file.uri
    const mimeType = android ? (image.mimeType ?? 'image/jpeg') : image.mimeType === 'image/png' ? 'public.png' : 'public.jpeg'
    const { result } = await SMS.sendSMSAsync([phone], text, { attachments: { uri, mimeType, filename: image.name } })
    return result
  },
}
