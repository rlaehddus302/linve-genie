// 라벨 그림 (LBL-03, L-0 1): 출력과 같은 렌더러의 1비트 그림을 정수 배로 키워 캔버스에 올린다 — 미리 보기 = 출력 그림.
// 50mm 라벨 틀 안에 가운데 48mm 인쇄 폭(384점)을 보인다(라벨 400점 중 양쪽 8점은 찍히지 않는다).
import { DOTS_PER_MM, toPreviewRgba, type LabelBitmap } from '@livejjim/label'
import { useEffect, useRef } from 'react'

export interface LabelImageProps {
  readonly image: LabelBitmap
  /** 화면 이름 (예: "15번 라벨 미리 보기") */
  readonly label: string
  /** 정수 배 확대 (기본 2) */
  readonly scale?: number
  /** 50mm 라벨 틀을 함께 그린다 */
  readonly framed?: boolean
}

/** 라벨 폭 50mm = 400점 */
const LABEL_WIDTH_DOTS = 50 * DOTS_PER_MM

export function LabelImage({ image, label, scale = 2, framed = false }: LabelImageProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current
    if (element === null) return
    const preview = toPreviewRgba(image, scale)
    element.width = preview.width
    element.height = preview.height
    const context = element.getContext('2d')
    if (context === null) return
    context.putImageData(new ImageData(new Uint8ClampedArray(preview.data), preview.width, preview.height), 0, 0)
  }, [image, scale])
  const picture = (
    <canvas
      ref={canvas}
      className="label-canvas"
      role="img"
      aria-label={label}
      data-width={image.width}
      data-height={image.height}
      data-scale={scale}
      width={image.width * scale}
      height={image.height * scale}
      style={framed ? { width: `${String((image.width / LABEL_WIDTH_DOTS) * 100)}%` } : { maxWidth: `${String(image.width * scale)}px` }}
    />
  )
  if (!framed) return picture
  return (
    <div className="label-frame" style={{ aspectRatio: `${String(LABEL_WIDTH_DOTS)} / ${String(image.height)}`, maxWidth: `${String(LABEL_WIDTH_DOTS * scale)}px` }}>
      {picture}
    </div>
  )
}
