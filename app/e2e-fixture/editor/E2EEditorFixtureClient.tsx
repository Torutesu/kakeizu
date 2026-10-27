'use client'

import { useEffect, useMemo, useState } from 'react'
import { FamilyTree } from '@/components/FamilyTree'
import { IssuesPanel } from '@/components/IssuesPanel'
import { RelationshipEditDialog } from '@/components/RelationshipEditDialog'
import { Button } from '@/components/ui/button'
import { processFamilyData, FamilyTreeData, PersonData, FamilyData } from '@/utils/familyDataProcessor'
import {
  TreeState,
  addFamilyTo,
  addPersonWithRelationTo,
  deleteFamilyFrom,
  deriveLiveIssues,
  moveChildIn,
  updateFamilyIn,
} from '@/utils/familyMutations'
import { buildTreeSvg } from '@/utils/exportPdf'

// ============================================================================
// 2通の戸籍を読み込んで統合した家系図を、関係の編集まで含めて操作できるE2E用画面。
//
// クライアントから指摘された状況を再現する:
// - 父の戸籍（祖父母=第1世代）と本人の戸籍（父母=第1世代）で世代番号の起点がずれている
// - 夫婦・きょうだいの並びがデータ上はばらばら（妻が先、きょうだいが生年順でない）
// - 婚姻日が西暦のものと、和暦の原文しか読めなかったもの
// - 子の姓が親と違う（「森本」の読み違い）
// - 片親（父）だけが登録された家族（父には妻がいるが、子は父だけの子になっている）
//
// 編集は本番と同じ純関数（utils/familyMutations.ts）で行う。保存はしない。
// ============================================================================

const person = (
  id: string,
  generation: number,
  sex: PersonData['sex'],
  surname: string,
  given: string,
  birth: string | null,
  relation: string | null
): PersonData => ({
  id,
  generation,
  sex,
  name: { surname, given_name: given },
  birth: { original_date: null, date: birth, place: null },
  death: { original_date: null, date: null, place: null },
  relation_to_family_head: relation,
})

const family = (
  id: string,
  parents: string[],
  children: string[],
  marriage: { date?: string; original?: string } = {}
): FamilyData => ({
  id,
  parents,
  children,
  marriage_date: { original_date: marriage.original ?? null, date: marriage.date ?? null },
  divorce_date: { original_date: null, date: null },
  relation_type: 'blood',
})

const FIXTURE: FamilyTreeData = {
  people: [
    // 父の戸籍（祖父母が第1世代）
    person('gf', 1, 'male', '丙山', '太一', '1905-02-11', '夫'),
    person('gm', 1, 'female', '丙山', 'トメ', '1908-07-01', '妻'),
    person('kenichi', 2, 'male', '丙山', '健一', '1931-05-05', '長男'),
    person('jiro', 2, 'male', '丙山', '二郎', '1934-09-09', '二男'),
    person('hanako', 2, 'female', '丙山', '花子', '1936-12-01', '長女'),
    // 本人の戸籍（父母が第1世代）。健一は名寄せで父の戸籍側の人物に統合済みの想定
    person('aiko', 1, 'female', '丙山', '愛子', '1935-03-03', '妻'),
    person('me', 2, 'male', '森本', '信太郎', '1960-01-15', '長男'),
    person('koji', 2, 'male', '丙山', '浩二', '1963-06-20', '二男'),
    person('misaki', 2, 'female', '丙山', '美咲', '1966-10-10', '長女'),
    person('yumi', 1, 'female', '丙山', '由美', '1962-08-08', '妻'),
    // 二郎の戸籍（妻の文子は登録されているが、三郎は父だけの子として登録された）
    person('fumiko', 2, 'female', '丙山', '文子', '1938-02-02', '妻'),
    person('saburo', 1, 'male', '丙山', '三郎', '1965-04-04', '長男'),
  ],
  families: [
    family('f-gp', ['gm', 'gf'], ['hanako', 'kenichi', 'jiro'], { date: '1930-03-01' }),
    family('f-parents', ['aiko', 'kenichi'], ['misaki', 'koji', 'me'], { date: '1958-04-10' }),
    family('f-me', ['yumi', 'me'], [], { original: '昭和五拾九年壱月弐拾弐日' }),
    family('f-jiro', ['jiro'], ['saburo']),
    family('f-jiro-couple', ['fumiko', 'jiro'], []),
  ],
}

export function E2EEditorFixtureClient() {
  const [tree, setTree] = useState<TreeState>(() => {
    const processed = processFamilyData(FIXTURE)
    return { persons: processed.persons, families: processed.families }
  })
  const { issues, persons } = useMemo(() => deriveLiveIssues(tree.persons, tree.families), [tree])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = persons.find(p => p.id === selectedId) ?? null
  const [isRelationOpen, setIsRelationOpen] = useState(false)
  const [showPdf, setShowPdf] = useState(false)
  const pdfSvg = useMemo(
    () => (showPdf ? buildTreeSvg(persons, tree.families, 'E2E確認', new Date('2026-10-27')).svg : ''),
    [showPdf, persons, tree.families]
  )

  // ハイドレーション完了の目印（これを待たないとE2Eが操作を取りこぼす）
  const [isReady, setIsReady] = useState(false)
  useEffect(() => setIsReady(true), [])

  return (
    <div className="w-screen h-screen flex" data-hydrated={isReady ? 'true' : undefined}>
      <div className="flex-1 relative">
        <FamilyTree
          persons={persons}
          families={tree.families}
          selectedPerson={selected}
          onPersonSelect={p => setSelectedId(p.id)}
        />
      </div>
      <aside className="w-80 border-l border-gray-200 bg-white overflow-y-auto" data-testid="sidebar">
        <div className="px-6 py-3 space-y-2">
          <div className="text-xs text-gray-500" data-testid="selected-person">
            {selected ? `選択中: ${selected.displayName}` : '未選択'}
          </div>
          <Button size="sm" disabled={!selected} onClick={() => setIsRelationOpen(true)}>
            関係を編集
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowPdf(v => !v)}>
            PDFの図を表示
          </Button>
          <div className="text-xs text-gray-500" data-testid="family-count">{tree.families.length}</div>
          {/* 画面外のカードもクリックせずに選べるようにする（E2Eの操作を表示位置に依存させない） */}
          <div className="flex flex-wrap gap-1">
            {persons.map(p => (
              <button
                key={p.id}
                type="button"
                className="text-[10px] border rounded px-1"
                data-testid={`select-${p.id}`}
                onClick={() => setSelectedId(p.id)}
              >
                {p.displayName}
              </button>
            ))}
          </div>
        </div>
        <IssuesPanel issues={issues} persons={persons} onFocusPerson={p => setSelectedId(p.id)} />
        {showPdf && (
          <div data-testid="pdf-svg" className="p-2" dangerouslySetInnerHTML={{ __html: pdfSvg }} />
        )}
      </aside>

      <RelationshipEditDialog
        person={selected}
        isOpen={isRelationOpen}
        onClose={() => setIsRelationOpen(false)}
        availablePersons={persons}
        families={tree.families}
        onAddFamily={data => setTree(current => addFamilyTo(current, data).state)}
        onUpdateFamily={(id, updates) => setTree(current => updateFamilyIn(current, id, updates))}
        onDeleteFamily={id => setTree(current => deleteFamilyFrom(current, id).state)}
        onAddPersonWithRelation={(personData, link) => {
          const result = addPersonWithRelationTo(tree, personData, link)
          setTree(result.state)
          return result.personId
        }}
        onMoveChild={(childId, from, to) => setTree(current => moveChildIn(current, childId, from, to).state)}
      />
    </div>
  )
}
