'use client'

import { useState } from 'react'
import { FamilyTree } from '@/components/FamilyTree'
import { IssuesPanel } from '@/components/IssuesPanel'
import { RegistriesPanel } from '@/components/RegistriesPanel'
import { processFamilyData, FamilyTreeData, ProcessedPerson } from '@/utils/familyDataProcessor'

// E2Eの固定データ。実際の戸籍解析で起きうる状況を意図的に含める:
// - 正常な三世代（描画・関係線の基本）
// - 元号の読み違いによる矛盾（親が子より後に生まれている）
// - 西暦に変換できなかった日付
// - 2モデル照合で照合側だけが抽出した人物（人物カードに紐づかない指摘）
const FIXTURE: FamilyTreeData = {
  // 転籍で本籍が変わった状況。人物に本籍を1つだけ持たせると
  // 履歴が失われることを、この2件で検証する
  registries: [
    {
      id: 'r1',
      registered_domicile: '広島県福山市○○町一丁目1番地',
      head_of_family: '阿吹 軍一',
      registry_type: 'revised',
      member_ids: ['oya', 'haha', 'ko1', 'ko2'],
    },
    {
      id: 'r2',
      registered_domicile: '東京都千代田区△△一番地',
      head_of_family: '阿吹 美則',
      registry_type: 'current',
      member_ids: ['ko1'],
    },
  ],
  people: [
    {
      id: 'oya', generation: 1, sex: 'male',
      name: { surname: '阿吹', given_name: '軍一' },
      // 明治30年(1897)を昭和30年(1955)と読み違えた想定
      birth: { original_date: '昭和三十年六月二十九日', date: '1955-06-29', place: '広島県' },
      death: { original_date: null, date: null, place: null },
      relation_to_family_head: '夫',
    },
    {
      id: 'haha', generation: 1, sex: 'female',
      name: { surname: '遠藤', given_name: 'ハナ' },
      birth: { original_date: null, date: '1900-06-01', place: null },
      death: { original_date: null, date: '1969-02-16', place: null },
      relation_to_family_head: '妻',
    },
    {
      id: 'ko1', generation: 2, sex: 'male',
      name: { surname: '阿吹', given_name: '美則' },
      birth: { original_date: null, date: '1925-01-01', place: null },
      death: { original_date: null, date: null, place: null },
      relation_to_family_head: '長男',
    },
    {
      id: 'ko2', generation: 2, sex: 'male',
      name: { surname: '阿吹', given_name: '繁好' },
      birth: { original_date: '大正九年', date: null, place: null },
      death: { original_date: null, date: null, place: null },
      relation_to_family_head: '二男',
    },
  ],
  families: [
    {
      id: 'f1', parents: ['oya', 'haha'], children: ['ko1', 'ko2'],
      marriage_date: { original_date: null, date: null },
      divorce_date: { original_date: null, date: null },
      relation_type: 'blood',
    },
  ],
  crossCheckIssues: [
    {
      severity: 'warning',
      code: 'cross_person_missing_in_primary',
      // 採用した側に対応する人物がいないため personIds が空になる指摘。
      // 人物カードには出せず、一覧でのみ確認できる
      message: '阿吹 ヨシは照合モデルのみが抽出しました。取りこぼしの可能性があるため確認してください。',
      personIds: [],
    },
  ],
}

export function E2EFixtureClient() {
  const initial = processFamilyData(FIXTURE)
  const [selected, setSelected] = useState<ProcessedPerson | null>(null)
  const [focus, setFocus] = useState<{ id: string; requestId: number } | null>(null)
  const [focusCount, setFocusCount] = useState(0)

  return (
    <div className="w-screen h-screen flex">
      <div className="flex-1 relative">
        <FamilyTree
          persons={initial.persons}
          families={initial.families}
          selectedPerson={selected}
          onPersonSelect={setSelected}
          focusPerson={focus}
        />
      </div>
      <aside className="w-80 border-l border-gray-200 bg-white overflow-y-auto" data-testid="sidebar">
        <RegistriesPanel
          registries={FIXTURE.registries ?? []}
          persons={initial.persons}
          onFocusPerson={setSelected}
        />
        <IssuesPanel
          issues={initial.issues}
          persons={initial.persons}
          onFocusPerson={person => {
            setSelected(person)
            const next = focusCount + 1
            setFocusCount(next)
            setFocus({ id: person.id, requestId: next })
          }}
        />
        <div className="px-6 py-3 text-xs text-gray-500" data-testid="selected-person">
          {selected ? `選択中: ${selected.displayName}` : '未選択'}
        </div>
      </aside>
    </div>
  )
}
