// 업종 옵션 템플릿 (OPT-05, D-O-16, D-O2-04). 템플릿 하나 = 옵션 항목 하나이고, 업종별로 묶어 "옵션 추가" 창의 "템플릿에서 고르기"에 보인다.
// 숫자만으로 된 별칭은 기본으로 두지 않는다 — 같은 번호 상품이 있으면 맨숫자 댓글이 '확인 필요'로 간다(D-O4-11).
// 화면 기본값일 뿐이다 — 서버·엔진은 템플릿을 모른다(요청에는 고른 뒤의 옵션만 들어간다). 기종 목록은 새 모델이 나오면 이 데이터만 고친다.
import type { OptionItem } from '@livejjim/core'

export interface OptionTemplate {
  /** 템플릿 이름 (창에 보이는 이름 — 같은 항목 이름의 두 템플릿을 가른다) */
  readonly title: string
  /** 채울 항목 */
  readonly item: OptionItem
}

export interface TemplateGroup {
  /** 업종 */
  readonly group: string
  readonly templates: readonly OptionTemplate[]
}

const plain = (...labels: string[]) => labels.map((label) => ({ label }))

export const OPTION_TEMPLATES: readonly TemplateGroup[] = [
  {
    group: '의류',
    templates: [
      { title: '사이즈', item: { name: '사이즈', choices: plain('S', 'M', 'L', 'XL') } },
      { title: '사이즈(숫자)', item: { name: '사이즈', choices: plain('95', '100', '105', '110') } },
      {
        title: '색상',
        item: {
          name: '색상',
          choices: [
            { label: '흰색', aliases: ['화이트'] },
            { label: '검정색', aliases: ['검정', '블랙'] },
            { label: '회색', aliases: ['그레이'] },
            { label: '네이비', aliases: ['남색'] },
            { label: '베이지' },
          ],
        },
      },
    ],
  },
  {
    group: '휴대폰 케이스',
    templates: [
      {
        title: '기종',
        item: {
          name: '기종',
          choices: [
            { label: '아이폰 16' },
            { label: '아이폰 16 프로', aliases: ['16프로'] },
            { label: '아이폰 17' },
            { label: '아이폰 17 프로', aliases: ['17프로'] },
            { label: '갤럭시 S25', aliases: ['S25'] },
            { label: '갤럭시 S25 울트라', aliases: ['S25울트라'] },
          ],
        },
      },
    ],
  },
  {
    group: '식품',
    templates: [
      { title: '중량', item: { name: '중량', choices: plain('500g', '1kg', '2kg') } },
      { title: '용량', item: { name: '용량', choices: plain('500ml', '1L') } },
      { title: '맛', item: { name: '맛', choices: plain('순한맛', '매운맛') } },
    ],
  },
  {
    group: '화분',
    templates: [{ title: '호수', item: { name: '호수', choices: plain('1호', '2호', '3호', '4호', '5호', '6호', '7호', '8호', '9호', '10호') } }],
  },
]
