// @vitest-environment node
// PRN2 프린터 칸 단추 크기 — 나이 든 판매자용 글자 18px·높이 52px 이상. 공통 .button은 바꾸지 않고 프린터 칸 안에서만 키운다.
// (칸 안에 단추가 들어 있는지는 prn2-printer.test.tsx가 화면으로 본다)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, '../src/styles.css'), 'utf8')
const px = (body: string, prop: string): number => Number(new RegExp(`${prop}:\\s*([\\d.]+)rem`).exec(body)?.[1]) * 16

describe('프린터 칸 단추 크기 (PRN2)', () => {
  it('.printer-card·.become-device 안의 단추는 글자 18px·높이 52px 이상', () => {
    const rule = /\.printer-card \.button,\s*\.become-device \.button\s*\{([^}]*)\}/.exec(css)
    expect(rule).not.toBeNull()
    expect(px(rule?.[1] ?? '', 'font-size')).toBeGreaterThanOrEqual(18)
    expect(px(rule?.[1] ?? '', 'min-height')).toBeGreaterThanOrEqual(52)
  })

  it('라벨 화면 멈춤 띠·내보내기 단추·그림 파일 접기 줄·라벨 크기 고르기 줄도 글자 18px·높이 52px 이상 (UX-PRN2-009, 라벨 화면 범위만)', () => {
    const buttons = /\.labels-page \.pause-band \.button,\s*\.label-export \.button\s*\{([^}]*)\}/.exec(css)
    const summary = /\.label-export \.files-summary\s*\{([^}]*)\}/.exec(css)
    const sizes = /\.labels-page \.label-size-choices \.choice\s*\{([^}]*)\}/.exec(css)
    for (const rule of [buttons, summary, sizes]) {
      expect(rule).not.toBeNull()
      expect(px(rule?.[1] ?? '', 'font-size')).toBeGreaterThanOrEqual(18)
      expect(px(rule?.[1] ?? '', 'min-height')).toBeGreaterThanOrEqual(52)
    }
    // 공통 .button·.pause-band 규칙은 그대로 (콘솔 알림 창 등 다른 화면은 바뀌지 않는다)
    expect(px(/\n\.button \{([^}]*)\}/.exec(css)?.[1] ?? '', 'font-size')).toBe(16)
  })
})
