import Svg from 'react-native-svg'
import { nativeShareFile, setNativeModules } from '../src/native/index.ts'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { it, expect, vi, onTestFinished } from 'vitest'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { makeWorld } from './screen-support.tsx'
import { buyer, claim, product, fullView, BROADCAST } from './support.ts'

it('양쪽 탭에서 선택한 표를 사진으로 내보낸다', async () => {
  const world = makeWorld()
  const previous = nativeShareFile()
  const shareFile = vi.fn(async () => undefined)
  setNativeModules({ shareFile })
  const snapshot = vi.spyOn(Svg.prototype, 'toDataURL').mockImplementation(cb => cb('iVBORw0KGgo='))
  onTestFinished(() => { setNativeModules({ shareFile: previous }); snapshot.mockRestore() })
  const samples = [['가을여행-t3u','5개',30000],['가을여행-t3u','분홍에케베리아',10000],['나오미다육','왕색금',250000],['미자네','창금',60000],['행복한미소','방울복랑',30000]] as const
  const products = samples.map(([,name,price],i)=>product(201+i,{name,price}))
  const claims = samples.map(([name,,amount],i)=>claim(String(i),201+i,name,{amount}))
  const buyers = [...new Set(samples.map(([name])=>name))].map(name=>buyer(name,name))
  world.server.on('GET', /^\/api\/broadcasts$/,()=>({body:{broadcasts:[{...BROADCAST,date:'2026-11-12'}]}}))
  world.server.on('GET', /^\/api\/days\/2026-11-12$/,()=>({body:fullView({date:'2026-11-12',products,claims,buyers})}))
  world.server.on('GET', /order-shop$/,()=>({body:{name:'용용다육'}}))
  for(const tab of ['구매자별','상품별'] as const){
    const mounted=render(world.wrap(<ConsoleScreen broadcastId="b1" seller justEnded onBack={()=>{}}/>))
    await screen.findByText('용용다육')
    fireEvent.click(screen.getByRole('button',{name:tab}))
    fireEvent.click(screen.getByRole('button',{name:'내보내기'}))
    for(const name of ['사진으로 저장하기','CSV 파일로 저장하기','엑셀 파일로 저장하기']) expect(screen.getByRole('button',{name})).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'사진으로 저장하기'}))
    await screen.findByRole('button',{name:'사진 저장'})
    const svg=document.querySelector('svg[viewBox^="0 0 480"]')!
    expect(svg.textContent).toContain('380,000')
    expect(svg.textContent).not.toContain('-t3u')
    fireEvent.click(screen.getByRole('button', {name:'사진 저장'}))
    await waitFor(() => expect(shareFile).toHaveBeenCalledWith(expect.any(Uint8Array), `정산내역서-2026-11-12-${tab}.png`, 'image/png'))
    mounted.unmount()
  }
})
