// 옛 택배 탭 주소 (D-UX3-39 → D-UX3-60): 택배는 포장 탭 안으로 합쳤다 — 포장 탭의 택배 쪽으로 돌린다(날짜 그대로).
import { Redirect, useLocalSearchParams } from 'expo-router'

export default function ParcelsRoute() {
  const params = useLocalSearchParams<{ date?: string }>()
  const date = typeof params.date === 'string' ? params.date : undefined
  return <Redirect href={{ pathname: '/packing', params: date === undefined ? { view: 'parcels' } : { view: 'parcels', date } }} />
}
