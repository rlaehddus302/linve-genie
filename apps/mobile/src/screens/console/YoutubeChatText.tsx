// 유튜브 기본 이모티콘의 단축어와 공식 CDN 이미지 ID. 기존에 원문만 저장한 채팅에도 쓴다.
// 목록 출처: https://gist.github.com/ZonianMidian/fc833761e7d31a3e64cd0ff288d61067
import { useState } from 'react'
import { Image } from 'react-native'
import ids from '../../lib/youtube-emote-ids.json'
import { Txt, useKit } from '../../ui/kit/index.ts'

const imageIds: Readonly<Record<string, string>> = ids

function Emote({ code, id }: { readonly code: string; readonly id: string }) {
  const [failed, setFailed] = useState(false)
  const { fontScale } = useKit()
  if (failed) return <Txt step="meta">{code === ':hand-pink-waving:' ? '👋' : code === ':face-red-heart-shape:' ? '❤️' : '◈'}</Txt>
  const size = 20 * fontScale
  return <Image accessibilityLabel={code.slice(1, -1).replaceAll('-', ' ')} accessible accessibilityIgnoresInvertColors source={{ uri: `https://yt3.ggpht.com/${id}=s48-c` }} resizeMode="contain" style={{ width: size, height: size }} onError={() => setFailed(true)} />
}

export function YoutubeChatText({ text, oneLine }: { readonly text: string; readonly oneLine: boolean }) {
  const parts = text.includes(':') ? text.split(/(:[a-z0-9-]{1,64}:)/g) : [text]
  return <Txt step="meta" {...(oneLine ? { numberOfLines: 1 } : {})}>{parts.map((part, index) => {
    const id = Object.hasOwn(imageIds, part) ? imageIds[part] : undefined
    return id === undefined ? part : <Emote key={`${index}-${id}`} code={part} id={id} />
  })}</Txt>
}
