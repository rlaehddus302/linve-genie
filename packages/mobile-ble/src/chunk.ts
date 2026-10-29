// 쓰기 조각 (MTU) — BLE는 한 번에 (MTU − 3)바이트만 쓴다. B1 패킷(가장 긴 래스터 줄 ≈ 61바이트)은 MTU 23이면 셋으로 나뉜다.
// 프린터는 이어 붙여 읽으므로 조각 경계는 패킷과 상관없다(Web Bluetooth도 운영체제가 같은 방식으로 나눈다).
import { BLE_ATT_HEADER, BLE_DEFAULT_MTU } from './transport.ts'

/** 조각 하나의 최대 바이트 — MTU가 이상하면(23 미만·정수 아님) 기본 20 */
export function chunkPayloadFor(mtu: number): number {
  if (!Number.isInteger(mtu) || mtu < BLE_DEFAULT_MTU) return BLE_DEFAULT_MTU - BLE_ATT_HEADER
  return mtu - BLE_ATT_HEADER
}

/** 바이트를 조각 크기로 나눈다 (빈 입력은 빈 목록, 나뉜 조각을 이어 붙이면 원래 바이트) */
export function splitForMtu(bytes: Uint8Array, mtu: number): Uint8Array[] {
  const size = chunkPayloadFor(mtu)
  const out: Uint8Array[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += size) out.push(bytes.subarray(offset, Math.min(offset + size, bytes.byteLength)))
  return out
}
