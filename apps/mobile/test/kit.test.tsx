// 공통 디자인 조각 시험: 역할·이름이 맞고, 글자 2배에서도 모든 글과 단추가 그대로 있다.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  applyPadKey,
  BigButton,
  BottomCTA,
  BottomSheet,
  Card,
  ConfirmSheet,
  EmptyState,
  ListRow,
  NumberPad,
  Section,
  StatusChip,
  TextField,
  ThemeOverrideProvider,
  Toast,
  ToggleRow,
  useToast,
} from '../src/ui/kit/index.ts'

describe('BigButton', () => {
  it('세 종류 모두 버튼이고 누르면 불린다. 쉬거나 처리 중이면 안 불린다', () => {
    const onPress = vi.fn()
    render(
      <>
        <BigButton label="주" onPress={onPress} />
        <BigButton kind="secondary" label="보조" onPress={onPress} />
        <BigButton kind="danger" label="위험" onPress={onPress} />
        <BigButton label="쉼" disabled onPress={onPress} />
        <BigButton label="처리" busy onPress={onPress} />
      </>,
    )
    for (const name of ['주', '보조', '위험']) fireEvent.click(screen.getByRole('button', { name }))
    expect(onPress).toHaveBeenCalledTimes(3)
    fireEvent.click(screen.getByRole('button', { name: '쉼' }))
    fireEvent.click(screen.getByRole('button', { name: '처리' }))
    expect(onPress).toHaveBeenCalledTimes(3)
  })

  it('아이콘은 글자와 함께 보이고, 읽는 이름은 따로 줄 수 있다', () => {
    render(<BigButton label="목록" icon="←" ariaLabel="방송 목록으로" onPress={() => undefined} />)
    expect(screen.getByRole('button', { name: '방송 목록으로' }).textContent).toBe('← 목록')
  })
})

describe('글자 2배에서도 안 깨짐', () => {
  it('모든 글과 단추가 그대로 있다', () => {
    render(
      <ThemeOverrideProvider fontScale={2}>
        <Section title="묶음" description="설명">
          <Card>
            <ListRow title="제목" subtitle="부제" value="12,000원" onPress={() => undefined} />
            <ToggleRow title="켜고 끄기" on={false} onChange={() => undefined} />
            <StatusChip tone="warning" label="입금 기다려요" />
            <TextField label="이름" help="도움말" error="오류" />
            <EmptyState title="비었어요" actionLabel="시작" onAction={() => undefined} />
          </Card>
        </Section>
        <BottomCTA note="안내">
          <BigButton label="가장 긴 이름의 아주 큰 주 버튼입니다" onPress={() => undefined} />
        </BottomCTA>
      </ThemeOverrideProvider>,
    )
    for (const text of ['묶음', '설명', '제목', '부제', '12,000원', '입금 기다려요', '도움말', '안내']) expect(screen.getByText(text)).toBeTruthy()
    expect(screen.getByRole('button', { name: '제목 — 12,000원' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: '켜고 끄기 — 꺼짐' })).toBeTruthy()
    // 옛 기대: 글 앞 ⚠. 새 기대(D-UX3-11): 그림 느낌표(글이 아님) + 문장
    expect(screen.getByRole('alert').textContent).toBe('오류')
    expect(screen.getByRole('button', { name: '시작' })).toBeTruthy()
    expect(screen.getByRole('toolbar', { name: '화면 아래 버튼' })).toBeTruthy()
  })
})

describe('ListRow · ToggleRow', () => {
  it('누르면 불린다. 누르지 못하는 줄은 버튼이 아니다', () => {
    const onPress = vi.fn()
    render(
      <>
        <ListRow title="눌러요" onPress={onPress} />
        <ListRow title="읽기만" value="값" />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: '눌러요' }))
    expect(onPress).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: /읽기만/ })).toBeNull()
  })

  it('켜고 끄기는 한 번 눌러 바뀐 값을 준다', () => {
    const onChange = vi.fn()
    render(<ToggleRow title="소리" on={false} onChange={onChange} />)
    fireEvent.click(screen.getByRole('switch', { name: '소리 — 꺼짐' }))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

describe('StatusChip', () => {
  it('색만이 아니라 기호와 글자로 알린다', () => {
    render(<StatusChip tone="danger" label="확인이 필요해요" />)
    expect(screen.getByText('확인이 필요해요')).toBeTruthy()
    expect(screen.getByText('✕')).toBeTruthy()
  })
})

describe('TextField', () => {
  it('라벨로 찾고, 오류는 알림으로 읽히며, 도움말도 보인다', () => {
    render(<TextField label="가격" unit="원" help="숫자만 적어요" error="너무 커요" defaultValue="" />)
    expect(screen.getByLabelText('가격')).toBeTruthy()
    expect(screen.getByText('원')).toBeTruthy()
    expect(screen.getByText('숫자만 적어요')).toBeTruthy()
    // 옛 기대: 글 앞 ⚠. 새 기대(D-UX3-11): 그림 느낌표(글이 아님) + 문장
    expect(screen.getByRole('alert').textContent).toBe('너무 커요')
  })

  it('오류가 없으면 알림이 없다', () => {
    render(<TextField label="가격" error={null} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('NumberPad', () => {
  it('키를 누르면 숫자가 쌓이고 지우기·모두 지우기가 된다', () => {
    function Harness() {
      const [value, setValue] = useState('')
      return (
        <>
          <NumberPad value={value} onChange={setValue} maxLength={5} />
          <output>{value}</output>
        </>
      )
    }
    const { container } = render(<Harness />)
    const out = () => container.querySelector('output')?.textContent
    for (const key of ['1', '2', '00']) fireEvent.click(screen.getByRole('button', { name: key }))
    expect(out()).toBe('1200')
    fireEvent.click(screen.getByRole('button', { name: '지우기' }))
    expect(out()).toBe('120')
    fireEvent.click(screen.getByRole('button', { name: '9' }))
    fireEvent.click(screen.getByRole('button', { name: '9' }))
    expect(out()).toBe('12099')
    fireEvent.click(screen.getByRole('button', { name: '모두 지우기' }))
    expect(out()).toBe('')
  })

  it('앞의 0은 쌓이지 않고 길이를 넘기면 무시한다', () => {
    expect(applyPadKey('', '0', 5)).toBe('0')
    expect(applyPadKey('0', '00', 5)).toBe('0')
    expect(applyPadKey('0', '7', 5)).toBe('7')
    expect(applyPadKey('12345', '6', 5)).toBe('12345')
    expect(applyPadKey('', 'back', 5)).toBe('')
  })
})

describe('BottomSheet · ConfirmSheet', () => {
  it('닫혀 있으면 안 보이고, 열리면 제목·내용·닫기가 있다', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <BottomSheet visible={false} onClose={onClose} title="고르기">
        <ListRow title="하나" />
      </BottomSheet>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(
      <BottomSheet visible onClose={onClose} title="고르기">
        <ListRow title="하나" />
      </BottomSheet>,
    )
    expect(screen.getByRole('dialog', { name: '고르기' })).toBeTruthy()
    expect(screen.getByText('하나')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('확인 질문은 하려는 일을 단추 글로 말하고, 아니요도 있다', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ConfirmSheet visible question="찜을 취소할까요?" description="순서가 넘어가요." confirmLabel="찜 취소하기" danger onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getByRole('dialog', { name: '찜을 취소할까요?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '아니요' }))
    expect(onCancel).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '찜 취소하기' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})

describe('Toast', () => {
  function Harness({ onUndo }: { readonly onUndo: () => void }) {
    const { toast, show, hide } = useToast()
    return (
      <>
        <BigButton label="저장" onPress={() => show('저장했어요.', { actionLabel: '되돌리기', onAction: onUndo })} />
        <BigButton label="실패" onPress={() => show('못 했어요.', { problem: true })} />
        <Toast toast={toast} onDismiss={hide} />
      </>
    )
  }

  it('되돌리기를 누르면 되돌리고 사라진다', () => {
    const onUndo = vi.fn()
    render(<Harness onUndo={onUndo} />)
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(screen.getByRole('status').textContent).toContain('저장했어요.')
    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }))
    expect(onUndo).toHaveBeenCalledOnce()
    expect(screen.queryByText('저장했어요.')).toBeNull()
  })

  it('되돌리기가 있으면 8초, 없으면 4초 뒤 사라진다. 문제 알림은 닫기를 눌러야 사라진다', () => {
    vi.useFakeTimers()
    try {
      render(<Harness onUndo={() => undefined} />)
      fireEvent.click(screen.getByRole('button', { name: '저장' }))
      act(() => vi.advanceTimersByTime(7000))
      expect(screen.queryByText('저장했어요.')).not.toBeNull()
      act(() => vi.advanceTimersByTime(1500))
      expect(screen.queryByText('저장했어요.')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: '실패' }))
      act(() => vi.advanceTimersByTime(60000))
      expect(screen.getByRole('alert').textContent).toContain('못 했어요.')
      fireEvent.click(screen.getByRole('button', { name: '닫기' }))
      expect(screen.queryByText('못 했어요.')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
