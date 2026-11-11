import { expect, it } from 'vitest'
import { LabelPaper } from '../src/lib/label-paper.ts'

it('롤 교체와 연속 출력을 순서대로 세고 기기별로 잔량을 복원한다', async () => {
  const saved = new Map<string, string>()
  const paper = new LabelPaper()
  paper.storage = {
    getItem: async (key) => saved.get(key) ?? null,
    setItem: async (key, value) => { saved.set(key, value) },
    removeItem: async (key) => { saved.delete(key) },
  }
  await Promise.all([paper.update('one', 12), paper.update('one', 'printed'), paper.update('one', 'printed'), paper.update('two', 'printed')])
  expect(paper.get('one')).toBe(10)
  expect(paper.get('two')).toBeNull()
  const restored = new LabelPaper()
  restored.storage = paper.storage
  await restored.update('one', 'load')
  expect(restored.get('one')).toBe(10)
  await Promise.all([restored.update('one', 1), restored.update('one', 'printed'), restored.update('one', 'printed')])
  expect(restored.get('one')).toBe(0)
  await restored.update('one', null)
  expect(saved.size).toBe(0)
})
