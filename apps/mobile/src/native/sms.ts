// 판매자 휴대폰 문자 앱을 손님 번호·글로 채워 연다 (D-REAL-05). 판매자가 보내기를 누르면 판매자 번호로 간다.
// 아이폰은 앱 안 문자 창(보냄·닫음을 알려 준다), 안드로이드는 기본 문자 앱(결과를 알려 주지 않아 'unknown').
// 네이티브 모듈은 부를 때 불러온다(시험·웹 번들이 expo 모듈을 끌어오지 않게).
export type SmsResult = 'sent' | 'cancelled' | 'unknown'

export interface NativeSms {
  /** 이 기기에서 문자를 보낼 수 있나 (유심 없는 아이패드 등은 false) */
  available(): Promise<boolean>
  compose(phone: string, text: string): Promise<SmsResult>
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
  async compose(phone, text) {
    const SMS = await import('expo-sms')
    const { result } = await SMS.sendSMSAsync([phone], text)
    return result
  },
}
